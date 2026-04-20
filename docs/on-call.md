# On-call protocol — solo operator edition

> **Este é o protocolo de on-call de uma plataforma operada por uma pessoa**
> assistida por agentes de IA. Não é NOC 24/7, não é PagerDuty rotation
> com 10 engenheiros. É pragmatismo consciente: saber o que alertar, o
> que ignorar até o próximo ciclo, e como transformar surpresas em rotina.

---

## 1. Premissa: tempo não é infinito

O operador solo tem 2 horas diárias de capacidade para operação (manhã +
final do dia), sem exceções. Tudo o mais precisa ou caber nesse budget
ou ser automatizado.

Isso significa:

- **Alertas são escassos.** Só alerta o que não pode esperar 12h.
- **Ritos são obrigatórios.** O que não vira alerta entra no daily/weekly.
- **Drift é inimigo.** Cada alerta silenciado sem fix é uma bomba-relógio.

Ver também:

- [`docs/SOLO_OPERATOR.md`](./SOLO_OPERATOR.md) — modelo geral
- [`docs/operations/cost-guard.md`](./operations/cost-guard.md) — ritmo semanal
- [`docs/operations/claims-audit.md`](./operations/claims-audit.md) — drift de documentação

---

## 2. Níveis de severidade

| Sev    | Quem acorda?                     | Tempo de resposta                                   | Canal de alerta                          |
| ------ | -------------------------------- | --------------------------------------------------- | ---------------------------------------- |
| **P0** | Sim, qualquer hora               | < 15 min                                            | Sentry push + SMS (UptimeRobot) + e-mail |
| **P1** | Não, mas primeira coisa de manhã | < 2 h OU antes das 10:00 local se aconteceu à noite | Sentry push + e-mail                     |
| **P2** | Não                              | Mesmo dia / < 24 h                                  | E-mail (digest 2×/dia)                   |
| **P3** | Não                              | Weekly ritual                                       | Só em issue tracker                      |

### Critérios P0 (wake up)

Apenas estes acordam o operador fora de horário:

- `rls-canary` violation **E** `rls_canary.page_on_violation=ON` → tenant isolation breach
- `data-breach-72h` iniciado — clock started, cada hora importa
- `audit-chain-verify` falhou → integridade de evidência legal
- `/api/health/live` 503 por > 2 min → processo morto (não é DB, não é rede — é código)
- `secret-compromise` confirmado (leak em repositório público, vendor disclosure)

Todo o resto pode esperar 2-12h sem dano material.

### Critérios P1 (morning triage)

Acontece durante a noite, resolvo de manhã:

- `/api/health/ready` 503 (DB down, circuitos abertos)
- `cron-job-failing` em cron de compliance (`verify-audit-chain`, `dsar-sla-check`, `backup-freshness`, `rls-canary`, `rotate-secrets`)
- `external-integration-down` para payment path (Asaas)
- `money-drift` com qualquer drift > 0 em `transfers.status='COMPLETED'`
- Backup `chain_break` ou `restore_drill` falhou
- Spike P1 em `rate-limit-abuse` (50+ IPs/hora ou 1 IP × 5+ buckets)

### Critérios P2 (same-day)

- Single-vendor integration degradation
- Cron de negócio stale (stale-orders, churn-check)
- Rate-limit P2 (10+ IPs / 100+ hits)
- Money drift em write que não chegou em COMPLETED
- DAST (ZAP) finding Medium+
- DSAR próxima de SLA (< 3 dias restantes)
- Drift de documentação (claims-audit warnings > 50)

### Critérios P3 (weekly)

- Dependabot updates
- Chores, refactors, technical debt
- Document rot
- Cost-review ritual

---

## 3. Fluxo geral de incident response

```
alerta dispara
   ↓
[15 min] classifique severidade (seção 2)
   ↓
P0/P1? → open skill `.cursor/skills/incident-open/SKILL.md`
P2/P3? → anote no diário, continua rotina
   ↓
rode o skill específico (ou runbook) correspondente
   ↓
containment < mitigação < diagnóstico (ordem importa sob pressão)
   ↓
verificação pós-mitigação
   ↓
P0/P1 → post-mortem em 5 dias úteis (`.github/ISSUE_TEMPLATE/postmortem.md`)
```

### Fast-path matriz

Use o skill específico quando o trigger bater exatamente:

| Trigger                           | Skill                                                                     | Runbook                                                         |
| --------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Qualquer alerta (entry point)     | [`incident-open`](../.cursor/skills/incident-open/SKILL.md)               | —                                                               |
| `rls_canary_violations_total > 0` | [`rls-violation-triage`](../.cursor/skills/rls-violation-triage/SKILL.md) | [`rls-violation.md`](./runbooks/rls-violation.md)               |
| `audit_chain tampered`            | [`audit-chain-verify`](../.cursor/skills/audit-chain-verify/SKILL.md)     | [`audit-chain-tampered.md`](./runbooks/audit-chain-tampered.md) |
| Secret vazou (leak)               | [`secret-compromise`](../.cursor/skills/secret-compromise/SKILL.md)       | [`secret-compromise.md`](./runbooks/secret-compromise.md)       |
| Rotação programada                | [`secret-rotate`](../.cursor/skills/secret-rotate/SKILL.md)               | [`secret-rotation.md`](./runbooks/secret-rotation.md)           |
| DSAR recebido                     | [`dsar-fulfill`](../.cursor/skills/dsar-fulfill/SKILL.md)                 | [`dsar-sla-missed.md`](./runbooks/dsar-sla-missed.md)           |
| Ordem judicial / ANPD             | [`legal-hold-apply`](../.cursor/skills/legal-hold-apply/SKILL.md)         | [`legal-hold-received.md`](./runbooks/legal-hold-received.md)   |
| Backup stale / restore falha      | [`backup-verify`](../.cursor/skills/backup-verify/SKILL.md)               | [`backup-missing.md`](./runbooks/backup-missing.md)             |
| `money_drift_view` não-vazio      | [`money-drift`](../.cursor/skills/money-drift/SKILL.md)                   | [`money-drift.md`](./runbooks/money-drift.md)                   |
| `/api/health/*` degraded          | [`health-check-triage`](../.cursor/skills/health-check-triage/SKILL.md)   | [`health-check-failing.md`](./runbooks/health-check-failing.md) |
| HTTP 429 spike                    | [`rate-limit-abuse`](../.cursor/skills/rate-limit-abuse/SKILL.md)         | [`rate-limit-abuse.md`](./runbooks/rate-limit-abuse.md)         |

Se o trigger não bate em nenhum skill, caia em `incident-open` → roteia
para o runbook certo em `docs/runbooks/`.

---

## 4. Canais de alerta

### Sentry (primary)

- Config em `lib/sentry-init.ts`.
- Alertas via e-mail + push browser notification (habilitado em todos os
  devices).
- Issues com label `priority:P0` disparam SMS via webhook Sentry → Twilio
  (ver `docs/runbooks/alerts-noisy.md` §configuração).

### UptimeRobot (heartbeat externo)

- Monitora `/api/health/live`, `/ready`, `/deep`.
- Intervalo 5 min.
- Alertas por SMS direto para telefone do operador.

### GitHub Issues (tracker oficial)

- Label `incident` — qualquer incidente aberto
- Label `severity:p0`…`p3` — classificação
- Label `compliance` — qualquer LGPD/ANPD related
- Template de post-mortem: [`.github/ISSUE_TEMPLATE/postmortem.md`](../.github/ISSUE_TEMPLATE/postmortem.md)

### E-mail transacional (Resend)

- `OPS_ALERT_EMAIL` env var — destino de todos os P2+
- Flag: `alerts.email_enabled` (default ON)
- Rate-limit aplicado: no máximo 1 e-mail idêntico por 15 min

### Vercel dashboard

- Deploy failures + runtime errors em real-time
- Function logs + analytics
- Não é "alerta" tradicional, mas fonte de verdade

---

## 5. O que fazer quando está em férias / indisposto

Ver [`docs/SOLO_OPERATOR.md`](./SOLO_OPERATOR.md) §6 "Cenários de desastre operacional"
para casos específicos. Resumo:

### Pré-viagem / sick day

- Rodar weekly ritual antes de sair
- Verificar: `claims-audit` verde, `cost-guard` sem alertas
- Postar em `docs/execution-log.md`: "ausente de `<data>` a `<data>`"
- Silenciar P2/P3 (manter P0/P1)

### Durante

- Checagem 1×/dia de Sentry + UptimeRobot (5 min)
- Apenas P0/P1: acionar
- P2/P3: anotar, não agir

### Pós

- Rodar weekly completo **antes** de qualquer feature work
- Triagem de todos os warnings acumulados

### Incapacidade prolongada

Se o operador sumir por > 7 dias sem aviso:

1. Contato de emergência em `docs/execution-log.md` (advogado + family)
2. Acesso de emergência via Vercel team + Supabase org admin
3. Chaves de infraestrutura em cofre físico (bank safe-deposit box)
4. Runbook recuperação: [`docs/runbooks/_contingency_solo-operator-outage.md`](./runbooks/_contingency_solo-operator-outage.md) (criar eventualmente)

---

## 6. Ritos obrigatórios

### Diário (manhã, ~15 min)

- Sentry unread issues > 0? Triagem.
- UptimeRobot: nenhum check vermelho?
- GitHub issues com label `incident` abertos? Progresso?
- DSAR queue: nada > 12d restantes?

### Semanal (segunda 08:00, ~30 min)

Ver [`docs/SOLO_OPERATOR.md`](./SOLO_OPERATOR.md) §2 "Weekly ritual".

Crítico: issue `claims-audit` semanal (abre terça 06 UTC) + `cost-guard`
(abre seg 11 UTC) precisam ser fechadas no ciclo.

### Mensal (primeiro dia do mês, ~1 h)

- Backup restore drill: confirmar execução + revisar relatório
- Secret rotation: verificar nenhuma vencida
- Cost review: comparar gasto real vs previsão em `docs/operations/budget.md`

### Trimestral (~4 h)

- Chaos drill guiado (runbook `chaos.md`)
- Review: skills vs realidade (algum skill nunca usado?)
- Review: crons órfãos (aparecem em vercel.json mas não em nenhum runbook?)

---

## 7. Anti-patterns

- **Não silencie alertas sem fix.** Cada mute é dívida.
- **Não faça P0 response sozinho se está cansado.** Adiar P1/P2 é melhor que errar sob fadiga.
- **Não confunda "tudo verde" com "tudo certo".** Claims-audit, mutation score, DAST — todos podem ficar verdes enquanto dev rot acumula.
- **Não reaja a P3 antes de terminar o P0 em aberto.** WIP=1 na operação.
- **Não feche post-mortem sem follow-ups com prazo.** Sem prazo = não vai ser feito.
- **Não escreva runbook que você não testou.** Rode o skill / runbook uma vez em staging antes de confiar nele em produção.

---

## 8. Change log

| Data       | Mudança                                              |
| ---------- | ---------------------------------------------------- |
| 2026-04-20 | Criação inicial — formaliza protocolo solo-operator. |

---

_Owner: solo operator · Última revisão: 2026-04-20_
