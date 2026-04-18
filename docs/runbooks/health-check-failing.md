# Runbook — `/api/health/*` retornando `degraded`

**Gravidade:** P2 (UptimeRobot abre incidente após 2 falhas consecutivas; se `ready` ficar vermelho por >5 min, escale para P1).

**Sintomas observados**

- UptimeRobot reporta `/api/health/ready` ou `/api/health/deep` como DOWN ou 503.
- `status-page.clinipharma.com.br` acende amarelo.
- Sentry issue `HealthCheckDegraded` com `tag:check=ready` ou `check=deep`.
- Painel Vercel → Functions → invocations do `/api/health/*` mostrando erros 503.

**Impacto no cliente**

- Navegação normal no app NÃO é afetada enquanto o DB estiver OK — o health é isolado.
- Se o `/api/health/ready` estiver 503 por DB unreachable, requests do app também vão falhar em paralelo: o health é só o sintoma.
- Dependências downstream (Asaas / Clicksign / Resend) marcadas como OPEN nos circuit breakers → webhooks e emails backlog.

---

## Primeiros 5 minutos

1. **Determinar qual camada falhou.**

   ```bash
   curl -si https://clinipharma.com.br/api/health/live    | head -3
   curl -si https://clinipharma.com.br/api/health/ready   | head -3
   # deep é restrito — use o CRON_SECRET:
   curl -si -H "Authorization: Bearer $CRON_SECRET" \
        https://clinipharma.com.br/api/health/deep
   ```

   - `live` 200 → processo está vivo. Nunca deve falhar fora de deploy.
   - `ready` 503 → DB, env ou circuit breaker. Veja abaixo.
   - `deep` 503 → cron freshness, webhook backlog ou upstream.

2. **Ler o campo `checks` do JSON de resposta** — cada sub-check vem com `ok`, `latencyMs` e `error`:

   ```json
   {
     "checks": {
       "env": { "ok": true },
       "database": { "ok": false, "error": "connection refused" },
       "circuits": { "ok": false, "error": "Open circuits: asaas" }
     }
   }
   ```

3. **Se `checks.database.ok === false`** → pule para `database-unavailable.md`.

4. **Se `checks.circuits.ok === false`** → pule para `external-integration-down.md` com o serviço apontado.

5. **Se `checks.env.ok === false`** → vars críticas sumiram no Vercel. Abra Vercel → Project → Settings → Environment Variables e confirme `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Restaure a partir do backup em `docs/execution-log.md` (procure por `Vercel secrets inventory`).

---

## Diagnóstico aprofundado

### A. `cronFreshness` degradado (apenas `deep`)

```sql
-- Última execução de cada job e sua idade.
SELECT job_name,
       max(started_at) FILTER (WHERE status = 'success') AS last_success,
       now() - max(started_at) FILTER (WHERE status = 'success') AS age
  FROM public.cron_runs
 GROUP BY job_name
 ORDER BY age DESC NULLS FIRST;
```

- Se um job está > 2h sem sucesso (ou > 25h para diários): consulte `cron-job-failing.md`.
- Se NENHUM job aparece: Vercel Cron provavelmente pausado; verifique em **Vercel → Cron Jobs**.

### B. `webhookBacklog` degradado (apenas `deep`)

```sql
-- Falhas de webhook por fonte na última hora.
SELECT source, count(*) AS failures
  FROM public.webhook_events
 WHERE status = 'failed'
   AND received_at > now() - interval '1 hour'
 GROUP BY source
 ORDER BY failures DESC;
```

- Qualquer `source` com > 10 falhas/hora → abra `webhook-replay.md` com o nome do source.

### C. `circuits` com estado `OPEN`

```bash
# Estado atual dos breakers (via /api/health/ready):
curl -s https://clinipharma.com.br/api/health/ready | jq '.checks.circuits'
```

- Nome do breaker ≠ serviço remoto? O mapeamento está em `lib/circuit-breaker.ts` — o alvo de cada `name` (`asaas`, `clicksign`, `resend`) é evidente.
- Siga `external-integration-down.md`.

### D. Métricas in-process (apenas `deep`)

```bash
# Exposição Prometheus — contadores da instância que respondeu:
curl -s -H "Authorization: Bearer $CRON_SECRET" \
     'https://clinipharma.com.br/api/health/deep?format=prometheus'
```

Procure por:

- `csrf_blocked_total` > 30/min → runbook `csrf-block-surge.md`.
- `rbac_rpc_errors_total` > 5 em 5 min → runbook `rbac-permission-denied.md`.
- `cron_run_total{status="failed"}` → `cron-job-failing.md`.

---

## Mitigação

### Desabilitar o deep endpoint sob pressão

Se `/api/health/deep` estiver CARO demais (queries de `cron_runs` pesando) e nós não precisamos da informação agora, desligue o flag:

```sql
UPDATE public.feature_flags
   SET enabled = false
 WHERE key = 'observability.deep_health';
```

Resposta passa a ser 200 com `{status:'disabled'}` — monitores continuam felizes, só perdemos o detalhamento.

### Forçar circuito HALF_OPEN

Os circuit breakers se auto-recuperam após `recoveryTimeMs` (30s padrão). Se precisar acelerar (p. ex. após confirmar que o upstream voltou), hot-reload a instância:

```bash
# Dispara uma nova revisão Vercel sem mudar código:
vercel --prod --force
```

---

## Correção

- **DB intermitente:** abra ticket com Supabase (dashboard → Support), eles têm SLO de resposta de 1h no plano Pro.
- **Env var sumida:** reaplique via `vercel env add <NAME> production` e faça um novo deploy para propagar.
- **Webhook backlog crônico:** aumente o worker do sender (Asaas/Clicksign) para absorver pico OU enfileire em Inngest (`scheduleInngestRetry`).

## Post-incident

- Adicione timeline ao GitHub issue `incident:<id>` com os timestamps dos checks.
- Se detectou uma métrica nova que teria ajudado a diagnosticar mais rápido, adicione-a em `lib/metrics.ts` e expose via `/api/health/deep`.
- Revise o threshold do UptimeRobot se o tempo de detecção foi > 3 min.

## Links

- Dashboard Vercel Function: `/api/health/*` runs → `https://vercel.com/_your_team_/clinipharma/functions`
- Sentry project: `https://sentry.io/_your_org_/clinipharma`
- Supabase SQL editor (prod): `https://supabase.com/dashboard/project/jomdntqlgrupvhrqoyai/sql/new`
- Runbooks relacionados: `database-unavailable.md`, `external-integration-down.md`, `cron-job-failing.md`, `webhook-replay.md`.
