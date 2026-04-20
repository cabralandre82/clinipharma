# Runbook — `<short-slug>`

> **Template.** Copy this file to `docs/runbooks/<slug>.md` when writing a
> new runbook. Delete blockquotes like this one before committing. Do not
> delete empty sections — keep the skeleton, write "N/A" if it doesn't apply,
> so the shape remains searchable.

**Gravidade:** 🔴 P1 · 🟠 P2 · 🟡 P3 (pick one and remove the others)
**Alerta de origem:** <what fires this — Sentry issue / cron / UptimeRobot / user report>
**SLO:** triage < <X> min · containment < <Y> h · resolution < <Z> h
**Owner:** on-call engineer → <escalation path>
**Introduzido por:** Wave <N> / migration `<file.sql>` / PR #<n>

> P0/P1 only: **não feche este incidente sem post-mortem.** Cross-link to
> `.github/ISSUE_TEMPLATE/postmortem.md`.

---

## 0. Companion skill (se existir)

Se este runbook tiver skill dedicado em `.cursor/skills/<name>/SKILL.md`,
mencione aqui. O skill é para emergência (checklist + comandos); o runbook
é para contexto (por quê).

---

## 1. Sintomas observados

Como o alerta aparece na prática:

- Sentry: `<issue title>` com tags `<tag1>=<value>`.
- Métrica Prometheus: `<metric_name>{labels}` > `<threshold>`.
- Comportamento do app: <o que o usuário enxerga, se algo>.
- `cron_runs` / dashboard specifico: <query ou path>.

---

## 2. Impacto no cliente

- **Usuário final:** <direto? indireto? nenhum?>
- **B2B (farmácia / clínica / consultor):** <impacto contratual?>
- **Compliance:** <LGPD, ANVISA, CFF, CRN, fiscal — algum deles disparado?>
- **Financeiro:** <risco de perda / fraude / cobrança incorreta?>

---

## 3. Primeiros 5 minutos (containment)

1. **Confirmar que o alerta é real** — comando rápido de verificação:
   ```bash
   # curl, sql, ou gh command
   ```
2. **Snapshot imediato** se houver risco de perda de evidência:
   ```sql
   -- query que preserva o estado atual
   ```
3. **Abrir issue no GitHub** com label `incident` + `severity:p<N>`:
   ```bash
   gh issue create \
     --title "P<N> — <slug> (<context>)" \
     --label "incident,severity:p<N>,<area>" \
     --body "..."
   ```
4. **Não faça** <ações perigosas enumeradas — ex: não rollback direto, não delete, não rotate ainda>.

---

## 4. Diagnóstico

### 4.1 — <Primeira hipótese>

```sql
-- query de diagnóstico 1
```

### 4.2 — <Segunda hipótese>

```bash
# comando de inspeção
```

### Decision tree

```
condição A  →  mitigação §5.A
condição B  →  mitigação §5.B
condição C  →  escala, não tente corrigir sozinho
```

---

## 5. Mitigação

### 5.A — <primeira opção, geralmente a mais segura>

Explicação curta. Comando:

```sql
-- ou bash
```

Tempo esperado: <X min>. Reversível? <sim/não>.

### 5.B — <opção alternativa>

<quando usar esta em vez da 5.A>

### 5.C — Kill-switch / feature flag

Se existe um flag relacionado (p.ex. `observability.deep_health`,
`money.cents_read`), documente aqui.

```sql
update public.feature_flags set enabled = false where key = '<key>';
```

---

## 6. Verificação pós-mitigação

Como saber que o problema foi resolvido:

- [ ] Métrica `<nome>` voltou para `<valor normal>`.
- [ ] `/api/health/<ready|deep>` responde 200 OK.
- [ ] Cron `<nome>` rodou com sucesso depois da mitigação.
- [ ] Alerta original (Sentry/UptimeRobot) auto-resolveu.

---

## 7. Post-mortem (obrigatório para P0/P1, opcional para P2/P3)

Template: [`.github/ISSUE_TEMPLATE/postmortem.md`](../../.github/ISSUE_TEMPLATE/postmortem.md).

Arquivo final em `docs/incidents/YYYY-MM-DD-<slug>.md`. Inclua:

- Linha do tempo com timestamps.
- Causa raiz (5 whys mínimo).
- O que funcionou, o que falhou.
- Ações de follow-up (com prazo + responsável).
- Se aplicável, ADR em `docs/decisions/` para mudanças estruturais.

---

## 8. Prevenção

O que mudar para que isso **não aconteça de novo**:

- Adicionar métrica / alerta novo? <qual>
- Regressão test? <qual arquivo em `tests/unit/` ou `tests/e2e/`>
- Regra em `.cursor/rules/*.mdc`? <qual>
- Skill em `.cursor/skills/`? <se recorrer>

---

## Links

- Código relevante: `<paths>`
- Migrations: `<supabase/migrations/XXX_*.sql>`
- ADRs: `<docs/decisions/>`
- Runbooks relacionados: `<links>`
- Skills relacionados: `<.cursor/skills/>`

---

_Template version: 2026-04 · Owner: solo operator + AI agents_
