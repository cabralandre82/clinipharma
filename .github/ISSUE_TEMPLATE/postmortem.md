---
name: Post-mortem
about: Post-mortem de incidente (obrigatório para P0/P1)
title: 'Post-mortem: <slug-do-incidente>'
labels: ['postmortem', 'incident']
assignees: []
---

<!--
Preenchido APÓS a resolução do incidente, dentro de 5 dias úteis.
Blameless: foco em aprendizado, não em atribuir culpa.
Este post-mortem fica arquivado por 10 anos (prescrição LGPD + cível).
-->

## Resumo executivo (TL;DR)

<!-- 2-3 frases. O que aconteceu, impacto, causa, fix. -->

-
-

## Classificação

- **Severidade:** P0 · P1 · P2 · P3
- **Detectado por:** Sentry · UptimeRobot · cron · user report · skill/runbook
- **Categoria:** infra · security · compliance · data-integrity · integration · performance · release-regression
- **Runbook usado:** `docs/runbooks/<slug>.md`
- **Skill usado:** `.cursor/skills/<slug>/SKILL.md` (se aplicável)

## Linha do tempo (UTC)

<!--
Incluir TODOS os timestamps — da detecção ao fecho. Rigor > brevidade.
Inclua também quem fez o quê (ou "autonomous agent" quando foi robô).
-->

| Timestamp (UTC)       | Evento                              | Quem              |
| --------------------- | ----------------------------------- | ----------------- |
| `YYYY-MM-DD HH:MM:SS` | Primeiro sinal: `<alerta>`          | alerta automático |
| `YYYY-MM-DD HH:MM:SS` | Triagem iniciada (awareness formal) | operator          |
| `YYYY-MM-DD HH:MM:SS` | Containment: `<ação>`               | operator          |
| `YYYY-MM-DD HH:MM:SS` | Root cause identificada             | operator          |
| `YYYY-MM-DD HH:MM:SS` | Mitigação aplicada: `<ação>`        | operator          |
| `YYYY-MM-DD HH:MM:SS` | Verificação pós-mitigação OK        | operator          |
| `YYYY-MM-DD HH:MM:SS` | Incidente declarado resolvido       | operator          |

**Duração total (aware → resolved):** `<X>h<Y>m`
**MTTR:** `<ação que de fato resolveu> → resolvido em Xm`

## Impacto

- **Usuários afetados:** `<N>` (ou "nenhum" / "não-quantificável")
- **B2B afetados:** `<lista de tenants>` (ou "global")
- **Dados afetados:** `<tabelas / volumes / tipos>` (ou "nenhum")
- **Receita estimada perdida:** `R$ <X>` (ou "n/a")
- **Compliance:** `<LGPD/ANPD/outros>` — notificação necessária? feita?
- **SLO impactado:** `<qual SLO, quanto de error budget consumido>`

## Causa raiz (5 whys)

<!--
Apenas aceitar "porque é assim" não é causa raiz.
Force-se a 5 perguntas "por quê" a partir do sintoma.
-->

1. **Por quê:** `<sintoma inicial>` ?
   **Porque:** `<causa nível 1>`
2. **Por quê:** `<causa nível 1>` ?
   **Porque:** `<causa nível 2>`
3. **Por quê:** `<causa nível 2>` ?
   **Porque:** `<causa nível 3>`
4. **Por quê:** `<causa nível 3>` ?
   **Porque:** `<causa nível 4>`
5. **Por quê:** `<causa nível 4>` ?
   **Porque:** `<causa raiz real>`

### Contributing factors (não a causa única)

- `<e.g., alerta ruidoso tornou este sinal invisível>`
- `<e.g., runbook desatualizado direcionou para fluxo errado>`

## O que funcionou bem

<!-- Não só o que deu ruim. Reforce o que deu certo. -->

-
-

## O que falhou

-
-

## Follow-ups (action items)

<!--
Cada item deve ter: owner explícito, prazo ISO, link para issue/PR.
Prefira preventivo sobre detectivo sobre reativo (nessa ordem).
-->

| #   | Ação                                                                       | Owner            | Prazo        | Issue/PR |
| --- | -------------------------------------------------------------------------- | ---------------- | ------------ | -------- |
| 1   | `<ação preventiva, e.g. "adicionar teste de regressão em tests/unit/...">` | `@solo-operator` | `YYYY-MM-DD` | #`<nn>`  |
| 2   | `<ação detectiva, e.g. "alerta proativo para métrica X">`                  | `@solo-operator` | `YYYY-MM-DD` | #`<nn>`  |
| 3   | `<ação de documentação, e.g. "atualizar skill/runbook">`                   | `@solo-operator` | `YYYY-MM-DD` | #`<nn>`  |

**Commitment:** todos os follow-ups `P0` devem estar fechados antes do
próximo incidente de mesma categoria. Se não foi possível, documentar
por quê como parte de um ADR.

## Mudanças estruturais (se aplicável)

- [ ] ADR criado em `docs/decisions/<NNN>-<slug>.md`?
- [ ] Rule atualizada em `.cursor/rules/*.mdc`?
- [ ] Skill atualizado em `.cursor/skills/*/SKILL.md`?
- [ ] Invariante adicionada em `AGENTS.md`?
- [ ] Claim verifier novo em `scripts/claims/`?

## Blameless note

<!--
Esta seção é sagrada. Não cite pessoas, cite sistemas.
Se o operador humano errou sob pressão, o sistema deixou esse erro ser
possível — o sistema é o que mudamos.
-->

Este post-mortem é blameless. Foco em aprendizado e mudança estrutural,
não em atribuição de falha individual. Erros são sinais de sistemas que
precisam evoluir.

## Evidências arquivadas

<!-- Links para logs, screenshots, snapshots SQL, export de métricas. -->

- Sentry issue: `<url>`
- GitHub incident issue: `<url>`
- Snapshots SQL: `gist:<id>` ou `docs/incidents/assets/<file>.csv`
- Run CI relevante: `<url actions/runs/N>`

---

**Arquivamento final:** mover este post-mortem para `docs/incidents/YYYY-MM-DD-<slug>.md`
após fechamento e fazer PR para o repo (é parte do trail de compliance).
