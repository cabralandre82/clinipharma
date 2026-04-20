# ANPD Art. 48 — Matriz de Decisão de Notificação

**Uso:** decisão estruturada sobre **se** e **quando** comunicar a ANPD sobre um incidente de segurança envolvendo dados pessoais. Complementa o runbook [`docs/runbooks/data-breach-72h.md`](../runbooks/data-breach-72h.md) — o runbook define o processo temporal; este documento define os critérios.

**Base legal:**

- LGPD (Lei 13.709/2018), Art. 48.
- Resolução CD/ANPD nº 15/2024 (em vigor desde maio/2024).

---

## 1. Quando é obrigatório notificar?

> **Art. 48.** O controlador deverá comunicar à autoridade nacional e ao titular a ocorrência de incidente de segurança que **possa acarretar risco ou dano relevante aos titulares**.

A comunicação é obrigatória quando **as duas condições abaixo são satisfeitas**:

1. Houve incidente de segurança envolvendo dados pessoais (acesso não autorizado, perda, vazamento, alteração, destruição indevida, ou indisponibilidade que afete direitos).
2. O incidente **pode** acarretar **risco ou dano relevante** aos titulares.

## 2. Matriz de decisão — "o incidente é de risco relevante?"

Marcar "SIM" em **qualquer** critério abaixo indica que é de risco relevante → notificação à ANPD é obrigatória.

| Critério                                                                                                        | Sim | Não |
| --------------------------------------------------------------------------------------------------------------- | --- | --- |
| Dados sensíveis (saúde, biometria, orientação sexual, origem racial, etc. — LGPD Art. 5º, II) foram expostos.   |     |     |
| Dados de crianças ou adolescentes foram expostos.                                                               |     |     |
| Credenciais (senha, token) foram expostas e podem ser reutilizadas em outros sistemas.                          |     |     |
| Volume significativo de titulares afetados (> 100) OU > 10% da base, o que for menor.                           |     |     |
| Dados financeiros passíveis de fraude (CVV, chave PIX de CPF pouco protegido, número de cartão) foram expostos. |     |     |
| Incidente resulta em indisponibilidade de serviço essencial por mais de 24h.                                    |     |     |
| Há evidência de **exploração ativa** (não apenas potencial) por agente malicioso.                               |     |     |
| Exposição pode ter consequências discriminatórias (dados de saúde publicados, por exemplo).                     |     |     |
| A reidentificação dos titulares afetados é viável a partir dos dados vazados.                                   |     |     |

**Se nenhum critério for SIM:** notificação **não obrigatória**, mas documente a decisão e a justificativa em `docs/security/incidents/<id>/decision.md`. A ANPD pode solicitar essa documentação a qualquer momento.

## 3. Prazo de comunicação

- **Prazo:** 3 dias úteis a partir do conhecimento do incidente (Resolução CD/ANPD nº 15/2024, Arts. 5º e 6º).
- **Contagem:** "conhecimento" = momento em que o controlador (ou DPO) tem ciência efetiva de que há um incidente de segurança afetando dados pessoais. Não é o momento da ocorrência técnica, mas o momento em que **alguém com responsabilidade soube**.
- **Atraso admissível:** se depois do prazo, anexar justificativa documentada (ex.: análise forense extensa para dimensionar o escopo).

## 4. Conteúdo mínimo da comunicação

Conforme Resolução CD/ANPD nº 15/2024, Art. 5º:

1. **Descrição da natureza** do incidente (o que aconteceu, em linguagem clara).
2. **Categorias e número aproximado** de titulares afetados.
3. **Categorias e natureza** dos dados pessoais afetados.
4. **Consequências concretas ou prováveis** do incidente.
5. **Data de conhecimento** pelo controlador e **marcos temporais** do incidente.
6. **Medidas técnicas e organizacionais** adotadas para mitigar efeitos.
7. **Contato do DPO** (ou de quem exerce a função).

Template completo: [`docs/templates/anpd-incident-notice.md`](../templates/anpd-incident-notice.md).

## 5. Comunicação ao titular (regra separada)

Notificar a ANPD **não substitui** a comunicação aos titulares (são obrigações independentes).

**Obrigatório notificar titulares quando:**

- Houver risco ou dano relevante **E**
- A comunicação for viável (se impossível, justificar em documento interno) **E**
- A comunicação não aumentar o risco (ex.: aviso prévio que atrapalharia investigação em curso — precisa de justificativa forte).

**Template:** [`docs/templates/breach-notice-holder.md`](../templates/breach-notice-holder.md).

## 6. Canal de notificação

**Sistema oficial (Controlador):**
`https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis`

Precisa de login gov.br do representante legal ou do DPO.

**Evidência:** capturar screenshot do número de protocolo e salvar em `docs/security/incidents/<id>/anpd-protocol.png`.

## 7. Comunicação corretiva (após envio inicial)

Se durante a investigação forem descobertos **fatos novos materiais** (mais titulares afetados, nova categoria de dado, etc.), uma **comunicação complementar** deve ser enviada dentro de 15 dias do novo conhecimento.

## 8. Decisão registrada — modelo

Toda decisão de notificar (ou não notificar) deve ser registrada:

```
# Decisão de notificação — Incidente {ID}

Decisão: [ ] Notificar ANPD  [ ] Não notificar (registrar justificativa)
Decisão: [ ] Notificar titulares  [ ] Não notificar (registrar justificativa)

Responsável pela decisão: {DPO_NOME}
Data da decisão: {YYYY-MM-DD hh:mm}

## Critérios aplicados

| Critério                            | Sim | Não | Evidência              |
| ----------------------------------- | --- | --- | ---------------------- |
| Dados sensíveis expostos            |     |     |                        |
| ... (copiar a matriz da §2)         |     |     |                        |

## Justificativa final

{TEXTO LIVRE — por que notificar ou não, com base nos critérios}

## Assinatura digital

- {DPO_ASSINATURA_COM_TIMESTAMP}
- Hash do documento: {SHA256}
```

Salvar em `docs/security/incidents/<id>/decision.md`.

## 9. Anti-patterns

- **Nunca** decidir não notificar porque "a imagem da empresa pode sofrer". Isso não está na matriz e é fundamento irrelevante juridicamente.
- **Nunca** esperar o pós-mortem completo para notificar — o prazo é de 3 dias úteis para o aviso inicial; correções vêm depois.
- **Nunca** subestimar o volume no aviso inicial para "não assustar" — pode configurar omissão material.
- **Nunca** descartar notificação ao titular quando há comunicação à ANPD sobre risco relevante. São obrigações cumulativas.

## 10. Referências

- [`docs/runbooks/data-breach-72h.md`](../runbooks/data-breach-72h.md) — processo temporal.
- [`docs/templates/anpd-incident-notice.md`](../templates/anpd-incident-notice.md) — template de preenchimento.
- [`docs/templates/breach-notice-holder.md`](../templates/breach-notice-holder.md) — comunicação ao titular.
- [`docs/legal/dpa-farmacias.md`](../legal/dpa-farmacias.md) — DPA com operador (obriga notificação em 24h do operador para o controlador).
- [`docs/legal/dpa-clinicas.md`](../legal/dpa-clinicas.md) — DPA com clínicas.
- LGPD Art. 48, Art. 50.
- Resolução CD/ANPD nº 15/2024.
