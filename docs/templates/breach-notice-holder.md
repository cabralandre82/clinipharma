# Comunicação de Incidente ao Titular de Dados (LGPD Art. 48)

**Uso:** template para comunicar a titulares de dados pessoais a ocorrência de um incidente de segurança que os tenha afetado de forma relevante, conforme Art. 48 da LGPD.

**Quando usar:** sempre que a matriz de decisão em [`docs/runbooks/data-breach-72h.md`](../runbooks/data-breach-72h.md) indicar "notificar titulares" — em geral quando há risco ou dano relevante.

**Canal preferencial:** e-mail direto ao endereço cadastrado + aviso na interface autenticada (in-app banner). Evitar só SMS/push quando dados sensíveis estão envolvidos (a comunicação precisa conter detalhes).

---

## Campos a preencher antes de enviar

| Variável            | Valor                                                       |
| ------------------- | ----------------------------------------------------------- |
| `{TITULAR_NOME}`    | nome do destinatário                                        |
| `{INCIDENTE_DATA}`  | data (estimada) do incidente                                |
| `{DETECCAO_DATA}`   | data em que detectamos                                      |
| `{DADOS_AFETADOS}`  | lista explícita e específica (ex.: "e-mail, telefone, CPF") |
| `{RISCO_CONCRETO}`  | o que o titular deve temer (fraude, phishing, etc.)         |
| `{CONTENCAO}`       | o que já fizemos                                            |
| `{ACOES_TITULAR}`   | o que o titular deve fazer                                  |
| `{DPO_EMAIL}`       | canal do DPO para dúvidas                                   |
| `{ANPD_NOTIFICADA}` | "sim, em YYYY-MM-DD" ou "está em análise"                   |

---

## Template — versão por e-mail

**Assunto:** Comunicado importante sobre um incidente de segurança que afetou seus dados

---

Prezado(a) {TITULAR_NOME},

Em cumprimento ao Art. 48 da Lei Geral de Proteção de Dados (Lei nº 13.709/2018), comunicamos a ocorrência de um incidente de segurança que **afetou dados pessoais seus**.

**O que aconteceu**

Em {INCIDENTE_DATA}, foi identificado {DESCRICAO_TECNICA_EM_LINGUAGEM_CLARA}. O incidente foi detectado por nossa equipe em {DETECCAO_DATA}.

**Quais dados seus foram afetados**

Os dados pessoais envolvidos foram: **{DADOS_AFETADOS}**. {NAO_ENVOLVIDOS, se pertinente — ex.: "Senhas e dados de cartão de crédito NÃO foram acessados."}

**Qual o risco para você**

{RISCO_CONCRETO_EM_TEXTO_CLARO — ex.: "Como seu e-mail foi exposto, recomendamos atenção redobrada a mensagens que solicitem dados pessoais alegando ser de nossa parte. Nunca pedimos senha por e-mail."}

**O que nós já fizemos**

- {CONTENCAO — ex.: "Bloqueamos o vetor de acesso em até 30 minutos após a detecção."}
- {MITIGACAO — ex.: "Rotacionamos todas as credenciais que poderiam ter sido expostas."}
- {NOTIFICACAO — ex.: "{ANPD_NOTIFICADA}."}

**O que você pode fazer**

{ACOES_TITULAR — lista numerada de ações concretas, ex.:}

1. Trocar sua senha em nossa plataforma (já exigimos isso no próximo login).
2. Ficar atento a e-mails/SMS suspeitos nos próximos 30 dias.
3. {se aplicável: monitorar seu CPF em serviços de verificação de crédito}.

**Canal de dúvidas**

Em caso de dúvidas, você pode falar diretamente com nosso Encarregado pelo Tratamento de Dados (DPO):

- E-mail: {DPO_EMAIL}
- Canal público: `/legal/privacy`
- Direitos do titular: `/legal/direitos-do-titular` (ou Central de Ajuda → Privacidade)

**Nosso compromisso**

Levamos sua privacidade a sério. Este comunicado reflete nossa obrigação legal e nossa convicção de que você merece saber o que aconteceu, de forma transparente e sem jargão técnico.

Atenciosamente,

{NOME_SIGNATARIO — deve ser o DPO ou o representante legal}
{CARGO}
{EMPRESA}

---

## Template — versão in-app (banner autenticado)

> **Comunicado importante sobre seus dados.** Identificamos um incidente de segurança em {INCIDENTE_DATA} que afetou os seguintes dados seus: **{DADOS_AFETADOS}**. Já contivemos o incidente e tomamos as medidas cabíveis. Recomendamos que você: {ACOES_CURTAS}. Dúvidas: {DPO_EMAIL}. [Ler comunicado completo](link-para-pagina-publica)

**Regras de exibição:**

- Exibir até que o titular confirme leitura (botão "Entendi").
- Registrar evento `breach_notice_ack` em `audit_logs` quando confirmado.
- Persistir até 30 dias mesmo após ack, disponível em "Minha Conta → Comunicações legais".

---

## Checklist antes de enviar

- [ ] DPO revisou e aprovou o texto específico deste incidente.
- [ ] Assessoria jurídica revisou se houver dado sensível (LGPD Art. 5º, II) envolvido.
- [ ] Lista de destinatários gerada com filtro reproduzível (query em `docs/security/incidents/<id>/affected-users.sql`).
- [ ] Comunicação registrada como evento em `audit_logs` (um evento por destinatário).
- [ ] Linguagem clara, sem jargão técnico desnecessário.
- [ ] Canal de dúvidas do DPO está monitorado para o pico de mensagens esperado.

---

## Anti-patterns

- **Nunca** enviar comunicado genérico em massa sem especificar quais dados daquele titular foram afetados — essa personalização é requisito do Art. 48, §2º.
- **Nunca** minimizar o risco ("não se preocupe, foi pouca coisa") — se é digno de comunicação, é digno de instruções de ação.
- **Nunca** enviar antes de a ANPD ter sido notificada (exceto quando a notificação pública em si for a forma de notificação) — pode conflitar com a investigação regulatória.
- **Nunca** incluir detalhes técnicos exploráveis (vetor exato, componentes vulneráveis) na comunicação ao titular.

---

## Referências

- LGPD Art. 48 — Comunicação de incidente.
- Resolução CD/ANPD nº 15/2024 — Art. 10 (regras de comunicação ao titular).
- [`docs/runbooks/data-breach-72h.md`](../runbooks/data-breach-72h.md)
- [`docs/templates/anpd-incident-notice.md`](anpd-incident-notice.md)
