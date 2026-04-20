# Runbook — Database unavailable (`/api/health/ready` DB check failing)

**Gravidade:** 🔴 P1 — full platform outage (DB é dependência dura de todas as rotas autenticadas).
**Alerta de origem:** UptimeRobot 503 em `/api/health/ready`, ou Sentry `ECONNREFUSED` / `57P03` (database starting up) / `53300` (too many connections).
**SLO:** triage < 5 min · mitigação < 15 min · RTO < 30 min.
**Owner:** on-call engineer. Se > 10 min sem progresso, escalar para Supabase Support (plano Pro SLA: 1 h primeira resposta).

> **Este runbook é o fundo da pirâmide.** Quase todo outro runbook depende
> do DB estar funcionando. Resolve isso primeiro; o resto é ruído correlato.

---

## 0. Companion skill

[`.cursor/skills/health-check-triage/SKILL.md`](../../.cursor/skills/health-check-triage/SKILL.md)
— se o gatilho foi `/api/health/*` degraded, use o skill para roteamento.
Este runbook é o destino quando `checks.database.ok === false`.

---

## 1. Sintomas observados

- UptimeRobot: DOWN em `https://clinipharma.com.br/api/health/ready`.
- Sentry: spike de `Error: connect ECONNREFUSED`, `connection terminated unexpectedly`, `Client has encountered a connection error`.
- `/api/health/ready` retorna 503 com:
  ```json
  { "checks": { "database": { "ok": false, "error": "<msg>", "latencyMs": <N> } } }
  ```
- Aplicação: cascata de 500s em qualquer rota com fetch Supabase.
- Circuit breakers externos (`asaas`, `clicksign`, `resend`) provavelmente não afetados — são isolados.

---

## 2. Impacto no cliente

- **Usuário final:** login falha, nenhuma tela carrega (SSR depende do DB).
- **B2B:** cron jobs não rodam; pedidos parados; notificações pendentes
  acumulam na fila.
- **Dados:** **nenhuma perda** — Supabase Point-in-Time Recovery cobre a janela.
- **Financeiro:** receita parada enquanto o app estiver fora. Checkout-flow
  para farmácias emite 500, cliente pode tentar de novo sem duplicar.

---

## 3. Primeiros 5 minutos (triage)

### 3.1 — Determinar a camada

```bash
# 1. Processo vivo?
curl -si https://clinipharma.com.br/api/health/live  | head -3
# esperado: 200 OK. Se 503 → é deploy problem, NÃO database. Vá para runbook diferente.

# 2. DB reachable?
curl -si https://clinipharma.com.br/api/health/ready | head -10

# 3. Detalhe do erro (deep exige CRON_SECRET)
curl -si -H "Authorization: Bearer $CRON_SECRET" \
  https://clinipharma.com.br/api/health/deep
```

### 3.2 — Classificar o erro

| Erro                                       | Causa provável                              | Ação                       |
| ------------------------------------------ | ------------------------------------------- | -------------------------- |
| `ECONNREFUSED`                             | Supabase instance down ou network partition | §4.1 — Supabase status     |
| `connection terminated unexpectedly`       | DB restart em andamento (patch manutenção)  | §4.1 — Supabase status     |
| `53300 too many connections`               | Connection pool exhaustion                  | §4.2 — pool bloat          |
| `57P03 the database system is starting up` | DB iniciando (manutenção ativa)             | Esperar 2-3 min + §4.1     |
| `timeout` / `latencyMs > 5000`             | Overload ou query runaway                   | §4.3 — query storm         |
| `42501 permission denied`                  | RLS/role issue, NÃO availability            | Runbook `rls-violation.md` |

### 3.3 — Issue tracker

```bash
gh issue create \
  --title "P1 — Database unavailable ($(date -u +%FT%TZ))" \
  --label "incident,severity:p1,infra,database" \
  --body "/api/health/ready response:
<paste>

Supabase dashboard: https://supabase.com/dashboard/project/jomdntqlgrupvhrqoyai
UptimeRobot: https://uptimerobot.com/dashboard
Started: $(date -u +%FT%TZ)"
```

---

## 4. Diagnóstico

### 4.1 — Ground truth: Supabase status

Primeira coisa a olhar, sempre:

- **Supabase status page:** <https://status.supabase.com/> — se há incidente ativo, espere.
- **Supabase project dashboard:** verificar
  - Database > Health: CPU, memory, connections.
  - Logs > Postgres logs: últimos eventos.
  - Settings > Usage: não atingiu limite de compute?
- **Network:** <https://www.supabase.com/docs/guides/platform/network-restrictions> — nenhuma restriction recente?

Se Supabase status mostra incidente: **não há ação técnica nossa**; apenas
comunicar internamente e aguardar ETA do provedor. Status page atualiza a
cada 5 min.

### 4.2 — Connection pool exhaustion (código de erro `53300`)

Clientes Supabase/Postgres abrindo conexões sem fechar.

```sql
-- Via Supabase SQL Editor
select usename, application_name, state, count(*)
  from pg_stat_activity
 where state != 'idle'
 group by 1, 2, 3
 order by count(*) desc;
```

Se uma aplicação aparece com >100 conexões ativas, é leak. Soluções:

1. **Kill conexões idle-in-transaction > 5 min:**
   ```sql
   select pg_terminate_backend(pid)
     from pg_stat_activity
    where state = 'idle in transaction'
      and now() - state_change > interval '5 minutes';
   ```
2. **Restart da instância Vercel Serverless** (provoca reconexão limpa):
   ```bash
   vercel redeploy --prod --force --token="$VERCEL_TOKEN"
   ```
3. **Escalonar plano Supabase** se o pool_size está dimensionado para a
   carga real — Supabase Pro = 40 connections, Team = 200.

### 4.3 — Query storm / slow query

```sql
select pid, now() - query_start as runtime, state, query
  from pg_stat_activity
 where state = 'active'
   and now() - query_start > interval '30 seconds'
 order by runtime desc
 limit 20;
```

Se uma query está rodando > 1 min, provavelmente trava o pool:

```sql
-- Kill a query específica (pid do resultado acima)
select pg_cancel_backend(<pid>);
-- Escalada: pg_terminate_backend(<pid>) se cancel não funcionar
```

Investigue o código responsável depois — adicione index, paginação, ou
timeout explícito no client.

### 4.4 — Env vars missing

Se o erro é "SUPABASE_URL is undefined" em vez de connect refused:

```bash
# Check Vercel env
vercel env ls production --token="$VERCEL_TOKEN" | grep -i supabase
```

Variáveis mandatórias:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL` (direct connection, fallback)

Se faltando, restaurar de `docs/execution-log.md` § "Vercel secrets inventory".

---

## 5. Mitigação

### 5.A — Esperar recuperação automática

Se a causa é Supabase-side (restart, deploy, patch), o circuit breaker do
`@supabase/supabase-js` reconecta automaticamente quando a instância volta.
SLA típico Supabase Pro: < 5 min para recoverar de restart.

Manter o sistema rodando durante o outage tem pouco custo — requests
falham rápido, não consomem pool.

### 5.B — Force redeploy

Útil quando o problema é state-in-memory (pool leak, cached bad connection):

```bash
vercel redeploy --prod --force \
  --token="$VERCEL_TOKEN" \
  --scope="$VERCEL_ORG_ID"
```

Cada serverless function cold-start abre pool novo. Tempo: ~2 min para
propagar.

### 5.C — Escalar plano Supabase (emergência)

Se o problema é compute/connection limit:

```
Supabase Dashboard → Settings → Billing → Upgrade plan
```

Upgrade Pro → Team: disponibilidade em ~5 min. Custo: +R$ 500/mês (ajustar
para baixo depois do pico).

### 5.D — Fallback para manutenção (último recurso)

Se > 30 min sem progresso e outage é externo:

```bash
# Ativar página de manutenção (se tiver sido construída)
# Flag: ops.maintenance_mode=true (ver docs/runbooks/_future_maintenance_page)
```

**Nota:** não temos maintenance mode instalado hoje (Wave 15 backlog).
Alternativa atual: redirect no Vercel via config.

---

## 6. Verificação pós-mitigação

- [ ] `/api/health/ready` retorna 200 + `checks.database.ok: true`.
- [ ] `/api/health/deep` retorna 200 + todos os sub-checks verdes.
- [ ] Latência p95 de query representativa < 500ms (ver Sentry performance).
- [ ] Nenhum cron em `cron_runs` com status=failed nos últimos 15 min.
- [ ] Taxa de 500s em Sentry voltou ao baseline.

---

## 7. Post-mortem

Obrigatório para qualquer outage > 5 min. Template:
[`.github/ISSUE_TEMPLATE/postmortem.md`](../../.github/ISSUE_TEMPLATE/postmortem.md).

Arquivo final em `docs/incidents/YYYY-MM-DD-db-unavailable.md`.

---

## 8. Prevenção

Após cada incidente, reforce:

- **Métrica:** `db_connection_pool_usage{state}` no `/api/health/deep` — já
  emitida. Adicionar alerta se > 80% por > 5 min.
- **Timeout defensivo** em todas as queries via `lib/db/server.ts`.
- **Connection pooling review** trimestral — verificar `pg_stat_activity`
  durante pico de carga.
- **Load test** anual simulando pool exhaustion (k6 → `tests/load/`).

---

## Links

- Supabase Dashboard: <https://supabase.com/dashboard/project/jomdntqlgrupvhrqoyai>
- Supabase Status: <https://status.supabase.com/>
- Pool monitoring: `app/api/health/deep/route.ts`
- Code:
  - `lib/db/server.ts` — server-side Supabase client
  - `lib/db/client.ts` — browser Supabase client
  - `lib/db/admin.ts` — service-role admin client
- Related runbooks:
  - [`health-check-failing.md`](./health-check-failing.md)
  - [`cron-job-failing.md`](./cron-job-failing.md) (DB outage frequently cascades into cron failures)

---

_Owner: solo operator · Última revisão: 2026-04-20_
