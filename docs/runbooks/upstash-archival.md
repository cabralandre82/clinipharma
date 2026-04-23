# Runbook — Upstash Redis archival / keep-alive

**Last reviewed:** 2026-04-18
**Owner:** SRE
**Severity if triggered:** P2 (degraded distributed rate limiting; no data loss)

## Contexto

A plataforma usa um banco **Upstash Redis** (nome `clinipharma`, URL
`https://subtle-mackerel-96084.upstash.io`) como backend do rate limiter
em `lib/rate-limit.ts`. O free-tier do Upstash **arquiva** (suspende e
faz backup) bancos que ficam sem tráfego por ~1 semana. Um banco
arquivado continua restaurável, mas enquanto estiver arquivado:

- Toda chamada de `rateLimit()` cai no fallback in-memory.
- Rate limits deixam de ser **distribuídos** entre instâncias
  serverless do Vercel — um atacante pode burlar limites acertando
  instâncias diferentes.
- Nenhuma chave/sessão é perdida (o banco é só contadores).

## Detecção

Três sinais independentes de que o banco está dormindo ou arquivado:

1. **Email de aviso** do Upstash ("Your Database will be archived
   soon"). Chega ~1 semana antes do archival propriamente dito.
2. **`/api/health/deep`** → `checks.upstashRedis.ok === false` ou
   `details.latencyMs` muito acima do baseline (<100 ms em gru1).
3. **Cron `synthetic-probe`** (a cada 5 min) — linha em `cron_runs`
   com `target: "upstash-redis", status: "fail"` ou
   `synthetic_probe_total{target="upstash-redis",status="fail"}` > 0.

## Mecânica do keep-alive

A partir de abril/2026 o cron `/api/cron/synthetic-probe` executa um
PING contra o REST endpoint do Upstash toda vez que roda (a cada 5
minutos, 24/7). Um único comando bem-sucedido por semana já é
suficiente para resetar o contador de inatividade; 288 pings/dia dá
folga de três ordens de magnitude. Implementação:

- `lib/redis.ts` → `pingRedis()` — HTTP GET no `/ping` com Bearer
  token; timeout de 10 s via `AbortController`.
- `app/api/cron/synthetic-probe/route.ts` — chama `pingRedis()`
  condicionalmente (só se `UPSTASH_REDIS_REST_URL` +
  `UPSTASH_REDIS_REST_TOKEN` estiverem ambos setados), e empurra o
  resultado em `results[]` como mais um target.

O PING também garante que o rate limiter está **efetivamente**
usando Redis — se o `@upstash/redis` falhar em carregar ou se as
credenciais estiverem erradas, o PING falha antes de qualquer
usuário ser afetado.

## Procedimento — banco ainda ativo, email recebido

Não é necessário fazer nada manualmente se o `synthetic-probe` está
rodando. Para tirar a dúvida:

```bash
curl -s -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN" \
  "$UPSTASH_REDIS_REST_URL/ping"
# → {"result":"PONG"}

curl -s -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN" \
  "$UPSTASH_REDIS_REST_URL/dbsize"
# → {"result": <N>}   ← >0 quando o rate limiter real está no tráfego
```

Se `PONG` vier mas `dbsize` ficar em 0 por horas, significa que
nenhum bucket de rate limit foi exercitado (tráfego real baixo). O
keep-alive cuida do archival sozinho; nenhuma ação extra é
necessária.

## Procedimento — banco foi arquivado

1. **Confirme o estado** no painel Upstash
   (https://console.upstash.com) — banco aparece com status
   "Archived".
2. **Restaure** clicando em "Restore". Leva de 1 a 5 minutos. A URL
   e o token **não mudam** após restore, então as env vars no Vercel
   seguem válidas.
3. **Valide** com `curl $URL/ping` (deve responder `PONG` em < 1 s).
4. **Verifique observabilidade**: o próximo `synthetic-probe` (≤ 5
   min depois) deve gravar `target: "upstash-redis", status: "ok"`
   em `cron_runs`; `/api/health/deep` deve retornar
   `checks.upstashRedis.ok: true`.
5. **Post-mortem curto** — documente por que o keep-alive falhou
   (provavelmente: `synthetic-probe` também estava parado; ver
   runbook `docs/runbooks/cron-job-failing.md`).

## Alternativa de longo prazo — upgrade de plano

O plano **Pay-as-you-go** do Upstash (~US$ 0,20 / 100k comandos) não
tem archival e tem SLA de uptime. Custo esperado com o tráfego atual
de rate limiting + keep-alive: US$ 1–3/mês. Upgrade deve ser avaliado
antes de qualquer lançamento público (ver `docs/go-live-checklist.md`
e `docs/operations/budget.md`).

## Histórico

| Data       | Evento                                                                    |
| ---------- | ------------------------------------------------------------------------- |
| 2026-04-17 | Free-tier provisionado (banco `clinipharma`, env vars no Vercel).         |
| 2026-04-18 | Email "final notice" — `dbsize = 0`. Causa-raiz: `@upstash/redis` não     |
|            | estava em `package.json`; rate limiter caía em in-memory silenciosamente. |
| 2026-04-18 | Pacotes instalados + `synthetic-probe` pingando a cada 5 min + token      |
|            | no Vercel marcado como `type=sensitive`.                                  |

## Arquivos relacionados

- `lib/redis.ts` — helper compartilhado (`getRedis`, `pingRedis`).
- `lib/rate-limit.ts` — consumidor principal do Redis.
- `app/api/cron/synthetic-probe/route.ts` — keep-alive de 5 min.
- `app/api/health/deep/route.ts` — surfaces de observabilidade.
- `tests/unit/lib/redis.test.ts` — cobertura do helper.
- `docs/runbooks/external-integration-down.md` — procedimento geral
  de integração externa caída.
