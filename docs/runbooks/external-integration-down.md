# Runbook — External integration down (circuit OPEN)

**Gravidade:** 🟠 P2 (single vendor, degradação isolada) · 🔴 P1 (2+ vendors simultâneos OU payment path bloqueado em horário comercial)
**Alerta de origem:** `/api/health/ready` retorna `checks.circuits.ok: false` com nome do breaker; Sentry issue `Circuit ${name} opened`.
**SLO:** triage < 10 min · mitigação ou aceitação documentada < 1 h.
**Owner:** on-call engineer. DPO envolvido se o integrador processa dados pessoais.

---

## 0. Companion skill

[`.cursor/skills/health-check-triage/SKILL.md`](../../.cursor/skills/health-check-triage/SKILL.md)
— ponto de entrada. Este runbook é o destino quando `circuits.ok === false`.

---

## 1. Integradores críticos (mapa)

| Circuit name | Upstream                   | Usado para                         | Impacto se DOWN                                      |
| ------------ | -------------------------- | ---------------------------------- | ---------------------------------------------------- |
| `asaas`      | asaas.com.br (pagamentos)  | Boletos, PIX, cartão recorrente    | Pedidos não cobrados; webhooks em retry queue        |
| `clicksign`  | clicksign.com (assinatura) | DPA com clínicas, termos de adesão | Onboarding B2B travado                               |
| `resend`     | resend.com (e-mail)        | Transacional (DSAR, breach, auth)  | Nenhum e-mail sai; DLQ cresce                        |
| `openai`     | api.openai.com             | OCR documentos, churn score        | AI jobs falham e ficam pending                       |
| `sentry`     | sentry.io                  | Observabilidade                    | Perda de rastreio; app funciona normal               |
| `upstash`    | upstash.com (Redis)        | Rate-limit, cron lock, cache       | **P1** — rate-limit desligado, cron double-run risco |

Código: `lib/circuit-breaker.ts` (implementação). Config por serviço em
`lib/integrations/*`.

---

## 2. Sintomas observados

- `/api/health/ready` com:
  ```json
  { "checks": { "circuits": { "ok": false, "error": "Open circuits: asaas" } } }
  ```
- Sentry: `Circuit asaas opened after 5 consecutive failures`.
- Métrica: `circuit_state{name} = 2` (0=CLOSED, 1=HALF_OPEN, 2=OPEN).
- Requests ao endpoint correspondente falham com erro rápido (short-circuit)
  em vez de esperar timeout — isso é o comportamento desejado, não é bug.
- DLQ / webhook_events: acumula `status=failed` para o source afetado.

---

## 3. Impacto no cliente

Por integrador:

| Circuit     | Impacto direto               | Graceful degradation                            |
| ----------- | ---------------------------- | ----------------------------------------------- |
| `asaas`     | Checkout novo pedido falha   | Usuário recebe erro claro; pode tentar em 5 min |
| `clicksign` | Assinatura de contrato pausa | Banner "processando"; auto-retry quando fechar  |
| `resend`    | E-mails pendentes            | DLQ retém; reenvia quando voltar                |
| `openai`    | OCR / AI pending             | Campo vazio; usuário digita manual              |
| `upstash`   | Rate-limit desligado         | **CRÍTICO** — sem proteção contra abuso         |

---

## 4. Primeiros 10 minutos

### 4.1 — Identificar qual circuito

```bash
curl -s https://clinipharma.com.br/api/health/ready | jq '.checks.circuits'
```

Output esperado quando OPEN:

```json
{
  "ok": false,
  "error": "Open circuits: asaas",
  "states": { "asaas": "OPEN", "clicksign": "CLOSED", "resend": "CLOSED" }
}
```

### 4.2 — Checar o upstream real

Cada vendor tem status page pública:

| Vendor    | Status page                     |
| --------- | ------------------------------- |
| Asaas     | <https://status.asaas.com/>     |
| Clicksign | <https://status.clicksign.com/> |
| Resend    | <https://status.resend.com/>    |
| OpenAI    | <https://status.openai.com/>    |
| Sentry    | <https://status.sentry.io/>     |
| Upstash   | <https://status.upstash.com/>   |
| Supabase  | <https://status.supabase.com/>  |

Se o vendor confirma incidente: **não há ação técnica**; registre a decisão
de aguardar + monitore ETA.

### 4.3 — Abrir issue tracker

```bash
gh issue create \
  --title "P2 — Circuit <name> OPEN ($(date -u +%FT%TZ))" \
  --label "incident,severity:p2,integration,<vendor>" \
  --body "Circuit state:
$(curl -s https://clinipharma.com.br/api/health/ready | jq '.checks.circuits')

Vendor status page: <url>
Started: $(date -u +%FT%TZ)"
```

---

## 5. Diagnóstico

### 5.1 — Logs da falha

Hoje não temos uma tabela dedicada `integration_call_logs` persistindo todo
chamado (backlog). As fontes de verdade são:

- **Sentry:** busca por `service:asaas` / `service:clicksign` / etc. nos
  últimos 60 min — agrupa por status code.
- **`webhook_events`** (quando aplicável — vendors que nos chamam):
  ```sql
  select source, status, count(*) as total,
         min(received_at) as oldest,
         max(received_at) as newest
    from public.webhook_events
   where received_at > now() - interval '1 hour'
   group by 1, 2;
  ```
- **Vercel function logs:** logs detalhados de cada call vão para o
  runtime log agregado por request id (útil quando o cliente é server-side).

Padrões típicos:

- `status_code IN (500, 502, 503, 504)` repetido → vendor tem incident.
- `status_code = 401 / 403` → **credencial expirou ou foi revogada** — verifique `.cursor/skills/secret-rotate/SKILL.md`.
- `status_code = 429` → rate-limit deles → ver §6.A.
- `status_code = 0` / `timeout` → network ou vendor.

### 5.2 — Webhook backlog (se aplicável)

```sql
select source, status, count(*)
  from public.webhook_events
 where received_at > now() - interval '1 hour'
 group by 1, 2
 order by source;
```

Se `failed` > 50 para um source, ativar replay após vendor voltar (runbook
`webhook-replay.md`).

---

## 6. Mitigação

### 6.A — Esperar vendor (padrão quando vendor confirma incident)

O circuit breaker faz a coisa certa sozinho:

- OPEN → HALF_OPEN após `recoveryTimeMs` (30s default).
- HALF_OPEN → CLOSED se próxima chamada OK.
- CLOSED retoma tráfego normal.

Não precisa intervir. Monitore `/api/health/ready` a cada 5 min.

### 6.B — Forçar HALF_OPEN (vendor já voltou, breaker ainda esperando)

```bash
# Redeploy limpa o in-memory state dos breakers
vercel redeploy --prod --force --token="$VERCEL_TOKEN"
```

### 6.C — Disable via feature flag (se vendor tem kill-switch)

Alguns integradores têm kill-switch explícito (ex.: `alerts.email_enabled`
para Resend, `security.turnstile_enforce` para Cloudflare Turnstile).
Nesses casos:

```sql
-- Exemplo: parar temporariamente envio de e-mail P2/P3 via Resend
-- (alerts P1 ainda caem pelo caminho PagerDuty se configurado)
update public.feature_flags set enabled = false
 where key = 'alerts.email_enabled';
```

Nem todo integrador tem kill-switch dedicado. Consultar
`supabase/migrations/048_observability_alerts.sql` e migrations
correlatas para a lista completa de flags disponíveis. Se não tem flag
nativa, vai para §6.D (rotação de credencial) ou apenas aceitar a
degradação enquanto o vendor se recupera.

### 6.D — Rotate credential (se o problema é 401/403)

Ver skill [`.cursor/skills/secret-rotate/SKILL.md`](../../.cursor/skills/secret-rotate/SKILL.md)
ou [`.cursor/skills/secret-compromise/SKILL.md`](../../.cursor/skills/secret-compromise/SKILL.md)
conforme o caso.

### 6.E — Upstash DOWN (caso especial — P1)

Sem Redis:

- Rate-limit desliga → abre a porta para abuse.
- Cron distributed lock desliga → risco de double-run.
- Feature flag cache desliga → DB carrega mais.

Ação imediata:

1. **Enable Cloudflare rate-limiting** no edge para rotas críticas (auth,
   checkout, form public).
2. **Pausar crons não-essenciais** em `vercel.json` via dashboard (manter
   só os de integridade: `verify-audit-chain`, `backup-freshness`).
3. Escalar para Upstash Support (plano Pay-As-You-Go tem SLA 4h).

---

## 7. Verificação pós-mitigação

- [ ] `/api/health/ready` com `circuits.ok: true`.
- [ ] Último chamado bem-sucedido ao vendor em `integration_call_logs`.
- [ ] Webhooks backlog < 10 para o source afetado.
- [ ] DLQ drenada (ver runbook `webhook-replay.md` se necessário).

---

## 8. Post-mortem

Obrigatório se:

- Durou > 30 min em horário comercial.
- Afetou payment path (Asaas) ou compliance (Clicksign para DPA).
- Foi revelado um problema na nossa integração (não no vendor).

Template: [`.github/ISSUE_TEMPLATE/postmortem.md`](../../.github/ISSUE_TEMPLATE/postmortem.md).

---

## 9. Anti-patterns

- **Nunca retry sem circuit breaker.** Se algum lugar do código faz
  `fetch` sem passar pelo helper em `lib/integrations/<vendor>.ts`, é bug.
- **Nunca aumentar `recoveryTimeMs` para "evitar alerta".** Se o vendor
  é genuinamente instável, documente e ajuste SLO esperado.
- **Nunca bypassar circuit com `if (service_down) skip;`** — isso mascara
  degradação; deixe o erro aparecer para o user + retry automático.
- **Nunca chamar o DPO primeiro** se não houve exposição de dados. O DPO
  só entra quando há implicação LGPD.

---

## Links

- `lib/circuit-breaker.ts` — implementação do breaker
- `lib/asaas.ts`, `lib/clicksign.ts`, `lib/resend.ts` — clients com breaker embutido
- `lib/alerts.ts` — roteamento de alertas P0/P1 para PagerDuty e-mail
- Migrations relacionadas:
  - `supabase/migrations/045_webhook_cron_hardening.sql` — tabela `webhook_events`
  - `supabase/migrations/048_observability_alerts.sql` — flags de alerta
- Related:
  - [`webhook-replay.md`](./webhook-replay.md)
  - [`health-check-failing.md`](./health-check-failing.md)
  - [`cron-job-failing.md`](./cron-job-failing.md)

---

_Owner: solo operator · Última revisão: 2026-04-20_
