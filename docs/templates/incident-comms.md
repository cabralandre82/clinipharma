# Incident Communications Template

**Uso:** mensageria estruturada durante um incidente (P0/P1/P2) para **stakeholders internos** e **clientes**. Esse arquivo NÃO é para comunicação regulatória formal (ver [`anpd-incident-notice.md`](anpd-incident-notice.md)) nem para notificação a titulares (ver [`breach-notice-holder.md`](breach-notice-holder.md)).

**Princípios:**

1. **Cadência fixa** — durante um incidente ativo, comunicar a cada 30 min mesmo sem novidades ("ainda investigando, próxima atualização às hh:mm").
2. **Mesma audiência, mesmo canal** — não começar no e-mail e pular para WhatsApp.
3. **Fatos antes de causas** — o que está quebrado e quem é afetado vem antes de por quê.
4. **Honesto sobre incerteza** — "suspeitamos" vale mais que "confirmamos" errado.

---

## Template 1 — Alerta inicial (T+0 a T+15min)

**Uso:** primeiro sinal para stakeholders internos (operator/founder + DPO + qualquer cliente-chave).

**Canal:** canal interno de incidentes + e-mail opt-in.

**Subject:** `[P{N}] {SISTEMA_AFETADO}: {RESUMO_1_LINHA}`

```
## Incidente em andamento — [P{N}] {ID_INCIDENTE}

• Início detectado: {YYYY-MM-DD hh:mm} BRT
• Sistema afetado: {SISTEMA}
• Sintomas observados: {SINTOMAS_CURTOS}
• Impacto no cliente: {IMPACTO — % usuários, funcionalidades offline}
• Operador responsável: {NOME}
• Próxima atualização: {hh:mm} BRT (ou antes, se houver mudança material)

Status page: {url_se_existir}
Runbook sendo seguido: {link}
```

---

## Template 2 — Atualização de progresso (T+30min em diante)

**Uso:** a cada 30 min enquanto o incidente estiver aberto.

**Subject:** `[P{N}] {ID} — Atualização {hh:mm}: {STATUS_1_PALAVRA}` (ex.: `investigando`, `mitigando`, `verificando`, `resolvido`)

```
## Atualização — [P{N}] {ID_INCIDENTE}

• Status atual: {investigando | mitigando | verificando | resolvido}
• O que mudou desde {ultima_atualizacao_hh:mm}: {DELTA}
• Hipótese atual da causa: {HIPOTESE_OU_"indefinido"}
• Ação em execução: {ACAO}
• ETA para próxima fase: {hh:mm} BRT (ou "indefinido, atualizamos em 30min")
• Próxima atualização: {hh:mm} BRT
```

---

## Template 3 — Resolução (T+N, incidente encerrado)

**Uso:** comunicação final quando o impacto aos clientes foi encerrado.

**Subject:** `[RESOLVIDO] [P{N}] {ID} — {RESUMO}`

```
## Incidente resolvido — [P{N}] {ID_INCIDENTE}

• Impacto ao cliente cessou em: {YYYY-MM-DD hh:mm} BRT
• Duração do impacto: {duração} (de {inicio} até {fim})
• Número estimado de usuários afetados: {N}
• Causa raiz (1 linha): {CAUSA}
• Correção aplicada: {FIX} — commit/PR: {link}

Pós-mortem formal: {link} (esperado até {prazo_em_dias_uteis})

Se você foi afetado e precisa de suporte adicional, responda este e-mail ou entre em contato em {canal_suporte}.
```

---

## Template 4 — Página pública de status (status page)

**Uso:** incidentes P0 ou P1 que afetam >10% dos usuários ativos. Fonte canônica consumida também pelo status summary em `/api/status/summary`.

**Formato:** entrada cronológica em ordem reversa (mais recente no topo).

```markdown
### {YYYY-MM-DD hh:mm} BRT — {STATUS}

{CORPO_1_2_PARAGRAFOS}

Serviços afetados: {SERVICOS}
Cliente deve: {ACAO*OU*"nada — continue usando normalmente"}
```

**Status válidos para o status page:**

- `Investigating` — sabemos que algo está errado, investigando.
- `Identified` — causa identificada, preparando correção.
- `Monitoring` — correção aplicada, verificando se sustenta.
- `Resolved` — encerrado; manter visível por 7 dias.

---

## Template 5 — Comunicado de manutenção programada

**Uso:** janelas de manutenção conhecidas com antecedência (≥ 24h).

**Canal:** e-mail para clientes afetados + banner in-app 48h antes.

```
## Manutenção programada — {SISTEMA}

Informamos que realizaremos uma manutenção programada em nosso sistema:

• Data: {YYYY-MM-DD}
• Horário: {inicio_hh:mm} – {fim_hh:mm} BRT
• Duração estimada: {duração}
• O que estará indisponível: {LISTA}
• O que continuará funcionando: {LISTA}

Motivo: {BREVE_EXPLICACAO}

Pedimos desculpas pelo transtorno. Se você precisar realizar alguma operação crítica nesse intervalo, recomendamos fazê-la antes do início da janela.
```

---

## Matriz de escalação

| Severidade | Quem é notificado         | Canais                                  | Cadência      |
| ---------- | ------------------------- | --------------------------------------- | ------------- |
| P0         | Todos os stakeholders     | E-mail + status page + SMS (se crítico) | 30 min        |
| P1         | Operator + clientes-chave | E-mail + status page                    | 30 min        |
| P2         | Operator + equipe         | Canal interno                           | 1h            |
| P3         | Operator                  | Issue                                   | Próximo ciclo |

---

## Anti-patterns

- **Nunca** enviar "o sistema está normal" se você ainda não tem certeza. Prefira "não detectamos novos sintomas nos últimos X minutos; seguimos monitorando".
- **Nunca** comunicar causa raiz no Template 1. Nessa fase, você só tem hipóteses.
- **Nunca** pular a atualização de 30 min porque "não tem novidade" — a ausência de mensagem gera pânico. "Sem mudança desde a última atualização; seguimos investigando" é uma mensagem válida.
- **Nunca** incluir PII de afetados no canal público de stakeholders.

---

## Referências

- [`docs/on-call.md`](../on-call.md) — protocolo de incidente.
- [`docs/runbooks/data-breach-72h.md`](../runbooks/data-breach-72h.md) — casos com dimensão regulatória.
- [`docs/templates/breach-notice-holder.md`](breach-notice-holder.md) — comunicação LGPD ao titular.
- [`docs/templates/anpd-incident-notice.md`](anpd-incident-notice.md) — notificação à ANPD.
- [`.github/ISSUE_TEMPLATE/postmortem.md`](../../.github/ISSUE_TEMPLATE/postmortem.md) — post-mortem formal.
