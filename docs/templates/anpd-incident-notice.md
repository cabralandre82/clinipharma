# ANPD — Comunicação de Incidente de Segurança (LGPD Art. 48)

**Uso:** template de notificação formal à Autoridade Nacional de Proteção de Dados (ANPD) quando um incidente atende aos critérios de §2 da Resolução CD/ANPD nº 15/2024 ou do Art. 48 da LGPD (Lei 13.709/2018).

**SLA:** 3 dias úteis a partir do conhecimento do incidente (arts. 5º e 6º da Resolução CD/ANPD nº 15/2024).

**Runbook acionador:** [`docs/runbooks/data-breach-72h.md`](../runbooks/data-breach-72h.md).

**Canal oficial de envio:** `https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis` (Sistema de Comunicação de Incidentes).

---

## 1. Identificação do agente de tratamento (controlador)

| Campo                       | Valor                                                                 |
| --------------------------- | --------------------------------------------------------------------- |
| Razão social                | `<preencher>`                                                         |
| CNPJ                        | `<preencher>`                                                         |
| Endereço completo           | `<preencher>`                                                         |
| Encarregado (DPO) — nome    | `<preencher>` (ver [`docs/legal/dpo.md`](../legal/dpo.md) se existir) |
| DPO — e-mail                | `dpo@<dominio>`                                                       |
| DPO — telefone              | `<preencher>`                                                         |
| Papel no tratamento afetado | [ ] Controlador [ ] Operador [ ] Cocontrolador                        |

## 2. Descrição do incidente

### 2.1 Cronologia

| Momento                        | Horário (BRT)      | Evidência                 |
| ------------------------------ | ------------------ | ------------------------- |
| Início do incidente (estimado) | `YYYY-MM-DD hh:mm` | `<log, Sentry, etc.>`     |
| Detecção pelo controlador      | `YYYY-MM-DD hh:mm` | `<alerta, relato, etc.>`  |
| Contenção                      | `YYYY-MM-DD hh:mm` | `<PR, flag, kill-switch>` |
| Encerramento confirmado        | `YYYY-MM-DD hh:mm` | `<métrica, log>`          |
| Conhecimento pelo DPO          | `YYYY-MM-DD hh:mm` | `<mensagem, ticket>`      |

### 2.2 Natureza do incidente

- **Tipo:** [ ] acesso não autorizado [ ] vazamento [ ] perda [ ] alteração indevida [ ] destruição [ ] indisponibilidade
- **Origem:** [ ] interna [ ] externa [ ] cadeia de fornecimento (sub-operador)
- **Vetor técnico:** `<descrever>`
- **Persistência:** [ ] ativa [ ] contida [ ] eliminada

### 2.3 Dados pessoais afetados

| Categoria                  | Natureza                 | Volume estimado |
| -------------------------- | ------------------------ | --------------- |
| Dados cadastrais           | nome, CPF, e-mail, tel.  | `<n titulares>` |
| Dados de saúde (sensível)  | prescrições, doc. médica | `<n titulares>` |
| Dados financeiros          | forma de pgto., valores  | `<n titulares>` |
| Credenciais / autenticação | senhas, tokens           | `<n titulares>` |
| Outros                     | `<especificar>`          | `<n titulares>` |

**Total estimado de titulares afetados:** `<n>`.

**Dados sensíveis envolvidos?** [ ] sim (descrever) [ ] não.

**Crianças/adolescentes envolvidos?** [ ] sim (descrever) [ ] não.

### 2.4 Consequências prováveis e riscos aos titulares

- Riscos materiais: `<fraude, golpe, dano financeiro>`
- Riscos morais: `<constrangimento, exposição de dado sensível>`
- Probabilidade de materialização: [ ] baixa [ ] média [ ] alta
- Severidade potencial: [ ] baixa [ ] média [ ] alta

## 3. Medidas de segurança e mitigação

### 3.1 Medidas já adotadas

- `<p.ex.: revogação de chave, invalidação de sessões, rotação de segredos>`
- `<p.ex.: bloqueio do vetor, patch aplicado em <commit>>`

### 3.2 Medidas em andamento

- `<p.ex.: análise forense, auditoria de logs>`

### 3.3 Medidas preventivas a implementar

- `<p.ex.: novo controle de acesso, mudança de arquitetura>`
- Referência ao pós-mortem: `<link para issue>`

## 4. Comunicação aos titulares

- **Planejada?** [ ] sim [ ] não
- **Justificativa se não:** `<art. 48, §3º — apenas se risco baixo ou se a publicidade aumentar o risco>`
- **Canal:** `<e-mail, push, página pública>`
- **Template usado:** [`docs/templates/breach-notice-holder.md`](breach-notice-holder.md)
- **Data planejada / realizada:** `YYYY-MM-DD`

## 5. Anexos

- Timeline com evidências (`docs/security/incidents/<id>/timeline.md`)
- Pós-mortem (`docs/security/incidents/<id>/postmortem.md`)
- Relação das comunicações aos titulares
- Logs técnicos relevantes (hash / referência sem PII)

---

## Checklist antes de enviar

- [ ] DPO revisou e aprovou o texto.
- [ ] Assessoria jurídica revisou (recomendado para incidente de dado sensível).
- [ ] Evidências técnicas anexadas estão sem PII de terceiros.
- [ ] Controlador informado (CEO/diretor responsável).
- [ ] Data-breach runbook foi seguido integralmente ([`docs/runbooks/data-breach-72h.md`](../runbooks/data-breach-72h.md)).

## Referências

- LGPD (Lei 13.709/2018), Arts. 48 e 50.
- Resolução CD/ANPD nº 15/2024 — Comunicação de Incidente de Segurança.
- [`docs/runbooks/data-breach-72h.md`](../runbooks/data-breach-72h.md) — processo interno.
- [`docs/compliance/anpd-art-48-notification.md`](../compliance/anpd-art-48-notification.md) — matriz de decisão de notificação.
