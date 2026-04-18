# Runbook — enxurrada de alertas (PagerDuty ou email) fora de incidente real

**Gravidade:** P2 (ruído custa confiança — alertas que o time ignora matam o canal).

**Sintomas observados**

- PagerDuty dispara dezenas de incidentes para o mesmo `dedup_key` em poucos minutos.
- `OPS_ALERT_EMAIL` recebe >10 emails/hora com mesmo `component`.
- Operador observa que o "alerta real" está enterrado em ruído.
- `alerts_triggered_total` (via `/api/health/deep`) crescendo em batch de >5/minuto.

**Impacto no cliente**

- Nenhum direto. Impacto secundário: on-call pode ignorar um incidente real seguinte por **alert fatigue**.

---

## Primeiros 5 minutos — cortar o ruído

1. **Identifique o alertador** nas 3 fontes:
   - PagerDuty → Incidents → Filter por `dedup_key`.
   - Inbox do `OPS_ALERT_EMAIL` → filtrar por `Component:` no corpo.
   - Logs → `server_logs` com `module='alerts'` e `message='alert triggered'`:

     ```sql
     SELECT severity, title, component, dedup_key, count(*)
       FROM public.server_logs
      WHERE module = 'alerts'
        AND created_at > now() - interval '1 hour'
      GROUP BY severity, title, component, dedup_key
      ORDER BY count(*) DESC
      LIMIT 20;
     ```

2. **Kill-switch instantâneo** — desabilite a origem barulhenta:

   ```sql
   -- Corta emails de todas as origens:
   UPDATE public.feature_flags SET enabled=false WHERE key='alerts.email_enabled';

   -- Corta PagerDuty de todas as origens (mantém emails):
   UPDATE public.feature_flags SET enabled=false WHERE key='alerts.pagerduty_enabled';
   ```

   O TTL do cache de flags é 30s (ver `FEATURE_FLAG_CACHE_TTL_MS`) — aguarde meio minuto e confirme que os incidentes pararam de chegar.

3. **Se o componente barulhento for UM SÓ**, prefira ajustar o cooldown/threshold desse alertador em vez de cortar o canal inteiro. Ver "Mitigação" abaixo.

---

## Diagnóstico — identificar a raiz

### A. Cooldown muito curto?

O `lib/alerts.ts` usa 15 min de cooldown padrão por `dedupKey`. Se o mesmo `dedupKey` gera incidentes múltiplos em janela curta:

- Verifique o chamador — ele provavelmente está passando `dedupKey` dinâmico (ex.: incluindo timestamp). Rastreie no código:

  ```bash
  rg -n "triggerAlert" -g '!tests/**'
  ```

- `dedupKey` correto é determinístico (ex.: `circuit-breaker:asaas:open`, NÃO `circuit-breaker:asaas:open:${Date.now()}`).

### B. Surge detector disparando rápido demais?

`lib/metrics.ts::detectSurge` tem janelas declaradas nos consumidores:

- `lib/rbac/permissions.ts`: 3 erros em 5 min → P2.
- Outros surges futuros estarão sob `grep detectSurge lib/`.

Se o threshold parece baixo:

1. Levante-o no código (`RBAC_RPC_SURGE_THRESHOLD`).
2. Abra PR com justificativa no commit message.

### C. Condição de alerta errada?

Alguns alertas são "levantados" automaticamente por sintomas que nem sempre indicam incidente:

- Circuit breaker OPEN em Resend → normal durante pico de emails (pode auto-recuperar).
- `rbac_rpc_errors` após flip de `rbac.fine_grained=on` em usuários sem mapping → `rbac-permission-denied.md`.
- Webhook backlog após sender retry storm → `webhook-replay.md`.

Inspecione o `custom_details` do alerta — ele carrega contexto suficiente para distinguir anomalia real de churn normal.

---

## Mitigação

### Ajustar apenas UM componente

```bash
# 1. Anteceda o rollback com a criação de issue:
gh issue create -t "alerts noisy: $COMPONENT" -l incident

# 2. Localize o site de chamada:
rg -n "component: '$COMPONENT'" lib/
```

Ajuste o `severity` para um nível abaixo (`warning` → `info`) se o sintoma era informacional demais, ou aumente o threshold do surge detector.

### Silenciar PagerDuty temporariamente sem desativar flag

Remova a env var `PAGERDUTY_ROUTING_KEY` do Vercel em **Production** apenas:

```bash
vercel env rm PAGERDUTY_ROUTING_KEY production
# Trigger redeploy:
vercel --prod --force
```

Efeito: `triggerAlert` continua logando + emailando, mas PagerDuty fica muda.

### Resetar o estado de cooldown in-memory

O cooldown é por-instância e já se auto-limpa após `COOLDOWN_MS` (15 min). Não há necessidade de manipulação manual — se precisar de reset imediato, redesploie.

---

## Correção definitiva

- **Bad dedupKey:** remova qualquer componente dinâmico do key.
- **Threshold baixo:** calibre com base no pico normal observado nos últimos 30 dias (prefira percentil 99 + 20% de margem).
- **Severity errada:** não use `critical` para sintomas que não requerem reação noturna. Regra empírica:
  - `critical` → acorda on-call.
  - `error` → email durante horário comercial.
  - `warning` → log + painel de métricas.
  - `info` → log apenas (não usa `lib/alerts` — use `logger.info`).

## Post-incident

- Adicione ao changelog de `lib/alerts.ts` qualquer calibração nova.
- Se PagerDuty/email foram desabilitados, crie um reminder para reabilitar:

  ```bash
  gh issue create -t "re-enable alerts.*_enabled após fix de ruído" -l todo
  ```

- Se ficar claro que um componente emite alertas demais crônicos, refatore para emitir um _roll-up_ horário em vez de um evento por ocorrência.

## Links

- Painel PagerDuty (self-hosted): https://your-team.pagerduty.com/incidents
- Sentry: https://sentry.io/_your_org_/clinipharma
- Flags: `/admin/feature-flags` (prod)
- Código: `lib/alerts.ts`, `lib/metrics.ts`
- Runbooks relacionados: `csrf-block-surge.md`, `rbac-permission-denied.md`, `health-check-failing.md`.
