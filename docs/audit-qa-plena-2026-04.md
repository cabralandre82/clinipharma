# Clinipharma — Auditoria de QA e Segurança (Plena)

**Versão do documento:** 1.0  
**Data:** 2026-04-12  
**Escopo:** Plataforma B2B Clinipharma (Next.js, Supabase PostgreSQL, Vercel, Asaas sandbox, Clicksign sandbox, OpenAI v6.0.0).

---

## 0. Alinhamento obrigatório com a documentação oficial

Este plano de testes foi **reconciliado** com `docs/known-limitations.md`, `docs/PENDING.md`, `docs/go-live-checklist.md`, `docs/lgpd-registro-atividades.md` e `docs/roadmap-90pts.md`.  
Onde o prompt genérico assume capacidades que **não existem no MVP**, os casos são marcados como **N/A (FORA DO ESCOPO DOCUMENTADO)** com referência.

| Assunção do prompt genérico                                   | Estado na Clinipharma                                                                    | Referência                                  |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------- |
| Split automático de pagamento + gateway anti-fraud enterprise | Repasse **manual** por design; Asaas **sandbox** até CNPJ                                | `known-limitations.md` — Financeiro         |
| Emissão de NF-e automática                                    | **Não implementada**                                                                     | `known-limitations.md` — Financeiro         |
| Validação ANVISA via API oficial em tempo real                | **Manual / roadmap**; comentário em `lib/compliance.ts`                                  | `roadmap-90pts.md`, `PENDING.md`            |
| Armazenamento em AWS S3                                       | **Supabase Storage** (objetos privados + URLs assinadas)                                 | Código + `known-limitations`                |
| Sessões em Redis                                              | **JWT + cookies**; rate limit / circuit em **Upstash Redis**                             | `known-limitations.md`                      |
| WhatsApp ativo                                                | **Infra pronta, número e deploy pendentes**                                              | `known-limitations.md` — Notificações       |
| CNPJ da empresa controladora                                  | **Pendente**                                                                             | `PENDING.md`, `lgpd-registro-atividades.md` |
| Certificado digital A1                                        | **Pendente** (NF-e)                                                                      | `known-limitations.md`                      |
| Três portais separados (URLs distintas)                       | **Uma aplicação web** com RBAC (papéis distintos, não subdomínios obrigatórios)          | `lib/rbac/index.ts`                         |
| Recomendações com “camada LLM de ranking/explicação”          | **Somente SQL/Apriori** — sem explicação gerada por LLM no catálogo                      | `lib/jobs/product-recommendations.ts`       |
| OCR de receitas médicas como fluxo clínico obrigatório        | OCR é **sob demanda** na revisão de **cadastro** (admin), não substitui validação ANVISA | `known-limitations.md` — IA                 |

**Papéis RBAC reais:** `SUPER_ADMIN`, `PLATFORM_ADMIN`, `CLINIC_ADMIN`, `DOCTOR`, `PHARMACY_ADMIN`, `SALES_CONSULTANT`.

**Instruções ao executor:** preencha o campo `Actual result:` de cada TC. Use evidência (screenshot, HTTP status, trecho de log, ID de pedido). Caso **N/A**, escreva `N/A — [citação doc]` e não execute fluxo inexistente.

### Sumário quantitativo (contagem de casos neste ficheiro)

| Bloco                    | Quantidade aproximada | Notas                                       |
| ------------------------ | --------------------- | ------------------------------------------- |
| TC-1-CLINIC-INJ-\*       | 77                    | 11 campos × 7 vetores de ataque             |
| TC-1-DOCTOR-INJ-\*       | 70                    | 10 campos × 7 vetores                       |
| Demais Secções 1–11 + IA | ~95                   | Inclui N/A documentados e achados estáticos |
| **Total**                | **~242**              | Casos explícitos com bloco completo `TC-…`  |

Secções 2–11 do prompt genérico foram **condensadas** nas áreas onde o comportamento é idêntico entre múltiplos endpoints: a matriz de RBAC deve ser **expandida linha a linha** para cada rota em `app/api/**/route.ts` (40 rotas) — duplicar o formato TC-1-300 substituindo método, path e papel.

---

## Convenções

- **Severity:** CRITICAL | HIGH | MEDIUM | LOW
- **Regulatory risk:** ANVISA | LGPD | FISCAL | CFM | none
- IDs seguem o prompt: `TC-[SEÇÃO]-[NNN]` e `TC-AI-[FEATURE]-[NNN]`.

---

# SECTION 1 — AUTHENTICATION & SESSION MANAGEMENT

## 1.0 — Escopo documentado (pré-leitura)

TC-1-000
Title: Confirmar ausência de lockout local após 10 falhas de login (se não implementado)
Severity: MEDIUM
Area: Login / Supabase Auth
Precondition: Conta de teste ativa.
Steps:

1. Na tela `/login`, informe e-mail válido e senha incorreta 10 vezes seguidas.
2. Na 11ª tentativa, use a senha correta.
   Expected result: Comportamento documentado em política de segurança; se não houver lockout próprio além do Supabase, falha de login não deve vazar se o e-mail existe (enumeración).
   Actual result: [ ]
   Harm if bug exists: Conta comprometida por brute force se Supabase não limitar.
   Regulatory risk: none

TC-1-001
Title: Cadastro clínica — CNPJ duplicado já existente na base
Severity: HIGH
Area: Registration / integrity
Precondition: Existe clínica aprovada com CNPJ X.
Steps:

1. Inicie novo cadastro tipo CLINIC.
2. Preencha todos os campos válidos usando o mesmo CNPJ X.
3. Envie com documentos exigidos.
   Expected result: Cadastro rejeitado ou colocado em análise com erro claro; não deve existir segunda entidade ativa com mesmo CNPJ sem fluxo de merge.
   Actual result: [ ]
   Harm if bug exists: Fraude documental, duplicidade cadastral.
   Regulatory risk: ANVISA

## 1.1 — Injeção e fuzzing por campo (cadastro CLÍNICA)

TC-1-CLINIC-INJ-001
Title: CLINIC — campo `full_name` (Nome completo) — payload SQLI1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `full_name`, insira exatamente: `' OR '1'='1` (valor completo no teste real: 11 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-002
Title: CLINIC — campo `full_name` (Nome completo) — payload SQLI2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `full_name`, insira exatamente: `'; DROP TABLE orders; --` (valor completo no teste real: 24 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-003
Title: CLINIC — campo `full_name` (Nome completo) — payload SQLI3
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `full_name`, insira exatamente: `1' UNION SELECT NULL--` (valor completo no teste real: 22 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-004
Title: CLINIC — campo `full_name` (Nome completo) — payload XSS1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `full_name`, insira exatamente: `<script>alert(1)</script>` (valor completo no teste real: 25 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-005
Title: CLINIC — campo `full_name` (Nome completo) — payload XSS2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `full_name`, insira exatamente: `<img src=x onerror=alert(1)>` (valor completo no teste real: 28 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-006
Title: CLINIC — campo `full_name` (Nome completo) — payload LONG
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `full_name`, insira exatamente: `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA…[truncado no plano]` (valor completo no teste real: 10000 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-007
Title: CLINIC — campo `full_name` (Nome completo) — payload EMOJI
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `full_name`, insira exatamente: `Teste 😀 ñ ç ã à` (valor completo no teste real: 15 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-008
Title: CLINIC — campo `email` (E-mail) — payload SQLI1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `email`, insira exatamente: `' OR '1'='1` (valor completo no teste real: 11 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-009
Title: CLINIC — campo `email` (E-mail) — payload SQLI2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `email`, insira exatamente: `'; DROP TABLE orders; --` (valor completo no teste real: 24 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-010
Title: CLINIC — campo `email` (E-mail) — payload SQLI3
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `email`, insira exatamente: `1' UNION SELECT NULL--` (valor completo no teste real: 22 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-011
Title: CLINIC — campo `email` (E-mail) — payload XSS1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `email`, insira exatamente: `<script>alert(1)</script>` (valor completo no teste real: 25 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-012
Title: CLINIC — campo `email` (E-mail) — payload XSS2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `email`, insira exatamente: `<img src=x onerror=alert(1)>` (valor completo no teste real: 28 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-013
Title: CLINIC — campo `email` (E-mail) — payload LONG
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `email`, insira exatamente: `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA…[truncado no plano]` (valor completo no teste real: 10000 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-014
Title: CLINIC — campo `email` (E-mail) — payload EMOJI
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `email`, insira exatamente: `Teste 😀 ñ ç ã à` (valor completo no teste real: 15 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-015
Title: CLINIC — campo `password` (Senha) — payload SQLI1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `password`, insira exatamente: `' OR '1'='1` (valor completo no teste real: 11 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-016
Title: CLINIC — campo `password` (Senha) — payload SQLI2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `password`, insira exatamente: `'; DROP TABLE orders; --` (valor completo no teste real: 24 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-017
Title: CLINIC — campo `password` (Senha) — payload SQLI3
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `password`, insira exatamente: `1' UNION SELECT NULL--` (valor completo no teste real: 22 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-018
Title: CLINIC — campo `password` (Senha) — payload XSS1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `password`, insira exatamente: `<script>alert(1)</script>` (valor completo no teste real: 25 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-019
Title: CLINIC — campo `password` (Senha) — payload XSS2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `password`, insira exatamente: `<img src=x onerror=alert(1)>` (valor completo no teste real: 28 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-020
Title: CLINIC — campo `password` (Senha) — payload LONG
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `password`, insira exatamente: `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA…[truncado no plano]` (valor completo no teste real: 10000 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-021
Title: CLINIC — campo `password` (Senha) — payload EMOJI
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `password`, insira exatamente: `Teste 😀 ñ ç ã à` (valor completo no teste real: 15 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-022
Title: CLINIC — campo `confirm_password` (Confirmação de senha) — payload SQLI1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `confirm_password`, insira exatamente: `' OR '1'='1` (valor completo no teste real: 11 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-023
Title: CLINIC — campo `confirm_password` (Confirmação de senha) — payload SQLI2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `confirm_password`, insira exatamente: `'; DROP TABLE orders; --` (valor completo no teste real: 24 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-024
Title: CLINIC — campo `confirm_password` (Confirmação de senha) — payload SQLI3
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `confirm_password`, insira exatamente: `1' UNION SELECT NULL--` (valor completo no teste real: 22 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-025
Title: CLINIC — campo `confirm_password` (Confirmação de senha) — payload XSS1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `confirm_password`, insira exatamente: `<script>alert(1)</script>` (valor completo no teste real: 25 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-026
Title: CLINIC — campo `confirm_password` (Confirmação de senha) — payload XSS2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `confirm_password`, insira exatamente: `<img src=x onerror=alert(1)>` (valor completo no teste real: 28 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-027
Title: CLINIC — campo `confirm_password` (Confirmação de senha) — payload LONG
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `confirm_password`, insira exatamente: `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA…[truncado no plano]` (valor completo no teste real: 10000 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-028
Title: CLINIC — campo `confirm_password` (Confirmação de senha) — payload EMOJI
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `confirm_password`, insira exatamente: `Teste 😀 ñ ç ã à` (valor completo no teste real: 15 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-029
Title: CLINIC — campo `phone` (Telefone) — payload SQLI1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `phone`, insira exatamente: `' OR '1'='1` (valor completo no teste real: 11 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-030
Title: CLINIC — campo `phone` (Telefone) — payload SQLI2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `phone`, insira exatamente: `'; DROP TABLE orders; --` (valor completo no teste real: 24 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-031
Title: CLINIC — campo `phone` (Telefone) — payload SQLI3
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `phone`, insira exatamente: `1' UNION SELECT NULL--` (valor completo no teste real: 22 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-032
Title: CLINIC — campo `phone` (Telefone) — payload XSS1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `phone`, insira exatamente: `<script>alert(1)</script>` (valor completo no teste real: 25 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-033
Title: CLINIC — campo `phone` (Telefone) — payload XSS2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `phone`, insira exatamente: `<img src=x onerror=alert(1)>` (valor completo no teste real: 28 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-034
Title: CLINIC — campo `phone` (Telefone) — payload LONG
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `phone`, insira exatamente: `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA…[truncado no plano]` (valor completo no teste real: 10000 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-035
Title: CLINIC — campo `phone` (Telefone) — payload EMOJI
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `phone`, insira exatamente: `Teste 😀 ñ ç ã à` (valor completo no teste real: 15 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-036
Title: CLINIC — campo `trade_name` (Nome fantasia da clínica) — payload SQLI1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `trade_name`, insira exatamente: `' OR '1'='1` (valor completo no teste real: 11 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-037
Title: CLINIC — campo `trade_name` (Nome fantasia da clínica) — payload SQLI2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `trade_name`, insira exatamente: `'; DROP TABLE orders; --` (valor completo no teste real: 24 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-038
Title: CLINIC — campo `trade_name` (Nome fantasia da clínica) — payload SQLI3
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `trade_name`, insira exatamente: `1' UNION SELECT NULL--` (valor completo no teste real: 22 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-039
Title: CLINIC — campo `trade_name` (Nome fantasia da clínica) — payload XSS1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `trade_name`, insira exatamente: `<script>alert(1)</script>` (valor completo no teste real: 25 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-040
Title: CLINIC — campo `trade_name` (Nome fantasia da clínica) — payload XSS2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `trade_name`, insira exatamente: `<img src=x onerror=alert(1)>` (valor completo no teste real: 28 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-041
Title: CLINIC — campo `trade_name` (Nome fantasia da clínica) — payload LONG
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `trade_name`, insira exatamente: `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA…[truncado no plano]` (valor completo no teste real: 10000 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-042
Title: CLINIC — campo `trade_name` (Nome fantasia da clínica) — payload EMOJI
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `trade_name`, insira exatamente: `Teste 😀 ñ ç ã à` (valor completo no teste real: 15 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-043
Title: CLINIC — campo `cnpj` (CNPJ) — payload SQLI1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `cnpj`, insira exatamente: `' OR '1'='1` (valor completo no teste real: 11 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-044
Title: CLINIC — campo `cnpj` (CNPJ) — payload SQLI2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `cnpj`, insira exatamente: `'; DROP TABLE orders; --` (valor completo no teste real: 24 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-045
Title: CLINIC — campo `cnpj` (CNPJ) — payload SQLI3
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `cnpj`, insira exatamente: `1' UNION SELECT NULL--` (valor completo no teste real: 22 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-046
Title: CLINIC — campo `cnpj` (CNPJ) — payload XSS1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `cnpj`, insira exatamente: `<script>alert(1)</script>` (valor completo no teste real: 25 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-047
Title: CLINIC — campo `cnpj` (CNPJ) — payload XSS2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `cnpj`, insira exatamente: `<img src=x onerror=alert(1)>` (valor completo no teste real: 28 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-048
Title: CLINIC — campo `cnpj` (CNPJ) — payload LONG
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `cnpj`, insira exatamente: `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA…[truncado no plano]` (valor completo no teste real: 10000 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-049
Title: CLINIC — campo `cnpj` (CNPJ) — payload EMOJI
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `cnpj`, insira exatamente: `Teste 😀 ñ ç ã à` (valor completo no teste real: 15 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-050
Title: CLINIC — campo `address_line_1` (Endereço linha 1) — payload SQLI1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `address_line_1`, insira exatamente: `' OR '1'='1` (valor completo no teste real: 11 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-051
Title: CLINIC — campo `address_line_1` (Endereço linha 1) — payload SQLI2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `address_line_1`, insira exatamente: `'; DROP TABLE orders; --` (valor completo no teste real: 24 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-052
Title: CLINIC — campo `address_line_1` (Endereço linha 1) — payload SQLI3
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `address_line_1`, insira exatamente: `1' UNION SELECT NULL--` (valor completo no teste real: 22 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-053
Title: CLINIC — campo `address_line_1` (Endereço linha 1) — payload XSS1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `address_line_1`, insira exatamente: `<script>alert(1)</script>` (valor completo no teste real: 25 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-054
Title: CLINIC — campo `address_line_1` (Endereço linha 1) — payload XSS2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `address_line_1`, insira exatamente: `<img src=x onerror=alert(1)>` (valor completo no teste real: 28 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-055
Title: CLINIC — campo `address_line_1` (Endereço linha 1) — payload LONG
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `address_line_1`, insira exatamente: `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA…[truncado no plano]` (valor completo no teste real: 10000 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-056
Title: CLINIC — campo `address_line_1` (Endereço linha 1) — payload EMOJI
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `address_line_1`, insira exatamente: `Teste 😀 ñ ç ã à` (valor completo no teste real: 15 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-057
Title: CLINIC — campo `address_line_2` (Endereço linha 2) — payload SQLI1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `address_line_2`, insira exatamente: `' OR '1'='1` (valor completo no teste real: 11 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-058
Title: CLINIC — campo `address_line_2` (Endereço linha 2) — payload SQLI2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `address_line_2`, insira exatamente: `'; DROP TABLE orders; --` (valor completo no teste real: 24 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-059
Title: CLINIC — campo `address_line_2` (Endereço linha 2) — payload SQLI3
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `address_line_2`, insira exatamente: `1' UNION SELECT NULL--` (valor completo no teste real: 22 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-060
Title: CLINIC — campo `address_line_2` (Endereço linha 2) — payload XSS1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `address_line_2`, insira exatamente: `<script>alert(1)</script>` (valor completo no teste real: 25 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-061
Title: CLINIC — campo `address_line_2` (Endereço linha 2) — payload XSS2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `address_line_2`, insira exatamente: `<img src=x onerror=alert(1)>` (valor completo no teste real: 28 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-062
Title: CLINIC — campo `address_line_2` (Endereço linha 2) — payload LONG
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `address_line_2`, insira exatamente: `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA…[truncado no plano]` (valor completo no teste real: 10000 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-063
Title: CLINIC — campo `address_line_2` (Endereço linha 2) — payload EMOJI
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `address_line_2`, insira exatamente: `Teste 😀 ñ ç ã à` (valor completo no teste real: 15 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-064
Title: CLINIC — campo `city` (Cidade) — payload SQLI1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `city`, insira exatamente: `' OR '1'='1` (valor completo no teste real: 11 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-065
Title: CLINIC — campo `city` (Cidade) — payload SQLI2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `city`, insira exatamente: `'; DROP TABLE orders; --` (valor completo no teste real: 24 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-066
Title: CLINIC — campo `city` (Cidade) — payload SQLI3
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `city`, insira exatamente: `1' UNION SELECT NULL--` (valor completo no teste real: 22 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-067
Title: CLINIC — campo `city` (Cidade) — payload XSS1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `city`, insira exatamente: `<script>alert(1)</script>` (valor completo no teste real: 25 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-068
Title: CLINIC — campo `city` (Cidade) — payload XSS2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `city`, insira exatamente: `<img src=x onerror=alert(1)>` (valor completo no teste real: 28 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-069
Title: CLINIC — campo `city` (Cidade) — payload LONG
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `city`, insira exatamente: `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA…[truncado no plano]` (valor completo no teste real: 10000 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-070
Title: CLINIC — campo `city` (Cidade) — payload EMOJI
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `city`, insira exatamente: `Teste 😀 ñ ç ã à` (valor completo no teste real: 15 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-071
Title: CLINIC — campo `state` (UF) — payload SQLI1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `state`, insira exatamente: `' OR '1'='1` (valor completo no teste real: 11 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-072
Title: CLINIC — campo `state` (UF) — payload SQLI2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `state`, insira exatamente: `'; DROP TABLE orders; --` (valor completo no teste real: 24 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-073
Title: CLINIC — campo `state` (UF) — payload SQLI3
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `state`, insira exatamente: `1' UNION SELECT NULL--` (valor completo no teste real: 22 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-074
Title: CLINIC — campo `state` (UF) — payload XSS1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `state`, insira exatamente: `<script>alert(1)</script>` (valor completo no teste real: 25 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-075
Title: CLINIC — campo `state` (UF) — payload XSS2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `state`, insira exatamente: `<img src=x onerror=alert(1)>` (valor completo no teste real: 28 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-076
Title: CLINIC — campo `state` (UF) — payload LONG
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `state`, insira exatamente: `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA…[truncado no plano]` (valor completo no teste real: 10000 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

TC-1-CLINIC-INJ-077
Title: CLINIC — campo `state` (UF) — payload EMOJI
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo CLINIC; demais campos com dados válidos mínimos.
Steps:

1. No campo `state`, insira exatamente: `Teste 😀 ñ ç ã à` (valor completo no teste real: 15 chars para LONG).
2. Complete os outros campos obrigatórios com valores válidos.
3. Avance até enviar (com ou sem documentos conforme caso de teste).
   Expected result: Validação client e/ou server rejeita ou sanitiza; nunca HTTP 500; nenhum vazamento de SQL em resposta; persistência não armazena HTML executável que seja renderizado sem escape no admin.
   Actual result: [ ]
   Harm if bug exists: XSS armazenado no painel admin; SQLi se query concatenada (improvável com Supabase client, mas deve ser provado).
   Regulatory risk: LGPD

## 1.2 — Injeção e fuzzing por campo (cadastro MÉDICO)

TC-1-DOCTOR-INJ-001
Title: DOCTOR — campo `full_name` (Nome completo) — payload SQLI1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `full_name`, insira o payload SQLI1 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-002
Title: DOCTOR — campo `full_name` (Nome completo) — payload SQLI2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `full_name`, insira o payload SQLI2 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-003
Title: DOCTOR — campo `full_name` (Nome completo) — payload SQLI3
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `full_name`, insira o payload SQLI3 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-004
Title: DOCTOR — campo `full_name` (Nome completo) — payload XSS1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `full_name`, insira o payload XSS1 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-005
Title: DOCTOR — campo `full_name` (Nome completo) — payload XSS2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `full_name`, insira o payload XSS2 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-006
Title: DOCTOR — campo `full_name` (Nome completo) — payload LONG
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `full_name`, insira o payload LONG (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-007
Title: DOCTOR — campo `full_name` (Nome completo) — payload EMOJI
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `full_name`, insira o payload EMOJI (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-008
Title: DOCTOR — campo `email` (E-mail) — payload SQLI1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `email`, insira o payload SQLI1 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-009
Title: DOCTOR — campo `email` (E-mail) — payload SQLI2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `email`, insira o payload SQLI2 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-010
Title: DOCTOR — campo `email` (E-mail) — payload SQLI3
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `email`, insira o payload SQLI3 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-011
Title: DOCTOR — campo `email` (E-mail) — payload XSS1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `email`, insira o payload XSS1 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-012
Title: DOCTOR — campo `email` (E-mail) — payload XSS2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `email`, insira o payload XSS2 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-013
Title: DOCTOR — campo `email` (E-mail) — payload LONG
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `email`, insira o payload LONG (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-014
Title: DOCTOR — campo `email` (E-mail) — payload EMOJI
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `email`, insira o payload EMOJI (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-015
Title: DOCTOR — campo `password` (Senha) — payload SQLI1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `password`, insira o payload SQLI1 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-016
Title: DOCTOR — campo `password` (Senha) — payload SQLI2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `password`, insira o payload SQLI2 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-017
Title: DOCTOR — campo `password` (Senha) — payload SQLI3
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `password`, insira o payload SQLI3 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-018
Title: DOCTOR — campo `password` (Senha) — payload XSS1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `password`, insira o payload XSS1 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-019
Title: DOCTOR — campo `password` (Senha) — payload XSS2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `password`, insira o payload XSS2 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-020
Title: DOCTOR — campo `password` (Senha) — payload LONG
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `password`, insira o payload LONG (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-021
Title: DOCTOR — campo `password` (Senha) — payload EMOJI
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `password`, insira o payload EMOJI (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-022
Title: DOCTOR — campo `confirm_password` (Confirmação de senha) — payload SQLI1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `confirm_password`, insira o payload SQLI1 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-023
Title: DOCTOR — campo `confirm_password` (Confirmação de senha) — payload SQLI2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `confirm_password`, insira o payload SQLI2 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-024
Title: DOCTOR — campo `confirm_password` (Confirmação de senha) — payload SQLI3
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `confirm_password`, insira o payload SQLI3 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-025
Title: DOCTOR — campo `confirm_password` (Confirmação de senha) — payload XSS1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `confirm_password`, insira o payload XSS1 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-026
Title: DOCTOR — campo `confirm_password` (Confirmação de senha) — payload XSS2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `confirm_password`, insira o payload XSS2 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-027
Title: DOCTOR — campo `confirm_password` (Confirmação de senha) — payload LONG
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `confirm_password`, insira o payload LONG (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-028
Title: DOCTOR — campo `confirm_password` (Confirmação de senha) — payload EMOJI
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `confirm_password`, insira o payload EMOJI (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-029
Title: DOCTOR — campo `phone` (Telefone) — payload SQLI1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `phone`, insira o payload SQLI1 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-030
Title: DOCTOR — campo `phone` (Telefone) — payload SQLI2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `phone`, insira o payload SQLI2 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-031
Title: DOCTOR — campo `phone` (Telefone) — payload SQLI3
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `phone`, insira o payload SQLI3 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-032
Title: DOCTOR — campo `phone` (Telefone) — payload XSS1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `phone`, insira o payload XSS1 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-033
Title: DOCTOR — campo `phone` (Telefone) — payload XSS2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `phone`, insira o payload XSS2 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-034
Title: DOCTOR — campo `phone` (Telefone) — payload LONG
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `phone`, insira o payload LONG (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-035
Title: DOCTOR — campo `phone` (Telefone) — payload EMOJI
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `phone`, insira o payload EMOJI (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-036
Title: DOCTOR — campo `crm` (CRM) — payload SQLI1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `crm`, insira o payload SQLI1 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-037
Title: DOCTOR — campo `crm` (CRM) — payload SQLI2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `crm`, insira o payload SQLI2 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-038
Title: DOCTOR — campo `crm` (CRM) — payload SQLI3
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `crm`, insira o payload SQLI3 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-039
Title: DOCTOR — campo `crm` (CRM) — payload XSS1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `crm`, insira o payload XSS1 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-040
Title: DOCTOR — campo `crm` (CRM) — payload XSS2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `crm`, insira o payload XSS2 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-041
Title: DOCTOR — campo `crm` (CRM) — payload LONG
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `crm`, insira o payload LONG (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-042
Title: DOCTOR — campo `crm` (CRM) — payload EMOJI
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `crm`, insira o payload EMOJI (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-043
Title: DOCTOR — campo `crm_state` (UF do CRM) — payload SQLI1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `crm_state`, insira o payload SQLI1 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-044
Title: DOCTOR — campo `crm_state` (UF do CRM) — payload SQLI2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `crm_state`, insira o payload SQLI2 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-045
Title: DOCTOR — campo `crm_state` (UF do CRM) — payload SQLI3
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `crm_state`, insira o payload SQLI3 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-046
Title: DOCTOR — campo `crm_state` (UF do CRM) — payload XSS1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `crm_state`, insira o payload XSS1 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-047
Title: DOCTOR — campo `crm_state` (UF do CRM) — payload XSS2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `crm_state`, insira o payload XSS2 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-048
Title: DOCTOR — campo `crm_state` (UF do CRM) — payload LONG
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `crm_state`, insira o payload LONG (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-049
Title: DOCTOR — campo `crm_state` (UF do CRM) — payload EMOJI
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `crm_state`, insira o payload EMOJI (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-050
Title: DOCTOR — campo `specialty` (Especialidade) — payload SQLI1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `specialty`, insira o payload SQLI1 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-051
Title: DOCTOR — campo `specialty` (Especialidade) — payload SQLI2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `specialty`, insira o payload SQLI2 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-052
Title: DOCTOR — campo `specialty` (Especialidade) — payload SQLI3
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `specialty`, insira o payload SQLI3 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-053
Title: DOCTOR — campo `specialty` (Especialidade) — payload XSS1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `specialty`, insira o payload XSS1 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-054
Title: DOCTOR — campo `specialty` (Especialidade) — payload XSS2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `specialty`, insira o payload XSS2 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-055
Title: DOCTOR — campo `specialty` (Especialidade) — payload LONG
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `specialty`, insira o payload LONG (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-056
Title: DOCTOR — campo `specialty` (Especialidade) — payload EMOJI
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `specialty`, insira o payload EMOJI (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-057
Title: DOCTOR — campo `clinic_cnpj` (CNPJ da clínica vinculada) — payload SQLI1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `clinic_cnpj`, insira o payload SQLI1 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-058
Title: DOCTOR — campo `clinic_cnpj` (CNPJ da clínica vinculada) — payload SQLI2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `clinic_cnpj`, insira o payload SQLI2 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-059
Title: DOCTOR — campo `clinic_cnpj` (CNPJ da clínica vinculada) — payload SQLI3
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `clinic_cnpj`, insira o payload SQLI3 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-060
Title: DOCTOR — campo `clinic_cnpj` (CNPJ da clínica vinculada) — payload XSS1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `clinic_cnpj`, insira o payload XSS1 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-061
Title: DOCTOR — campo `clinic_cnpj` (CNPJ da clínica vinculada) — payload XSS2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `clinic_cnpj`, insira o payload XSS2 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-062
Title: DOCTOR — campo `clinic_cnpj` (CNPJ da clínica vinculada) — payload LONG
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `clinic_cnpj`, insira o payload LONG (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-063
Title: DOCTOR — campo `clinic_cnpj` (CNPJ da clínica vinculada) — payload EMOJI
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `clinic_cnpj`, insira o payload EMOJI (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-064
Title: DOCTOR — campo `clinic_name` (Nome da clínica vinculada) — payload SQLI1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `clinic_name`, insira o payload SQLI1 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-065
Title: DOCTOR — campo `clinic_name` (Nome da clínica vinculada) — payload SQLI2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `clinic_name`, insira o payload SQLI2 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-066
Title: DOCTOR — campo `clinic_name` (Nome da clínica vinculada) — payload SQLI3
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `clinic_name`, insira o payload SQLI3 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-067
Title: DOCTOR — campo `clinic_name` (Nome da clínica vinculada) — payload XSS1
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `clinic_name`, insira o payload XSS1 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-068
Title: DOCTOR — campo `clinic_name` (Nome da clínica vinculada) — payload XSS2
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `clinic_name`, insira o payload XSS2 (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-069
Title: DOCTOR — campo `clinic_name` (Nome da clínica vinculada) — payload LONG
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `clinic_name`, insira o payload LONG (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

TC-1-DOCTOR-INJ-070
Title: DOCTOR — campo `clinic_name` (Nome da clínica vinculada) — payload EMOJI
Severity: HIGH
Area: Registration / injection
Precondition: Fluxo `/registro`, tipo DOCTOR; demais campos válidos.
Steps:

1. No campo `clinic_name`, insira o payload EMOJI (valor completo conforme matriz de payloads).
2. Complete os outros campos obrigatórios com valores válidos.
3. Envie o cadastro.
   Expected result: Mesmas expectativas de TC-1-CLINIC-INJ-\*.
   Actual result: [ ]
   Harm if bug exists: Idem injeção.
   Regulatory risk: LGPD

## 1.3 — Login e sessão (Supabase)

TC-1-200
Title: Login credenciais válidas — portal correto por papel
Severity: HIGH
Area: Auth / routing
Precondition: Usuários seed com `CLINIC_ADMIN`, `PHARMACY_ADMIN`, `SUPER_ADMIN` (ver `docs/seed-users.md`).
Steps:

1. Acesse `/login` e autentique com `CLINIC_ADMIN`.
2. Verifique redirecionamento para área privada e itens de menu coerentes (pedidos, catálogo conforme RBAC).
3. Repita para `PHARMACY_ADMIN` e `SUPER_ADMIN`.
   Expected result: Nenhum acesso a `/unauthorized` indevido; sidebar reflete `components/layout/sidebar.tsx`.
   Actual result: [ ]
   Harm if bug exists: Escalação de privilégio por rota errada.
   Regulatory risk: LGPD

TC-1-201
Title: Senha incorreta — mensagem genérica (anti-enumeración)
Severity: MEDIUM
Area: Login
Precondition: E-mail existente.
Steps:

1. Informe e-mail válido e senha errada.
   Expected result: Mensagem que não confirme explicitamente "e-mail não cadastrado" vs "senha errada" de forma divergente (comparar com e-mail inexistente).
   Actual result: [ ]
   Harm if bug exists: Enumeração de contas.
   Regulatory risk: LGPD

TC-1-202
Title: E-mail inexistente — mesma classe de erro que senha errada
Severity: MEDIUM
Area: Login
Precondition: Nenhum.
Steps:

1. Informe e-mail que não existe e senha qualquer.
   Expected result: Resposta equivalente a TC-1-201.
   Actual result: [ ]
   Harm if bug exists: Enumeração.
   Regulatory risk: LGPD

TC-1-203
Title: JWT de outro projeto (tampered) — sessão inválida
Severity: CRITICAL
Area: Session
Precondition: Cookie de sessão manipulável no browser (DevTools).
Steps:

1. Altere um byte do token JWT no cookie da aplicação.
2. Navegue para `/orders`.
   Expected result: Redirecionamento para login ou 401; nunca dados de terceiros.
   Actual result: [ ]
   Harm if bug exists: Quebra de autenticação.
   Regulatory risk: LGPD

TC-1-204
Title: Desativação de usuário — sessão revogada (blacklist)
Severity: CRITICAL
Area: `revoked_tokens`
Precondition: Dois browsers: A logado; B como admin desativa A.
Steps:

1. Com usuário A autenticado, admin desativa A.
2. A tenta navegar ou chamar API autenticada.
   Expected result: Acesso negado imediato conforme `known-limitations` v3.0.0.
   Actual result: [ ]
   Harm if bug exists: Usuário desligado ainda opera.
   Regulatory risk: LGPD

TC-1-205
Title: Troca de senha — tokens antigos invalidados
Severity: HIGH
Area: Password / revocation
Precondition: Fluxo de recuperação em `/reset-password` ou alteração no perfil se existir.
Steps:

1. Com sessão S1 ativa, complete troca de senha.
2. Com o mesmo browser (sem novo login), tente acessar recurso protegido.
   Expected result: S1 invalidada; novo login exigido.
   Actual result: [ ]
   Harm if bug exists: Sessão antiga permanece válida após troca.
   Regulatory risk: none

## 1.4 — Recuperação de senha

TC-1-210
Title: Link de reset válido — uso único
Severity: HIGH
Area: `/api/auth/forgot-password` + fluxo Supabase
Precondition: E-mail de conta real em ambiente de teste.
Steps:

1. Solicite reset; abra link do e-mail.
2. Defina nova senha; confirme login.
3. Reabra o mesmo link do e-mail.
   Expected result: Segundo uso rejeitado ou link expirado.
   Actual result: [ ]
   Harm if bug exists: Reutilização de token de reset.
   Regulatory risk: LGPD

TC-1-211
Title: Link de reset expirado (simular >24h se política Supabase)
Severity: MEDIUM
Area: forgot-password
Precondition: Token salvo e data alterada OU aguardar janela real.
Steps:

1. Use link após expiração configurada no Supabase.
   Expected result: Erro claro; opção de solicitar novo e-mail.
   Actual result: [ ]
   Harm if bug exists: Confusão ou bypass de expiração.
   Regulatory risk: none

## 1.5 — RBAC em endpoints (amostra obrigatória — expandir a todas as rotas em `app/api`)

TC-1-300
Title: `CLINIC_ADMIN` — GET `/api/admin/coupons` → 403
Severity: CRITICAL
Area: RBAC
Precondition: JWT de `CLINIC_ADMIN`.
Steps:

1. Chame GET com header de sessão válida de clínica.
   Expected result: 403 ou 401; nunca 200 com lista de cupons admin.
   Actual result: [ ]
   Harm if bug exists: Vazamento de dados administrativos.
   Regulatory risk: LGPD

TC-1-301
Title: `PHARMACY_ADMIN` — POST `/api/admin/coupons` → 403
Severity: CRITICAL
Area: RBAC
Precondition: JWT farmácia.
Steps:

1. POST corpo mínimo válido de criação de cupom.
   Expected result: 403.
   Actual result: [ ]
   Harm if bug exists: Criação fraudulenta de cupons.
   Regulatory risk: FISCAL (margem), LGPD

TC-1-302
Title: Não autenticado — GET `/api/coupons/mine` → 401
Severity: HIGH
Area: RBAC
Precondition: Sem cookies de sessão.
Steps:

1. curl sem credencial.
   Expected result: 401.
   Actual result: [ ]
   Harm if bug exists: Exposição de cupons.
   Regulatory risk: LGPD

TC-1-303
Title: `DOCTOR` — GET `/api/products/{id}/recommendations` → 200 se permitido
Severity: MEDIUM
Area: RBAC
Precondition: Produto com ou sem associações.
Steps:

1. Autentique como médico; chame endpoint.
   Expected result: 200 com lista (pode ser vazia); conforme `requireRole` na rota.
   Actual result: [ ]
   Harm if bug exists: Bloqueio indevido ou vazamento.
   Regulatory risk: none

TC-1-304
Title: `CLINIC_ADMIN` — POST `/api/admin/registrations/{id}/ocr` → 403
Severity: HIGH
Area: RBAC / IA
Precondition: ID de registro existente.
Steps:

1. Chame OCR como clínica.
   Expected result: 403 (rota restrita a SUPER/PLATFORM admin).
   Actual result: [ ]
   Harm if bug exists: Processamento Vision não autorizado; custo e LGPD.
   Regulatory risk: LGPD

# SECTION 2 — CLINIC PORTAL: ORDER FLOW

> **Nota:** Não existe “perfil de preço B” separado do prompt genérico salvo que “clínica A não vê preço B” — validar contra `orders` e `products` reais (preço congelado no item).

TC-2-001
Title: Catálogo carrega apenas produtos `active` para papel clínica
Severity: HIGH
Area: Catálogo
Precondition: Produto `inactive` e `active` existentes.
Steps:

1. Navegue catálogo como `CLINIC_ADMIN`.
   Expected result: Inativos não pedíveis.
   Actual result: [ ]
   Harm if bug exists: Pedido de SKU indevido.
   Regulatory risk: ANVISA

TC-2-002
Title: Carrinho — bloqueio de mistura de farmácias
Severity: CRITICAL
Area: Pedidos — `known-limitations` linha 48
Precondition: Produtos de farmácias F1 e F2.
Steps:

1. Adicione item de F1; tente adicionar item de F2.
   Expected result: Bloqueio com mensagem clara.
   Actual result: [ ]
   Harm if bug exists: Quebra de repasse manual e reconciliação.
   Regulatory risk: FISCAL

TC-2-003
Title: Checkout duplo (double-click) — um único pedido
Severity: HIGH
Area: Orders create
Precondition: Carrinho válido.
Steps:

1. Submeta checkout com dois cliques <300ms.
   Expected result: Um `order_id` ou segundo rejeitado idempotentemente.
   Actual result: [ ]
   Harm if bug exists: Cobrança duplicada / pedido duplicado.
   Regulatory risk: FISCAL

TC-2-004
Title: Preço no detalhe do pedido — reflete `freeze_order_item_price` + cupom
Severity: HIGH
Area: Cupons v5.3.x
Precondition: Cupom ativo para (clínica, produto).
Steps:

1. Crie pedido com item elegível.
2. Abra `/orders/{id}`.
   Expected result: `discount_amount`, `coupon_id` coerentes; total líquido correto.
   Actual result: [ ]
   Harm if bug exists: Perda financeira plataforma ou clínica.
   Regulatory risk: FISCAL

TC-2-005
Title: Lista de pedidos — apenas pedidos da clínica do usuário (IDOR)
Severity: CRITICAL
Area: RLS + UI
Precondition: Duas clínicas com pedidos.
Steps:

1. Como clínica A, inspecione resposta de API/lista e tente acessar `/orders/{id}` de B por URL direta.
   Expected result: 404 ou 403.
   Actual result: [ ]
   Harm if bug exists: Vazamento comercial e LGPD.
   Regulatory risk: LGPD

# SECTION 3 — PHARMACY PORTAL

TC-3-001
Title: Farmácia vê apenas pedidos atribuídos à sua farmácia
Severity: CRITICAL
Area: IDOR
Precondition: Pedidos de duas farmácias.
Steps:

1. Login `PHARMACY_ADMIN` F1; enumere IDs.
   Expected result: Nenhum pedido de F2 visível.
   Actual result: [ ]
   Harm if bug exists: LGPD + segredo comercial.
   Regulatory risk: LGPD

TC-3-002
Title: Farmácia não altera preço após criação do pedido
Severity: HIGH
Area: Imutabilidade de preço
Precondition: Pedido em status editável se existir.
Steps:

1. Tente PATCH/ação que altere `unit_price` via API forjada.
   Expected result: Rejeição; preço congelado por trigger.
   Actual result: [ ]
   Harm if bug exists: Fraude fiscal/comercial.
   Regulatory risk: FISCAL

# SECTION 4 — COMPLIANCE ENGINE (ANVISA / documentos)

TC-4-000
Title: **N/A** — Validação ANVISA API em tempo de transação
Severity: LOW (documentação)
Area: Compliance
Precondition: Leitura de `docs/roadmap-90pts.md` e `lib/compliance.ts`.
Steps:

1. Confirmar ausência de integração oficial obrigatória no MVP.
   Expected result: Testes 4.1.x do prompt genérico marcados N/A até integração; validação manual/documental no cadastro.
   Actual result: [ ]
   Harm if bug exists: Expectativa regulatória desalinhada.
   Regulatory risk: ANVISA (processo, não bug de software)

TC-4-001
Title: Documentos de cadastro — apenas tipos exigidos em `CLINIC_REQUIRED_DOCS`
Severity: HIGH
Area: Registration
Precondition: Cadastro clínica.
Steps:

1. Tente enviar apenas subset incompleto; depois completo.
   Expected result: Status `PENDING_DOCS` quando sem docs; fluxo documentado v5.2.0.
   Actual result: [ ]
   Harm if bug exists: Aprovação sem documentação.
   Regulatory risk: ANVISA

# SECTION 5 — PAYMENT LAYER

TC-5-000
Title: **N/A** — Split automático 5% plataforma vs 95% farmácia em tempo real
Severity: LOW (doc)
Area: Payments
Precondition: `known-limitations` — repasse manual.
Steps:

1. Documentar que o teste de split do prompt não se aplica; validar em vez disso liquidação Asaas sandbox + repasse manual no painel admin.
   Expected result: Comportamento alinhado à documentação.
   Actual result: [ ]
   Harm if bug exists: Auditoria financeira errada se alguém assume split auto.
   Regulatory risk: FISCAL

TC-5-001
Title: Webhook Asaas — assinatura inválida rejeitada
Severity: CRITICAL
Area: `/api/payments/asaas/webhook`
Precondition: Secret configurado.
Steps:

1. POST payload válido com header de assinatura errada.
   Expected result: 401/403; sem alteração de estado de pedido.
   Actual result: [ ]
   Harm if bug exists: Confirmação de pagamento fraudulenta.
   Regulatory risk: FISCAL

TC-5-002
Title: Webhook Asaas — idempotência (mesmo evento 2x)
Severity: HIGH
Area: Webhook
Precondition: Evento de pagamento confirmado.
Steps:

1. Reenvie o mesmo `payment_id` confirmado.
   Expected result: Estado estável; sem double credit.
   Actual result: [ ]
   Harm if bug exists: Inconsistência contábil.
   Regulatory risk: FISCAL

# SECTION 6 — DATA LAYER

TC-6-001
Title: Valores monetários — armazenamento em centavos / numeric consistente
Severity: HIGH
Area: DB schema
Precondition: Acesso read-only ao SQL ou inspeção via Supabase Studio.
Steps:

1. Verifique tipo das colunas de preço em `order_items` e `products`.
   Expected result: Sem float IEEE para totais críticos; arredondamento BRL correto na UI.
   Actual result: [ ]
   Harm if bug exists: Centavos perdidos em escala.
   Regulatory risk: FISCAL

TC-6-002
Title: **Parcial** — Sessão em Redis
Severity: LOW
Area: Infra
Precondition: Doc.
Steps:

1. Confirmar que invalidação de sessão passa por `revoked_tokens` e não apenas Redis session store.
   Expected result: Alinhado à arquitetura real.
   Actual result: [ ]
   Harm if bug exists: Falsa suposição de ops.
   Regulatory risk: none

TC-6-003
Title: Storage — bucket `registration-documents` não público
Severity: CRITICAL
Area: Supabase Storage
Precondition: Supabase dashboard.
Steps:

1. Tente acessar objeto sem `createSignedUrl`.
   Expected result: 403 da storage API.
   Actual result: [ ]
   Harm if bug exists: Vazamento de documentos.
   Regulatory risk: LGPD

# SECTION 7 — API SECURITY

TC-7-001
Title: Rate limit — burst em `/api/auth/forgot-password`
Severity: HIGH
Area: Upstash
Precondition: IP de teste.
Steps:

1. Envie > limite configurado de POSTs em 1 minuto.
   Expected result: 429 após threshold; corpo sem stack trace.
   Actual result: [ ]
   Harm if bug exists: Abuso de e-mail / DoS.
   Regulatory risk: LGPD

TC-7-002
Title: BOLA — tracking público `/api/tracking` com token UUID inválido
Severity: MEDIUM
Area: tracking
Precondition: Token inválido.
Steps:

1. GET com token aleatório.
   Expected result: 404 genérico; sem dados de pedido real.
   Actual result: [ ]
   Harm if bug exists: Enumeração de pedidos.
   Regulatory risk: LGPD

TC-7-003
Title: HSTS e cookies — inspeção de headers em produção
Severity: HIGH
Area: Transport
Precondition: Deploy Vercel.
Steps:

1. `curl -I https://clinipharma.com.br` (ou domínio real).
   Expected result: HSTS presente conforme `known-limitations` segurança.
   Actual result: [ ]
   Harm if bug exists: MITM.
   Regulatory risk: LGPD

# SECTION 8 — LGPD & REGULATORY

TC-8-001
Title: `/privacy` e `/terms` acessíveis sem login
Severity: HIGH
Area: Middleware — v5.1.4
Precondition: Logout completo.
Steps:

1. GET `/privacy` e `/terms`.
   Expected result: 200; smoke E2E já cobre regressão.
   Actual result: [ ]
   Harm if bug exists: Não conformidade Art. 8 LGPD.
   Regulatory risk: LGPD

TC-8-002
Title: Export LGPD — `GET /api/lgpd/export` autenticado
Severity: HIGH
Area: Portabilidade
Precondition: Usuário com dados.
Steps:

1. Solicite export pelo fluxo `/profile/privacy`.
   Expected result: JSON completo; prazo conforme política interna.
   Actual result: [ ]
   Harm if bug exists: Direito do titular violado.
   Regulatory risk: LGPD

TC-8-003
Title: Retenção — cron `enforce-retention` não apaga financeiros <10 anos
Severity: CRITICAL
Area: Retenção
Precondition: Dados de teste datados.
Steps:

1. Revisar lógica e executar cron em staging com cópia anonimizada.
   Expected result: Pedidos/pagamentos preservados conforme tabela em `lgpd-registro-atividades.md`.
   Actual result: [ ]
   Harm if bug exists: Crime de destruição de documento fiscal.
   Regulatory risk: FISCAL + LGPD

# SECTION 9 — INFRASTRUCTURE & RESILIENCE

TC-9-001
Title: **N/A** — Failover PostgreSQL manual test (réplica)
Severity: LOW
Area: DR
Precondition: `docs/disaster-recovery.md` — Supabase gerenciado.
Steps:

1. Documentar que RTO/RPO é responsabilidade do provedor + plano Supabase; teste manual de restore conforme doc.
   Expected result: Procedimento documentado, não TC automatizável no MVP.
   Actual result: [ ]

TC-9-002
Title: Healthcheck `/api/health` — circuit breakers expostos sem segredo
Severity: MEDIUM
Area: Observability
Precondition: Público conforme middleware.
Steps:

1. GET `/api/health`.
   Expected result: Status agregado; **sem** expor secrets; sem stack traces.
   Actual result: [ ]
   Harm if bug exists: Information disclosure.
   Regulatory risk: none

TC-9-003
Title: CI — workflow GitHub em PR
Severity: MEDIUM
Area: CI/CD
Precondition: Repo GitHub.
Steps:

1. Abra PR de branch feature; verifique checks.
   Expected result: lint + unit + TS (+ E2E conforme workflow).
   Actual result: [ ]
   Harm if bug exists: Regressão em main.
   Regulatory risk: none

# SECTION 10 — FRONTEND & UX

TC-10-001
Title: Mobile 320px — pedidos e catálogo sem scroll horizontal crítico
Severity: MEDIUM
Area: Responsive
Precondition: DevTools device mode.
Steps:

1. Percorra fluxos principais.
   Expected result: Usável; backlog WCAG em `PENDING.md` #25.
   Actual result: [ ]
   Harm if bug exists: Perda de conversão.
   Regulatory risk: none

TC-10-002
Title: Back button após criar pedido — não duplica POST
Severity: HIGH
Area: Navigation
Precondition: Pedido criado com sucesso.
Steps:

1. Após sucesso, use "voltar" e "avançar" no browser.
   Expected result: Não cria segundo pedido silenciosamente.
   Actual result: [ ]
   Harm if bug exists: Pedidos duplicados.
   Regulatory risk: FISCAL

# SECTION 11 — ADMIN PANEL

TC-11-001
Title: Apenas `SUPER_ADMIN` / `PLATFORM_ADMIN` acessam ações destrutivas globais
Severity: CRITICAL
Area: Admin
Precondition: Roles.
Steps:

1. Tentar acessar páginas admin com `SALES_CONSULTANT` onde não permitido.
   Expected result: `/unauthorized` ou 403.
   Actual result: [ ]
   Harm if bug exists: Escalação.
   Regulatory risk: LGPD

TC-11-002
Title: Painel de cadastros — drafts e lead score visíveis apenas admin
Severity: HIGH
Area: Registrations / IA lead score
Precondition: Drafts existentes.
Steps:

1. Como clínica, tente `/registrations` direto.
   Expected result: Bloqueado.
   Actual result: [ ]
   Harm if bug exists: Vazamento de leads.
   Regulatory risk: LGPD

TC-11-003
Title: **N/A** — Dashboard ANVISA expiração automática de licenças de todas farmácias
Severity: LOW
Area: Product
Precondition: Roadmap.
Steps:

1. Se não existir UI dedicada, marcar N/A e abrir item de roadmap.
   Expected result: Transparência de escopo.
   Actual result: [ ]

# PARTE B — AUDITORIA DE IA (OpenAI / v6.0.0)

> **Alinhamento:** Feature 7 (recomendações) é **100% SQL/Apriori** — não existe camada LLM de “explicação” no código atual. TC-AI-7-300+ tratam ausência de LLM como verificação negativa.

---

# SECTION AI-0 — `lib/ai.ts` INFRAESTRUTURA

TC-AI-0-001
Title: API key apenas em `process.env.OPENAI_API_KEY` — nunca em bundle cliente
Severity: CRITICAL
Failure mode: DATA_LEAK
Precondition: Build de produção.
Steps:

1. Execute `grep -R "sk-" .next/static` e `strings` no chunk público (ou busca no sourcemap desabilitado em prod).
2. Verifique que `lib/ai.ts` importa `server-only`.
   Expected result: Nenhuma chave em artefatos públicos.
   Actual result: [ ]
   Harm if bug exists: Conta OpenAI comprometida; custo ilimitado.
   Regulatory risk: LGPD (se vazamento incluir contexto PII em logs); FISCAL se custo abusivo após vazamento de chave
   AI-specific note: Chave LLM é equivalente a credencial de produção bancária.

TC-AI-0-002
Title: `git log -S "sk-proj"` e `-S "sk-"` — histórico limpo
Severity: CRITICAL
Failure mode: DATA_LEAK
Precondition: Repositório local clone.
Steps:

1. `git log -S"sk-proj" --oneline --all`
   Expected result: Nenhum commit com chave real (`.env.local` está gitignored).
   Actual result: [ ]
   Harm if bug exists: Chave permanece em histórico público GitHub.
   Regulatory risk: none

TC-AI-0-003
Title: Rotação de chave sem rebuild — cold start Vercel pega novo env
Severity: MEDIUM
Failure mode: SILENT_FAILURE
Precondition: Documentação Vercel.
Steps:

1. Altere `OPENAI_API_KEY` no painel Vercel; redeploy ou aguarde novo lambda.
2. Dispare classificação de ticket.
   Expected result: `_client` singleton reinicializa em novo isolate (validar empiricamente — pode requerer redeploy forçado se isolate long-lived).
   Actual result: [ ]
   Harm if bug exists: Janela onde chamadas falham após rotação.
   Regulatory risk: none
   AI-specific note: Singleton em serverless pode exigir redeploy explícito — documentar runbook.

TC-AI-0-004
Title: HTTP 429 OpenAI — circuit breaker + retorno null sem 500 ao usuário
Severity: HIGH
Failure mode: COST_EXPLOSION / LATENCY
Precondition: Simular 429 (mock em staging ou intercept proxy).
Steps:

1. Force `withCircuitBreaker` a receber 429 repetidos.
2. Crie ticket de suporte.
   Expected result: Ticket criado; classificação pode permanecer default até recuperação; página não 500.
   Actual result: [ ]
   Harm if bug exists: Indisponibilidade total da plataforma de suporte.
   Regulatory risk: none

TC-AI-0-005
Title: JSON malformado do modelo — `classifyTicket` retorna null, não throw até UI
Severity: HIGH
Failure mode: SILENT_FAILURE
Precondition: Mock OpenAI retornando `{invalid`.
Steps:

1. Unit já cobre parcialmente; validar integração.
   Expected result: Sem uncaught exception no route handler.
   Actual result: [ ]
   Harm if bug exists: Página de suporte quebrada.
   Regulatory risk: none

TC-AI-0-006
Title: Categoria fora do enum — rejeitada (código real em `classifyTicket`)
Severity: MEDIUM
Failure mode: WRONG_OUTPUT
Precondition: Mock retornando category FAKE.
Steps:

1. Ver comportamento.
   Expected result: null; ticket não atualizado com categoria inválida.
   Actual result: [ ]
   Harm if bug exists: Roteamento errado.
   Regulatory risk: none

TC-AI-0-007
Title: **GAP identificado em código** — `analyzeSentiment` não valida enum após `JSON.parse`
Severity: HIGH
Failure mode: WRONG_OUTPUT
Precondition: Leitura de `lib/ai.ts` linhas ~147-148.
Steps:

1. Mock retornando `"sentiment":"happy"` inválido.
2. Chame fluxo `addMessage` em staging.
   Expected result: **Ideal:** null + fallback; **Atual:** verificar se TypeScript/runtime aceita valor inválido no INSERT — risco de violação CHECK no DB ou string suja.
   Actual result: [ ]
   Harm if bug exists: Dados inválidos em `support_messages.sentiment`; possível 500.
   Regulatory risk: LGPD
   AI-specific note: `classifyTicket` valida; `analyzeSentiment` não — inconsistência perigosa.
   Regulatory risk (fix): none

TC-AI-0-008
Title: Ausência de log estruturado de tokens/custo por chamada
Severity: MEDIUM
Failure mode: COST_EXPLOSION
Precondition: Código.
Steps:

1. Verificar se `usage` de `chat.completions` é persistido em BD ou apenas logger.debug.
   Expected result: Para auditoria financeira de IA, ideal logar prompt_tokens/completion_tokens em tabela — se não existir, registrar como débito técnico.
   Actual result: [ ]
   Harm if bug exists: Impossível auditar custo por clínica/feature.
   Regulatory risk: none

TC-AI-0-009
Title: Model pinning — uso de `gpt-4o-mini` e `gpt-4o` sem data no nome
Severity: MEDIUM
Failure mode: WRONG_OUTPUT
Precondition: OpenAI docs.
Steps:

1. Confirmar que alias `gpt-4o-mini` pode mudar comportamento quando OpenAI atualizar.
   Expected result: Processo de QA quando OpenAI anunciar deprecação.
   Actual result: [ ]
   Harm if bug exists: Drift de classificação silencioso.
   Regulatory risk: none

TC-AI-0-010
Title: Temperatura — classificação/OCR usam 0 ou 0.1; contrato usa 0.3
Severity: HIGH
Failure mode: HALLUCINATION
Precondition: Código.
Steps:

1. Gerar contrato 10x com mesmos dados; comparar diferenças.
   Expected result: Documentar variância aceitável; cláusulas críticas não devem variar se template jurídico exigir determinismo.
   Actual result: [ ]
   Harm if bug exists: Contrato com cláusula inventada (litígio).
   Regulatory risk: LGPD + FISCAL (contrato)
   AI-specific note: Temperatura >0 em contrato é risco jurídico elevado.

---

# SECTION AI-1 — FEATURE 1 Reorder alerts (heurística)

TC-AI-1-001
Title: Clínica com <5 pedidos completos — sem alerta (MIN_ORDERS=5)
Severity: MEDIUM
Failure mode: WRONG_OUTPUT
Precondition: Clínica com 4 pedidos COMPLETED.
Steps:

1. Execute job ou cron autenticado.
   Expected result: Nenhuma notificação `REORDER_ALERT` para esse par.
   Actual result: [ ]
   Harm if bug exists: Spam ou cálculo instável.
   Regulatory risk: none

TC-AI-1-002
Title: Pedidos cancelados não entram no cálculo
Severity: HIGH
Failure mode: WRONG_OUTPUT
Precondition: Mistura de status.
Steps:

1. Verificar query em `reorder-alerts.ts` usa apenas COMPLETED/DELIVERED/SHIPPED.
   Expected result: Cancelados excluídos.
   Actual result: [ ]
   Harm if bug exists: Previsão errada.
   Regulatory risk: none

TC-AI-1-003
Title: Fuso — job usa UTC; notificação aceitável para admin Brasil
Severity: LOW
Failure mode: UX
Precondition: Pedido timestamps UTC.
Steps:

1. Validar copy da notificação menciona prazo coerente.
   Expected result: Sem promessa de horário local se não implementado.
   Actual result: [ ]

---

# SECTION AI-2 — Churn (interno)

TC-AI-2-001
Title: Endpoint churn não visível para `CLINIC_ADMIN`
Severity: CRITICAL
Failure mode: DATA_LEAK
Precondition: JWT clínica.
Steps:

1. Chamar `/api/cron/churn-check` sem secret — esperado 401; com secret de cron — apenas infra.
2. Verificar ausência de UI churn em portal clínica.
   Expected result: Conforme `known-limitations` — churn interno.
   Actual result: [ ]
   Harm if bug exists: Clínica vê score negativo — relação comercial prejudicada; LGPD (perfilização).
   Regulatory risk: LGPD

---

# SECTION AI-3 — Lead score (heurística)

TC-AI-3-001
Title: Lead score só em drafts — não expor via API pública
Severity: HIGH
Failure mode: DATA_LEAK
Precondition: Sem auth.
Steps:

1. Tentar enumerar `/api/registration/draft` sem credencial.
   Expected result: 401 conforme middleware.
   Actual result: [ ]
   Harm if bug exists: Scraping de leads.
   Regulatory risk: LGPD

---

# SECTION AI-4 — Ticket triage (LLM)

TC-AI-4-001
Title: Prompt injection — "Ignore instruções anteriores" no corpo do ticket
Severity: HIGH
Failure mode: PROMPT_INJECTION
Precondition: Conta clínica.
Steps:

1. Crie ticket com texto de jailbreak no corpo.
   Expected result: Classificação ainda cai em uma das categorias válidas ou null; sistema não vaza system prompt na UI nem em logs ao usuário.
   Actual result: [ ]
   Harm if bug exists: Manipulação de prioridade; vazamento de prompt.
   Regulatory risk: LGPD

TC-AI-4-002
Title: Janela GENERAL/NORMAL antes da IA assíncrona — aceitação documentada
Severity: LOW
Failure mode: UX
Precondition: `known-limitations.md` IA.
Steps:

1. Crie ticket; imediatamente GET detalhe.
   Expected result: Categoria default até worker completar — documentar SLA esperado ao suporte humano.
   Actual result: [ ]
   Harm if bug exists: Priorização humana errada se não souberem da janela.
   Regulatory risk: none

---

# SECTION AI-5 — Sentimento (LLM)

TC-AI-5-001
Title: Mensagem "vou cancelar e processar judicialmente" — escalação URGENT + notificação
Severity: HIGH
Failure mode: WRONG_OUTPUT
Precondition: OpenAI disponível.
Steps:

1. Cliente envia mensagem com ameaça legal simulada (não real).
   Expected result: `shouldEscalate` true; prioridade URGENT; notificação SUPER_ADMIN conforme implementação.
   Actual result: [ ]
   Harm if bug exists: Crise de churn não detectada.
   Regulatory risk: none

TC-AI-5-002
Title: Falha OpenAI em sentimento — não quebra thread de mensagens
Severity: HIGH
Failure mode: SILENT_FAILURE
Precondition: Circuit breaker OPEN.
Steps:

1. Envie mensagem com breaker aberto.
   Expected result: Mensagem salva; sentiment null ou omitido; sem 500.
   Actual result: [ ]
   Harm if bug exists: Perda de comunicação com cliente.
   Regulatory risk: LGPD

---

# SECTION AI-6 — Contrato automático (LLM + Clicksign)

TC-AI-6-001
Title: **Risco jurídico** — corpo do contrato gerado por LLM não substitui revisão humana
Severity: CRITICAL
Failure mode: HALLUCINATION
Precondition: Política interna.
Steps:

1. Compare PDF gerado com template estático histórico.
2. Liste qualquer cláusula numérica ou referência legal não presente no template aprovado.
   Expected result: Processo legal define se LLM pode compor texto livre; se não houver revisão humana obrigatória, **registrar gap de compliance** independente de teste passar.
   Actual result: [ ]
   Harm if bug exists: Contrato inexequível ou ilegal — litígio.
   Regulatory risk: LGPD + FISCAL

TC-AI-6-002
Title: Clicksign sandbox — valor jurídico limitado (documentado)
Severity: MEDIUM
Failure mode: REGULATORY
Precondition: `known-limitations.md`
Steps:

1. N/A produção até migração Clicksign prod.
   Expected result: Testes de assinatura marcados como sandbox-only.
   Actual result: [ ]

---

# SECTION AI-7 — OCR (Vision)

TC-AI-7-001
Title: Máximo 5 documentos por chamada — 6º ignorado ou erro controlado
Severity: MEDIUM
Failure mode: COST_EXPLOSION
Precondition: 6 arquivos na pasta storage do registro.
Steps:

1. POST OCR.
   Expected result: Apenas 5 processados; documentação consistente.
   Actual result: [ ]
   Harm if bug exists: Custo Vision inesperado.
   Regulatory risk: none

TC-AI-7-002
Title: OCR não substitui validação ANVISA — resultado só auxilia humano
Severity: HIGH
Failure mode: REGULATORY
Precondition: Doc ANVISA API N/A.
Steps:

1. Upload documento falso porém legível.
   Expected result: OCR extrai texto exibido; aprovação ainda humana; aviso de que OCR não detecta fraude.
   Actual result: [ ]
   Harm if bug exists: Dependência indevida de IA para compliance.
   Regulatory risk: ANVISA

---

# SECTION AI-8 — Recomendações (SQL apenas)

TC-AI-8-001
Title: **Verificação negativa** — nenhuma chamada OpenAI ao exibir recomendações no catálogo
Severity: MEDIUM
Failure mode: WRONG_OUTPUT
Precondition: Proxy HTTP ou log OpenAI dashboard filtrado por projeto.
Steps:

1. Navegue página de produto com recomendações.
   Expected result: Zero requests OpenAI durante page load de recomendações (apenas Supabase query).
   Actual result: [ ]
   Harm if bug exists: Custo indevido se futura refatoração injetar LLM sem querer.
   Regulatory risk: none

TC-AI-8-002
Title: Confiança mínima 0.1 e suporte 3 — paridades com código
Severity: LOW
Failure mode: WRONG_OUTPUT
Precondition: `product-recommendations.ts`.
Steps:

1. Inserir associação com support=2; rodar job.
   Expected result: Não persistida.
   Actual result: [ ]

---

# SECTION AI-9 — Cross-cutting

TC-AI-9-001
Title: Circuit breaker compartilhado `openai` — falha em Vision não deve bloquear classificação por muito tempo
Severity: HIGH
Failure mode: SILENT_FAILURE
Precondition: Código `circuit-breaker.ts`.
Steps:

1. Force falhas apenas em Vision; tente classificar ticket.
   Expected result: Estados independentes se designado; se compartilhado, documentar blast radius.
   Actual result: [ ]

TC-AI-9-002
Title: LGPD — export inclui mensagens com sentimento se campo preenchido
Severity: MEDIUM
Failure mode: DATA_LEAK
Precondition: Export titular.
Steps:

1. Gere export após mensagem classificada.
   Expected result: Sentimento aparece no JSON exportado para o próprio titular.
   Actual result: [ ]
   Harm if bug exists: Portabilidade incompleta.
   Regulatory risk: LGPD

---

# RELATÓRIOS FINAIS (preenchimento pós-execução)

## MASTER BUG LIST (pré-preenchido com achados de revisão estática de código / doc)

> **Status v6.0.3 (2026-04-12):** todos os gaps HIGH e MEDIUM foram corrigidos e cobertos por testes.

| TC                  | Descrição                                                          | Severity | Status        | Fix aplicado                                                                                     |
| ------------------- | ------------------------------------------------------------------ | -------- | ------------- | ------------------------------------------------------------------------------------------------ |
| **AI-0-007**        | `analyzeSentiment` não valida `sentiment` contra enum após parse   | HIGH     | ✅ CORRIGIDO  | Whitelist `VALID_SENTIMENTS` + guarda `typeof boolean`; retorna null se inválido                 |
| **AI-0-010**        | `generateContractText` usa `temperature: 0.3` — variância jurídica | HIGH     | ✅ CORRIGIDO  | `temperature: 0` — contrato determinístico para mesmos dados de entrada                          |
| **AI-0-NEW**        | Circuit breaker `'openai'` único — OCR derruba triagem de tickets  | MEDIUM   | ✅ CORRIGIDO  | 4 breakers independentes: `openai-classify`, `openai-sentiment`, `openai-ocr`, `openai-contract` |
| **Prompt genérico** | Seção 8.3 assume "AI explanation" nas recomendações                | LOW      | ✅ CONFIRMADO | Sem bug — código é SQL/Apriori; gap era documental externo                                       |

## HALLUCINATION RISK REGISTER

| Feature           | Pior caso                    | Consequência                      | Mitigação atual (v6.0.3)                                        | Suficiente?                     |
| ----------------- | ---------------------------- | --------------------------------- | --------------------------------------------------------------- | ------------------------------- |
| Ticket triage     | Categoria/prioridade erradas | SLA ruim                          | Enum validation + null (desde v6.0.0)                           | PARTIAL                         |
| Sentimento        | Enum ou boolean inválido     | Violação CHECK + escalação errada | ✅ Whitelist + typeof boolean (v6.0.3) + null fallback          | YES                             |
| Contrato LLM      | Cláusula inexistente         | Litígio                           | ✅ temperature=0 (v6.0.3); ainda requer revisão humana jurídica | PARTIAL — pendência de processo |
| OCR               | Dígito CNPJ errado           | Aprovação errada                  | Comparativo UI + humano                                         | PARTIAL                         |
| Recomendações SQL | N/A LLM                      | N/A                               | Apriori determinístico                                          | YES                             |

## REGULATORY RISK SUMMARY (IA)

- **LGPD:** envio de texto de suporte e imagens de cadastro à OpenAI — ver seção 7A de `docs/lgpd-registro-atividades.md`; falta de DPA assinada com OpenAI no processo interno = ação pendente de governança (suboperador listado).
- **ANVISA:** OCR e lead/churn **não** substituem verificação de AFE; falha de OCR não pode auto-aprovar farmácia.
- **CFM:** Recomendações de produto não devem conter claims terapêuticos — validar copy da UI (`ProductRecommendations`).

## OPENAI DEPENDENCY RISK

| Cenário             | Impacto                                          | Mitigação existente                           |
| ------------------- | ------------------------------------------------ | --------------------------------------------- |
| Preço OpenAI +10x   | Custos de suporte e contrato sobem               | Circuit breaker; falta budget hard cap no app |
| Deprecar `gpt-4o`   | OCR quebra                                       | Trocar model string + retestar Vision         |
| 24h indisponível    | Classificação/sentimento/contrato/OCR degradados | null + defaults; contratos podem falhar envio |
| Prioridade fallback | Reorder/churn/lead score                         | Já não dependem de OpenAI                     |

---

_Fim da Parte B — IA_
