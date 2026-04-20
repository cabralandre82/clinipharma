# Lista de Subprocessadores (Subprocessors)

**Uso:** inventário obrigatório, conforme LGPD Art. 39 e DPAs assinados com clínicas e farmácias, de todas as entidades que **processam dados pessoais em nosso nome** (operadores e subcontratados).

**Atualização:** sempre que um subprocessador é adicionado, removido ou substituído. Revisão formal trimestral.

**Notificação:** clientes com contrato ativo devem ser avisados com antecedência mínima de 30 dias sobre mudanças nesta lista (ver DPAs correspondentes).

---

## Subprocessadores ativos (em ordem alfabética)

| Subprocessador           | Papel no tratamento                | Dados processados                                             | País (hospedagem)       | Base legal (LGPD)                       | DPA em vigor      |
| ------------------------ | ---------------------------------- | ------------------------------------------------------------- | ----------------------- | --------------------------------------- | ----------------- |
| **Asaas**                | Processadora de pagamentos         | Nome, CPF, e-mail, dados de pagamento                         | Brasil                  | Execução de contrato                    | `<pendente link>` |
| **Clicksign**            | Assinatura eletrônica de contratos | Nome, CPF, e-mail, IP, documento assinado                     | Brasil                  | Execução de contrato                    | `<pendente link>` |
| **Resend**               | Transacional de e-mail             | E-mail, nome (campo "to"), conteúdo do e-mail                 | EUA                     | Execução de contrato + cláusulas padrão | `<pendente link>` |
| **Sentry**               | Monitoramento de erros             | User ID (hash), trace IDs, request metadata (sem PII direta)  | EUA                     | Legítimo interesse (SRE)                | `<pendente link>` |
| **Supabase**             | Banco de dados + autenticação      | Todo o dataset (PII, dados de saúde)                          | EUA (region: us-east-1) | Execução de contrato                    | `<pendente link>` |
| **Upstash**              | Redis (rate-limit, cache)          | Chaves hasheadas (IP-SHA256, user ID hash)                    | EUA                     | Legítimo interesse                      | `<pendente link>` |
| **Vercel**               | Hospedagem da aplicação            | Logs de acesso (request metadata), edge cache                 | Global (edge)           | Execução de contrato                    | `<pendente link>` |
| **Zenvia**               | SMS e WhatsApp transacional        | Telefone, conteúdo da mensagem                                | Brasil                  | Execução de contrato                    | `<pendente link>` |
| **Inngest**              | Orquestração de jobs               | Event payloads (podem conter IDs de recursos, não PII direta) | EUA                     | Legítimo interesse                      | `<pendente link>` |
| **Cloudflare Turnstile** | Anti-abuse (bot protection)        | Token efêmero + IP do verificador (não persistido por nós)    | Global                  | Legítimo interesse                      | `<pendente link>` |

---

## Subprocessadores sob avaliação (não ativos)

Entidades com contrato em negociação mas **sem acesso a dados** atualmente:

_(nenhum no momento)_

---

## Transferência internacional de dados

Os subprocessadores hospedados fora do Brasil (EUA e global) recebem dados pessoais de titulares brasileiros. A transferência é fundamentada em:

- **Cláusulas-padrão contratuais** — incorporadas ao DPA de cada subprocessador, espelhando a decisão da ANPD sobre transferência internacional (Resolução CD/ANPD nº 19/2024).
- **Execução de contrato** quando o titular contratou um serviço cujo cumprimento depende do subprocessador (ex.: entrega de e-mail via Resend).
- **Legítimo interesse** quando se trata de telemetria/segurança sem uso secundário (ex.: Sentry).

Avaliação de Impacto à Proteção de Dados (RIPD) relacionada: [`docs/security/threat-model.md`](../security/threat-model.md).

---

## Processo de onboarding de novo subprocessador

1. **Due diligence inicial**
   - Verificar certificações (SOC 2, ISO 27001, HIPAA se aplicável).
   - Avaliar país-sede e jurisdição aplicável.
   - Revisar termos públicos e DPA ofertado.

2. **Assinatura do DPA**
   - Incluir cláusulas LGPD-aware: notificação de incidente em 24h, direito de auditoria, possibilidade de exigir retorno/exclusão de dados.
   - Anexar cláusulas-padrão se houver transferência internacional.

3. **Mapeamento do fluxo**
   - Quais dados chegam ao subprocessador?
   - Qual a base legal?
   - Qual a retenção no subprocessador (e como a retenção é alinhada com a nossa)?
   - Como e com que periodicidade solicitamos retorno/exclusão?

4. **Atualização desta lista**
   - Adicionar linha na tabela.
   - Bump de versão + data no changelog abaixo.
   - Notificar clientes existentes com >=30 dias de antecedência, conforme DPAs.

5. **Atualização de página pública**
   - `/legal/subprocessors` consome este arquivo (ou mantém cópia sincronizada).

## Processo de offboarding

1. Encerrar acesso do subprocessador (revogar chaves, encerrar DPA).
2. Confirmar retorno/exclusão de todos os dados pessoais, por escrito.
3. Remover linha desta lista + arquivar cópia histórica.
4. Notificar clientes afetados (30d de antecedência não se aplica se o offboarding é por incidente/violação do DPA).

---

## Changelog

| Data       | Mudança                                                                         |
| ---------- | ------------------------------------------------------------------------------- |
| 2026-04-20 | Versão inicial extraída dos imports no codebase + variáveis de ambiente em uso. |

---

## Responsabilidades

- **DPO:** manter esta lista atualizada; revisar trimestralmente; notificar clientes sobre mudanças.
- **Operator/Engenharia:** informar o DPO antes de adicionar qualquer dependência que processe dados pessoais.
- **Legal:** revisar DPA de cada novo subprocessador antes da ativação.

---

## Referências

- [`docs/legal/dpa-farmacias.md`](../legal/dpa-farmacias.md) — DPA com farmácias (clientes).
- [`docs/legal/dpa-clinicas.md`](../legal/dpa-clinicas.md) — DPA com clínicas (clientes).
- [`docs/security/threat-model.md`](../security/threat-model.md) — modelo de ameaças.
- [`docs/runbooks/external-integration-down.md`](../runbooks/external-integration-down.md) — runbook quando um subprocessador fica indisponível.
- LGPD Art. 39 — obrigações do operador.
- LGPD Arts. 33–36 — transferência internacional.
- Resolução CD/ANPD nº 19/2024 — transferência internacional.
