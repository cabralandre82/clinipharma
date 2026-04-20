# Runbook — Cron job failing (cronFreshness degraded)

**Gravidade:** 🟠 P2 (cron de 15-min stale > 2h) · 🔴 P1 (cron diário stale > 25h OR cron de compliance: `verify-audit-chain`, `backup-freshness`, `rls-canary`, `rotate-secrets`, `dsar-sla-check`).
**Alerta de origem:** `/api/health/deep` retorna `checks.cronFreshness.ok: false`; Sentry `CronStale` com array de jobs.
**SLO:** triage < 10 min · recuperação < 1 h · se P1 (compliance cron), recuperação < 30 min.
**Owner:** on-call engineer.

---

## 0. Companion skill

[`.cursor/skills/health-check-triage/SKILL.md`](../../.cursor/skills/health-check-triage/SKILL.md)
— entry point. Este runbook é o destino quando `cronFreshness.ok === false`.

---

## 1. Contexto: como crons rodam

- Execução via **Vercel Cron** (definido em `vercel.json`).
- 19 crons em produção (ver lista em `.cursor/skills/health-check-triage/SKILL.md` §3 ou `vercel.json`).
- Cada execução é registrada em `public.cron_runs`:
  - `job_name` (path sem `/api/cron/`)
  - Colunas: `started_at`, `completed_at`, `cron_runs.duration_ms`
  - `status`: `running` | `success` | `failed` | `timed_out`
  - `error` quando aplicável
- Distributed lock via Upstash Redis (`lib/cron/guarded.ts`) evita double-run (TTL = schedule interval).

## 2. Sintomas observados

```json
// /api/health/deep
{
  "checks": {
    "cronFreshness": {
      "ok": false,
      "stale": ["dsar-sla-check", "verify-audit-chain"],
      "maxAgeMs": 9200000
    }
  }
}
```

Ou Sentry: `CronStale { jobs: [...], oldestAgeMin: 155 }`.

---

## 3. Impacto

Depende fortemente de qual cron:

| Cron                                | Cadência     | Se stale                                  | Impacto                        |
| ----------------------------------- | ------------ | ----------------------------------------- | ------------------------------ |
| `/api/cron/verify-audit-chain`      | diário 03:45 | integridade de auditoria sem verificação  | **P1 — compliance**            |
| `/api/cron/backup-freshness`        | 4x/dia       | não sabemos se backup rodou               | **P1 — LGPD Art. 46**          |
| `/api/cron/rls-canary`              | a cada 30min | isolamento de tenant sem verificação      | **P1 — multi-tenancy**         |
| `/api/cron/rotate-secrets`          | diário       | rotação programada pode atrasar           | **P2 — security posture**      |
| `/api/cron/dsar-sla-check`          | a cada 1h    | DSAR pode estourar SLA de 15d             | **P1 — LGPD Art. 19**          |
| `/api/cron/money-reconcile`         | 30min        | drift entre cents e numeric não detectado | **P2**                         |
| `/api/cron/rate-limit-report`       | 15min        | spike de abuse não alertado               | **P2**                         |
| `/api/cron/stale-orders`            | 15min        | pedidos presos sem aviso                  | P3                             |
| `/api/cron/synthetic-probe`         | 5min         | L1 synthetic parou                        | P3 (L2 externo cobre)          |
| `/api/cron/churn-check`             | diário       | score desatualizado                       | P3                             |
| `/api/cron/reorder-alerts`          | diário       | alerta de estoque perdido                 | P3                             |
| `/api/cron/coupon-expiry-alerts`    | diário       | cupom expira silencioso                   | P3                             |
| `/api/cron/enforce-retention`       | diário       | retenção 1 dia atrasada                   | P3 (não-crítico em uma janela) |
| `/api/cron/purge-drafts`            | diário       | limpeza de rascunhos                      | P3                             |
| `/api/cron/purge-server-logs`       | diário       | logs antigos acumulam                     | P3                             |
| `/api/cron/purge-revoked-tokens`    | diário       | tokens revogados permanecem               | P3                             |
| `/api/cron/revalidate-pharmacies`   | diário       | inválidas não detectadas                  | P3                             |
| `/api/cron/product-recommendations` | diário       | recomendações desatualizadas              | P3                             |
| `/api/cron/expire-doc-deadlines`    | diário       | documentos vencendo sem aviso             | P3                             |

**Regra de ouro:** cron de compliance/integridade atrasado = P1 automático.

---

## 4. Primeiros 10 minutos

### 4.1 — Lista completa de freshness

```sql
select job_name,
       max(started_at) filter (where status = 'success') as last_success,
       max(started_at) as last_attempt,
       now() - max(started_at) filter (where status = 'success') as age,
       count(*) filter (where status = 'failed'
                          and started_at > now() - interval '6 hours') as fails_6h
  from public.cron_runs
 group by job_name
 order by age desc nulls first;
```

Thresholds para alerta:

- Cron de 15min: `age > 2h` → stale.
- Cron de hora: `age > 4h` → stale.
- Cron diário: `age > 25h` → stale.
- `NULL` last_success **E** `last_attempt NULL` → cron nunca rodou (config problem).

### 4.2 — Última falha com erro

```sql
select job_name, started_at, status, error, duration_ms
  from public.cron_runs
 where status in ('failed', 'timed_out')
   and started_at > now() - interval '24 hours'
 order by started_at desc
 limit 20;
```

### 4.3 — Vercel Cron config

Dashboard → Project → Cron Jobs. Verifique:

- [ ] Cron está listado (presente em `vercel.json`)?
- [ ] Schedule está correto?
- [ ] Último "Next run" está no futuro próximo?
- [ ] Alguma invocação recente? (Vercel também mostra execuções)

Se "Cron Jobs" mostra erro de deploy: `vercel.json` tem sintaxe inválida ou
excedeu o limite de crons do plano (Pro = 100, Hobby = 2).

---

## 5. Causas comuns + mitigação

### 5.A — Vercel Cron pausado / não configurado

Sintoma: NENHUM cron aparece em `cron_runs` nas últimas 24h.

```bash
# Verifique config
cat vercel.json | jq '.crons'
```

Se a config é correta mas Vercel mostra nada: contato Vercel Support (plano
Pro SLA: 24h).

Ação rápida: disparar cron manualmente com `CRON_SECRET`:

```bash
curl -X GET -H "Authorization: Bearer $CRON_SECRET" \
  https://clinipharma.com.br/api/cron/<job-name>
```

### 5.B — Cron retornando erro

Pegue o erro em `cron_runs.error` (§4.2). Categorias:

| Erro                    | Causa                            | Ação                                   |
| ----------------------- | -------------------------------- | -------------------------------------- |
| `ECONNREFUSED` Supabase | DB down                          | Runbook `database-unavailable.md`      |
| `Circuit X opened`      | Integração externa               | Runbook `external-integration-down.md` |
| `TIMEOUT after Nms`     | Query lenta ou volume inesperado | §5.C                                   |
| `permission denied`     | Role / RLS                       | Ver `rbac-permission-denied.md`        |
| `Lock already held`     | Distributed lock preso           | §5.D                                   |

### 5.C — Cron timeout (ficou pendurado)

Vercel Cron tem timeout de **5 min** (Pro) ou **10 s** (Hobby). Se o volume
cresceu, o cron pode estar executando além do budget.

Estratégias:

1. **Paginar o trabalho** — cron faz N-sized batches, agenda próximo ciclo
   para continuar (padrão usado em `enforce-retention`).
2. **Parallelizar via Inngest** — offload dos chunks para worker durável.
3. **Aumentar timeout via function config**:
   ```json
   // vercel.json
   {
     "functions": {
       "app/api/cron/<job>/route.ts": { "maxDuration": 300 }
     }
   }
   ```

### 5.D — Distributed lock preso (double-run protection failed)

```sql
-- Locks ativos (Upstash Redis — ver via upstash console)
-- chave: cron:lock:<job_name>
```

Se o lock ficou preso porque cron crashou sem release:

```bash
# Deletar manualmente (ATENÇÃO: dupla execução pode acontecer se outro processo está segurando)
curl https://<upstash-endpoint>/del/cron:lock:<job-name> \
  -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN"
```

Solução definitiva: revisar `lib/cron/guarded.ts` — garantir `try/finally`
que sempre libera o lock mesmo em erro.

### 5.E — Migration incompleta

Alguns crons dependem de tabela/função criada em migration específica. Se
migration não aplicou (rare), cron fica em fail loop com `relation does not exist`.

```sql
select name, inserted_at
  from supabase_migrations.schema_migrations
 order by inserted_at desc
 limit 10;
```

Cross-reference com `git log supabase/migrations/`. Se faltando: aplicar via
Supabase CLI.

---

## 6. Mitigação manual (emergência)

Disparar cron de integridade manualmente **imediatamente** se é um P1:

```bash
# verify-audit-chain (P1 se > 25h)
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://clinipharma.com.br/api/cron/verify-audit-chain | jq

# backup-freshness
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://clinipharma.com.br/api/cron/backup-freshness | jq

# rls-canary
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://clinipharma.com.br/api/cron/rls-canary | jq

# dsar-sla-check
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://clinipharma.com.br/api/cron/dsar-sla-check | jq
```

Cada um retorna JSON. Se retornar `{ ok: true }`, documentou a execução e
o reloj fica em dia. Se retornar erro, é a pista concreta para §5.

---

## 7. Verificação pós-mitigação

- [ ] Cron específico aparece em `cron_runs` com `status=success` recente.
- [ ] `/api/health/deep` com `cronFreshness.ok: true`.
- [ ] Vercel dashboard mostra próxima execução agendada.
- [ ] Para crons de compliance (P1): rodou completo no ciclo seguinte sem intervenção.

---

## 8. Post-mortem

Obrigatório para:

- Cron de compliance stale > SLO (ver §3).
- Cron down > 24h.
- Causa raiz foi mudança de código (regressão, não infra externa).

Template: [`.github/ISSUE_TEMPLATE/postmortem.md`](../../.github/ISSUE_TEMPLATE/postmortem.md).

---

## 9. Prevenção

- **Alerta proativo:** `/api/health/deep` já reporta freshness; UptimeRobot
  deve alertar P2 se `cronFreshness.ok=false` por > 15 min.
- **Distributed lock com `try/finally`** em `lib/cron/guarded.ts`.
- **Timeout defensivo** em toda query dentro de cron (`.abortSignal(AbortSignal.timeout(...))`).
- **Rollout canário** de crons novos — rodar 1 semana em staging primeiro
  antes de produção.

---

## Links

- Config: `vercel.json` (seção `crons`)
- Tabela: `public.cron_runs`
- Lock: `lib/cron/guarded.ts`
- Route files: `app/api/cron/<job>/route.ts`
- Related:
  - [`health-check-failing.md`](./health-check-failing.md)
  - [`database-unavailable.md`](./database-unavailable.md)
  - [`external-integration-down.md`](./external-integration-down.md)
  - [`cron-double-run.md`](./cron-double-run.md)

---

_Owner: solo operator · Última revisão: 2026-04-20_
