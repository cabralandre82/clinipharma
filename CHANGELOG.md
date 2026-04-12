# Changelog

---

## [6.0.1] — 2026-04-12 — Cobertura de testes para features de IA + migration 029

### Testes adicionados

- **`tests/unit/lib/lead-score.test.ts`** — 9 casos cobrindo scoring HOT/WARM/COLD, penalidade de telefone,
  bônus de CNPJ ativo, email corporativo vs. gratuito, estado de alto potencial e limite 0–100
- **`tests/unit/lib/ai.test.ts`** — 11 casos cobrindo `classifyTicket` (válido, inválido, falha OpenAI),
  `analyzeSentiment` (negativo com churn, neutro, falha) e `extractDocumentData` (alta confiança, baixa, falha)
- **`tests/unit/lib/jobs/ai-jobs.test.ts`** — 10 casos cobrindo os 4 jobs Inngest: churn-detection,
  reorder-alerts, product-recommendations e contract-auto-send (registro, lógica de filtros, cálculos)
- **`tests/unit/api/ai-routes.test.ts`** — 14 casos cobrindo:
  - `POST /api/admin/registrations/[id]/ocr` — 401 sem auth, 404 sem docs, análise completa com match de CNPJ, fallback de falha de OCR
  - `GET /api/products/[id]/recommendations` — 401, listagem ativa, filtro de produtos inativos, lista vazia
  - Crons `churn-check`, `reorder-alerts`, `product-recommendations` — 401 e disparo correto de eventos Inngest

### Banco de dados

- **`029_ai_features.sql` aplicado** ao Supabase remoto (produção)
  - Coluna `ai_classified boolean` em `support_tickets`
  - Coluna `sentiment text` em `support_messages`
  - Tabela `product_associations` com índices e RLS

### Total de testes: 767 passando (0 falhas)

---

## [6.0.0] — 2026-04-12 — Inteligência Artificial integrada à plataforma

### Visão geral

Primeira versão da plataforma com IA aplicada em 8 pontos críticos do negócio.
Todas as features são não-bloqueantes (fallback gracioso se a API falhar), auditáveis e
respeitam a LGPD (dados anonimizados antes de envio para APIs externas quando necessário).

### Infraestrutura compartilhada

- **`lib/ai.ts`** — cliente OpenAI singleton com circuit breaker integrado, logging estruturado
  e funções: `classifyTicket()`, `analyzeSentiment()`, `extractDocumentData()`, `generateContractText()`
- **Dependência adicionada:** `openai` npm package
- **Variável de ambiente necessária:** `OPENAI_API_KEY` (adicionar no Vercel)

### Feature 1 — Alerta preditivo de recompra

- Job Inngest `reorder-alerts` (diário às 07:00 UTC)
- Calcula ciclo médio de recompra por `(clinic_id, product_id)` via SQL analítico
- Requisito: **≥ 5 pedidos** históricos com status COMPLETED/DELIVERED/SHIPPED
- Dispara notificação push para `CLINIC_ADMIN` quando pedido previsto está dentro de 5 dias
- Notificação inclui link para `order_template` da clínica se existir
- Arquivos: `lib/jobs/reorder-alerts.ts`, `app/api/cron/reorder-alerts/route.ts`

### Feature 2 — Detecção de churn

- Job Inngest `churn-detection` (diário às 07:30 UTC)
- Score por clínica baseado em 5 sinais: dias sem pedido vs. ciclo médio, tendência de frequência,
  tickets abertos, pagamentos falhos, redução de variedade de produtos
- Visibilidade **somente interna** (admin e consultor — nunca mostrado para a clínica)
- Score ≥ 60 → notifica SUPER_ADMIN + consultor responsável
- Score 30–59 → notifica apenas o consultor
- Arquivos: `lib/jobs/churn-detection.ts`, `app/api/cron/churn-check/route.ts`

### Feature 3 — Triagem inteligente de tickets de suporte

- `services/support.ts`: removidos campos categoria e prioridade do formulário
- IA (GPT-4o-mini) classifica automaticamente após criação do ticket
- Ticket criado com defaults GENERAL/NORMAL → IA atualiza de forma assíncrona e não-bloqueante
- `support_tickets.ai_classified` (nova coluna — migration 029) rastreia tickets classificados por IA
- `components/support/new-ticket-form.tsx`: formulário simplificado com banner explicativo da IA

### Feature 4 — Score de qualificação de leads incompletos

- `lib/lead-score.ts`: função `calculateLeadScore()` — 7 critérios (completude, CNPJ, estado,
  email corporativo, especialidade, endereço, telefone), retorna score 0–100 + nível HOT/WARM/COLD
- `/registrations` page: drafts ordenados por score decrescente, badge colorido por nível
- Tooltip mostra os motivos do score ao passar o mouse

### Feature 7 — Recomendação de produtos (Market Basket)

- Migration `029_ai_features.sql`: tabela `product_associations (product_a_id, product_b_id, support, confidence)`
- Job Inngest `product-recommendations-rebuild` (semanal, segunda às 04:00 UTC)
- Algoritmo Apriori simplificado em SQL: suporte mínimo 3 co-ocorrências, confiança mínima 10%
- API `GET /api/products/[id]/recommendations`
- Componente `ProductRecommendations` exibido no detalhe do produto no catálogo
- Arquivos: `lib/jobs/product-recommendations.ts`, `components/catalog/product-recommendations.tsx`

### Feature 8 — OCR de documentos no cadastro (sob demanda)

- `lib/ai.ts` → `extractDocumentData()`: GPT-4o Vision — extrai CNPJ, razão social, validade,
  tipo de documento, responsável técnico, município/UF
- `POST /api/admin/registrations/[id]/ocr`: analisa todos os documentos do Supabase Storage,
  compara dados extraídos com o formulário, retorna divergências
- Componente `OcrAnalysisButton` na tela de revisão de cadastro: botão sob demanda, painel de
  resultados com badges ✅/⚠️ por campo comparado

### Feature 9 — Análise de sentimento em tickets

- `services/support.ts` → `addMessage()`: analisa sentimento de mensagens do cliente (não admin)
- GPT-4o-mini detecta: positivo/neutro/negativo/muito negativo + risco de churn
- Se `shouldEscalate=true` → ticket promovido para URGENT automaticamente + notificação ao SUPER_ADMIN
- `support_messages.sentiment` (nova coluna — migration 029) armazena o sentimento detectado

### Geração automática de contratos

- `lib/jobs/contract-auto-send.ts`: job Inngest disparado após aprovação de cadastro
- Contrato enviado via Clicksign de forma assíncrona (não bloqueia o response de aprovação)
- GPT-4o-mini gera corpo do contrato personalizado com dados da entidade
- `lib/clicksign.ts`: `generateContractPdf()` e `createAndSendContract()` agora aceitam
  `aiGeneratedBody` (texto personalizado substitui o template estático)
- Notificação ao usuário: "Seu contrato foi enviado para assinatura"

### Migration

- `supabase/migrations/029_ai_features.sql`:
  - `support_tickets.ai_classified BOOLEAN DEFAULT FALSE`
  - `support_messages.sentiment TEXT` (positivo/neutro/negativo/muito_negativo)
  - Tabela `product_associations` com índices e RLS

### Crons adicionados ao vercel.json

| Endpoint                            | Schedule          | Feature             |
| ----------------------------------- | ----------------- | ------------------- |
| `/api/cron/reorder-alerts`          | 07:00 UTC diário  | Alertas de recompra |
| `/api/cron/churn-check`             | 07:30 UTC diário  | Detecção de churn   |
| `/api/cron/product-recommendations` | 04:00 UTC segunda | Recomendações       |

### Arquivos criados

- `lib/ai.ts` — cliente OpenAI compartilhado
- `lib/lead-score.ts` — scoring de leads
- `lib/jobs/churn-detection.ts`
- `lib/jobs/reorder-alerts.ts`
- `lib/jobs/contract-auto-send.ts`
- `lib/jobs/product-recommendations.ts`
- `app/api/cron/churn-check/route.ts`
- `app/api/cron/reorder-alerts/route.ts`
- `app/api/cron/product-recommendations/route.ts`
- `app/api/admin/registrations/[id]/ocr/route.ts`
- `app/api/products/[id]/recommendations/route.ts`
- `components/registrations/ocr-analysis-button.tsx`
- `components/catalog/product-recommendations.tsx`
- `supabase/migrations/029_ai_features.sql`

### Custo operacional estimado (OpenAI)

| Clínicas ativas | Custo/mês |
| --------------- | --------- |
| 30              | ~R$25     |
| 200             | ~R$120    |
| 1.000           | ~R$500    |

---

## [5.3.2] — 2026-04-12 — Fix crítico: erro `'use server'` em services/coupons + Cupons no sidebar

### Problema resolvido

- `services/coupons.ts` estava exportando `createCouponSchema` (objeto Zod) em um arquivo `'use server'`
- O App Router do Next.js exige que apenas **async functions** sejam exportadas de arquivos `'use server'`
- O módulo falhava em carregar silenciosamente em runtime, impedindo a renderização da página `/coupons` e ocultando o item "Cupons" no sidebar

### Alterações

- `services/coupons.ts`: removido `export` de `createCouponSchema` (permanece interno ao módulo)
- `components/layout/sidebar.tsx`: removidos `console.log` de debug; item "Cupons" fixado na posição 4 (após "Pedidos")

### Cobertura de testes adicionada

- Novo teste `TC-COUP-SRV-01` em `tests/unit/services/coupons-use-server.test.ts`
- Importa o módulo real (sem mock) e verifica que todos os exports runtime são `AsyncFunction`
- Protege contra regressão do mesmo tipo em qualquer `'use server'` em `services/`

### Arquivos alterados

- `services/coupons.ts`
- `components/layout/sidebar.tsx`
- `tests/unit/services/coupons-use-server.test.ts` _(novo)_

---

## [5.3.1] — 2026-04-12 — Melhorias e correções na feature de cupons

### Problemas resolvidos

- Formulário admin usava campos de UUID brutos (inaceitável em produção)
- Sem contador de usos por cupom
- Sem resumo financeiro de desconto no detalhe do pedido
- Sem filtros, busca ou paginação no painel admin
- Sem alerta antecipado de vencimento de cupom

### Alterações

#### Migration 028 — `used_count` e trigger atualizado

- Nova coluna `used_count integer NOT NULL DEFAULT 0` em `coupons`
- Trigger `freeze_order_item_price` atualizado: incrementa `used_count` atomicamente via `UPDATE` na mesma transação do INSERT do `order_item`

#### Formulário admin — selects com busca (SearchableSelect)

- Novo componente `components/coupons/searchable-select.tsx`: combobox com busca por nome, sem dependência externa
- Produto: busca por nome + SKU
- Clínica: busca por razão comercial
- Toggle visual PERCENT / FIXED (substituindo `<select>` antigo)
- Validação: produto e clínica são obrigatórios antes do submit
- `app/(private)/coupons/page.tsx`: server component busca `products` e `clinics` e passa como props

#### Painel admin — filtros, busca, paginação e métricas

- Cards de estatísticas: cupons ativos, aguardando ativação, total de usos
- Barra de busca por clínica, produto ou código (client-side)
- Tabs de status: Todos / Ativos / Aguardando ativação / Expirados / Cancelados (com contadores)
- Coluna `Usos` com badge no total de pedidos que usaram cada cupom
- Badge "Expira em breve" (laranja) para cupons a ≤ 7 dias do vencimento
- Paginação client-side (20 por página)

#### Detalhe do pedido — resumo financeiro

- Quando há desconto de cupom, exibe breakdown:
  - Subtotal bruto: valor sem desconto
  - Desconto aplicado (cupons): valor total descontado (verde)
  - Total pago: `orders.total_price` (já descontado)

#### Cron — alertas de vencimento

- Novo endpoint `GET /api/cron/coupon-expiry-alerts`
- Executa todo dia às 09:00 UTC
- Localiza cupons ativos + ativados que expiram em ≤ 7 dias
- Notifica todos os membros da clínica (tipo `COUPON_ASSIGNED`)
- Notifica SUPER_ADMIN com código e clínica

### Arquivos criados

- `supabase/migrations/028_coupon_used_count.sql`
- `components/coupons/searchable-select.tsx`
- `app/api/cron/coupon-expiry-alerts/route.ts`
- `tests/unit/api/coupon-expiry-alerts.test.ts` — 5 novos testes (TC-EXPIRY-01 a 05)

### Arquivos alterados

- `supabase/migrations/027_coupons.sql` → trigger substituído pela versão 028
- `services/coupons.ts` — `CouponRow` inclui `used_count`
- `components/coupons/admin-coupon-panel.tsx` — reescrito completamente
- `app/(private)/coupons/page.tsx` — passa `products` e `clinics` ao painel; alerta "expira em breve" na view de clínica
- `components/orders/order-detail.tsx` — bloco de resumo com subtotal / desconto / total
- `vercel.json` — cron `coupon-expiry-alerts` às 09:00 UTC

### Testes

- 5 novos testes unitários (TC-EXPIRY-01 a 05)
- Suite completa: **720/720 passando**

---

## [5.3.0] — 2026-04-12 — Cupons de desconto por produto e por clínica

### Problema resolvido

A plataforma não tinha mecanismo para conceder descontos negociados individualmente com cada clínica.
O desconto precisava ser por produto (não pelo total do pedido), vinculado a uma clínica específica, com o custo absorvido integralmente pela plataforma (margem de comissão), sem impacto sobre o repasse à farmácia.

### Solução implementada — 3 camadas

#### 1. Banco de dados (Migration 027)

- Nova tabela `coupons`: `code` único, `product_id`, `clinic_id`, `discount_type` (`PERCENT`|`FIXED`), `discount_value`, `max_discount_amount` (teto em R$ para % grandes), `valid_from`/`valid_until`, `activated_at` (null = aguardando ativação pela clínica), `active`
- Índice parcial único `(clinic_id, product_id) WHERE active = true`: impede dois cupons ativos para o mesmo par
- Três novas colunas em `order_items` (nullable, retrocompatíveis): `coupon_id`, `discount_amount`, `original_total_price`
- Trigger `freeze_order_item_price` atualizado: se `coupon_id` fornecido, valida cupom (ativo + ativado + válido), calcula `discount_amount` e aplica em `total_price`; `pharmacy_cost_per_unit` intacto (plataforma absorve)
- RLS: admins gerenciam tudo; membros de clínica leem apenas seus próprios cupons

#### 2. Fluxo de negócio

1. Super admin cria cupom → sistema gera código único (formato `XXXXXX-XXXXXX`)
2. Clínica recebe notificação in-app com o código
3. Clínica acessa `/coupons`, digita o código **uma única vez** → `activated_at` é gravado
4. Em pedidos futuros, `createOrder` detecta automaticamente cupons ativos para cada produto e os aplica sem nenhuma ação do usuário
5. Super admin pode cancelar o cupom a qualquer momento → pedidos futuros não recebem mais desconto

#### 3. Lógica financeira

- `unit_price` (preço original) permanece registrado em `order_items`
- `original_total_price = unit_price × quantity` (auditoria)
- `discount_amount` = desconto total do item (por unidade × quantidade)
- `total_price = original_total_price - discount_amount` → o que a clínica paga
- `pharmacy_cost_per_unit` inalterado → farmácia recebe valor integral
- A comissão líquida da plataforma nesse item = `platform_commission_per_unit × quantity - discount_amount`

### Arquivos criados

- `supabase/migrations/027_coupons.sql`
- `services/coupons.ts` — CRUD admin, ativação pela clínica, helper `getActiveCouponsForOrder`
- `app/api/coupons/activate/route.ts`
- `app/api/coupons/mine/route.ts`
- `app/api/admin/coupons/route.ts`
- `app/api/admin/coupons/[id]/route.ts`
- `app/(private)/coupons/page.tsx` — view diferenciada por role (admin vs clínica)
- `components/coupons/coupon-activate-form.tsx`
- `components/coupons/admin-coupon-panel.tsx`
- `tests/unit/api/coupons.test.ts` — 14 novos casos de teste

### Arquivos alterados

- `services/orders.ts` — `createOrder` chama `getActiveCouponsForOrder` e passa `coupon_id` ao inserir order_items
- `lib/notification-types.ts` — novo tipo `COUPON_ASSIGNED`
- `components/layout/sidebar.tsx` — novo item de menu "Cupons" (admin + CLINIC_ADMIN)
- `app/(private)/orders/[id]/page.tsx` — inclui `coupon_id`, `discount_amount`, `original_total_price` no select
- `components/orders/order-detail.tsx` — badge verde de desconto por unidade na linha do item
- `tests/unit/services/orders.test.ts` — mock de `services/coupons` adicionado

---

## [5.2.1] — 2026-04-12 — Migration aplicada + cobertura de testes + fix suite

### Migration 026 aplicada

`supabase db push` aplicado em produção — tabela `registration_drafts` criada e validada.

### Cobertura de testes adicionada

| Arquivo                                      | Testes | O que valida                                                                                 |
| -------------------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| `tests/unit/api/registration-draft.test.ts`  | 7      | draft_id retornado; 400 sem email/type; 429 rate-limit; 500 DB fail                          |
| `tests/unit/api/registration-submit.test.ts` | 9      | PENDING com docs; PENDING_DOCS sem docs; draft deletado com draft_id; DOCTOR type; rollbacks |
| `tests/unit/api/purge-drafts.test.ts`        | 5      | 401 sem secret; 200 com contagem; 200 sem drafts expirados; 500 DB fail                      |
| `tests/e2e/auth.test.ts`                     | +2     | TC-AUTH-11: warning banner sem docs; TC-AUTH-12: label do botão muda                         |

### Fix da suite de testes (vitest + jsdom — Node.js 18)

Vitest havia sido atualizado para 4.x (requer Node 20). Revertido para 2.1.9 + jsdom fixado
em 24.1.3 (compatível com Node 18). `vitest.config.ts` com `css.postcss: { plugins: [] }`
para evitar erro de PostCSS em ambiente de testes. `// @vitest-environment node` adicionado
aos testes de API (sem DOM) — correção aplicada também ao `lgpd.test.ts` pré-existente.

**Resultado: 701 testes passando** (eram 685 antes da atualização quebrada do vitest).

### Arquivos

| Arquivo                                      | Mudança                                   |
| -------------------------------------------- | ----------------------------------------- |
| `tests/unit/api/registration-draft.test.ts`  | Novo                                      |
| `tests/unit/api/registration-submit.test.ts` | Reescrito + 5 novos cenários              |
| `tests/unit/api/purge-drafts.test.ts`        | Novo                                      |
| `tests/unit/api/lgpd.test.ts`                | `@vitest-environment node` adicionado     |
| `tests/e2e/auth.test.ts`                     | TC-AUTH-11 e TC-AUTH-12 adicionados       |
| `vitest.config.ts`                           | css.postcss inline + vitest 2.1.9         |
| `package.json`                               | vitest 2.1.9 + jsdom 24.1.3 + vite 5.4.19 |

---

## [5.2.0] — 2026-04-12 — Captura de leads de cadastro + envio sem documentos

### Problema

Usuários que preenchiam o formulário de cadastro mas não enviavam documentos eram bloqueados
pelo frontend e **nenhum registro era criado** — o admin ficava sem visibilidade de quem
demonstrou interesse na plataforma.

### Solução (Opção C — híbrida)

Três camadas de captura, do mais precoce ao mais completo:

| Momento                             | O que acontece                                | Status no admin          |
| ----------------------------------- | --------------------------------------------- | ------------------------ |
| Usuário avança para a etapa de docs | Rascunho salvo anonimamente (sem criar conta) | **Interesse incompleto** |
| Usuário envia sem docs              | Conta criada, solicitação registrada          | **Documentos pendentes** |
| Usuário envia com docs              | Fluxo normal                                  | **Aguardando análise**   |

### Detalhes técnicos

**Migration `026_registration_drafts`**

- Nova tabela `registration_drafts` — armazena `type` + `form_data` (nome, email, telefone,
  CNPJ/CRM) sem criar conta no auth. Expira em 7 dias. Sem RLS pública (só service_role).

**API `POST /api/registration/draft`**

- Chamada silenciosa quando o usuário clica em "Continuar para documentos".
- Retorna `draft_id` guardado no state do form.
- Em caso de falha, o usuário **não é bloqueado** (fail-open).

**API `POST /api/registration/submit` (atualizada)**

- Sem docs → `status = PENDING_DOCS`. Com docs → `status = PENDING`.
- E-mail ao admin diferenciado: banner amarelo de alerta para cadastros sem documentos.
- E-mail ao solicitante adaptado: orienta o envio posterior de docs.
- `draft_id` passado pelo form → draft deletado após submit bem-sucedido.

**Formulário `/registro` (atualizado)**

- Não bloqueia mais o submit por falta de docs.
- Exibe banner de aviso âmbar explicando as consequências.
- Botão muda de label: "Enviar solicitação" ↔ "Enviar sem documentos por enquanto".

**Painel `/registrations` (atualizado)**

- Nova seção **Interesses incompletos** (drafts) com nome, email, tipo e botão "Contatar" via mailto.
- Tabs: Todos | Interesses incompletos | Aguardando análise | Documentos pendentes | Aprovado | Reprovado.
- Badges de contagem em tempo real em cada tab.

**Cron `GET /api/cron/purge-drafts`**

- Roda diariamente às 03:30 UTC.
- Deleta drafts onde `expires_at < now()`.
- Registrado em `vercel.json`.

### Arquivos

| Arquivo                                           | Mudança                                                     |
| ------------------------------------------------- | ----------------------------------------------------------- |
| `supabase/migrations/026_registration_drafts.sql` | Novo: tabela + trigger + RLS                                |
| `app/api/registration/draft/route.ts`             | Novo: endpoint salva rascunho                               |
| `app/api/registration/submit/route.ts`            | Atualizado: PENDING_DOCS, draft cleanup, emails adaptativos |
| `app/(auth)/registro/registration-form.tsx`       | Atualizado: save draft, allow no-doc submit, warning banner |
| `app/(private)/registrations/page.tsx`            | Atualizado: seção de drafts, tabs com badges                |
| `app/api/cron/purge-drafts/route.ts`              | Novo: cron de limpeza                                       |
| `lib/registration-constants.ts`                   | Novo status INCOMPLETE (label + cor)                        |
| `middleware.ts`                                   | `/api/registration/draft` adicionado às rotas públicas      |
| `vercel.json`                                     | Cron `purge-drafts` registrado (diário 03:30 UTC)           |

---

## [5.1.4] — 2026-04-12 — Fix: `/terms` inacessível sem autenticação + cobertura E2E

### Causa raiz

A rota `/terms` não estava incluída na lista `PUBLIC_ROUTES` do `middleware.ts`. Qualquer
usuário não autenticado que clicasse em "Termos de Uso" na tela de login era redirecionado
para `/login`, enquanto `/privacy` funcionava normalmente por já estar na lista.

### Correção

Adicionado `/terms` à lista `PUBLIC_ROUTES` no middleware, tornando a página de Termos de
Uso acessível publicamente — comportamento simétrico ao da Política de Privacidade.

### Cobertura de testes adicionada

| Teste                                                                | Arquivo                     | O que valida                                                          |
| -------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------- |
| `Smoke: public routes — /terms loads without error`                  | `tests/e2e/smoke.test.ts`   | `/terms` carrega sem crash em cada deploy                             |
| `Smoke: public routes — /privacy loads without error`                | `tests/e2e/smoke.test.ts`   | `/privacy` carrega sem crash em cada deploy                           |
| `Authentication — legal pages are accessible without authentication` | `tests/e2e/01-auth.test.ts` | `/terms` e `/privacy` não redirecionam para `/login` sem sessão ativa |

Estes testes garantem que o bug não retorne: qualquer remoção acidental de `/terms` ou
`/privacy` das `PUBLIC_ROUTES` fará a CI falhar antes de chegar à produção.

### Arquivos

| Arquivo                     | Mudança                                                    |
| --------------------------- | ---------------------------------------------------------- |
| `middleware.ts`             | `/terms` adicionado a `PUBLIC_ROUTES`                      |
| `tests/e2e/smoke.test.ts`   | `/terms` e `/privacy` incluídos no array de rotas públicas |
| `tests/e2e/01-auth.test.ts` | Novo teste: páginas legais acessíveis sem autenticação     |

---

## [5.1.3] — 2026-04-12 — Correção do crash Base UI error #31 no header

### Causa raiz definitiva

O `DropdownMenuLabel` em `components/ui/dropdown-menu.tsx` usava `MenuPrimitive.GroupLabel`
do `@base-ui/react`, que **exige** estar dentro de um `MenuPrimitive.Group`. No header, ele
era usado diretamente dentro de `MenuPrimitive.Popup` sem esse wrapper. Como o conteúdo do
menu só é renderizado quando aberto (lazy), o crash acontecia exatamente no `onMouseDown`
ao clicar no nome do usuário — lançando Base UI error #31 e exibindo o `global-error.tsx`.

Evidência: console do browser mostrava
`Error: Base UI error #31; visit https://base-ui.com/production-error?code=31`

### Correção

`DropdownMenuLabel` convertido de `MenuPrimitive.GroupLabel` para `<div>` HTML simples.
Visualmente idêntico, sem dependência de contexto do Base UI.

**Cobertura de testes:** componente UI puro (sem lógica de negócio). 685/685 passando,
nenhum teste novo necessário.

### Arquivos

| Arquivo                           | Mudança                                            |
| --------------------------------- | -------------------------------------------------- |
| `components/ui/dropdown-menu.tsx` | `DropdownMenuLabel`: GroupLabel → div HTML simples |

---

## [5.1.2] — 2026-04-12 — Correção defensiva do layout privado + página /profile completa

### Causa raiz identificada

O `PrivateLayout` não possuía `try/catch` em torno de `getCurrentUser()`. Qualquer exceção inesperada
em runtime (ex.: falha transitória de rede com o Supabase) propagava pelo layout, bypassava o
`(private)/error.tsx` e atingia o `global-error.tsx` — exibindo o modal "Erro inesperado" para
qualquer página do app. A versão simplificada de `/profile` criada em v5.1.1 também sofria do
mesmo problema.

### Correções

**`app/(private)/layout.tsx`**

- Adicionado `try/catch` defensivo em `getCurrentUser()`: exceções inesperadas em runtime redirecionam
  para `/login` em vez de crashar o layout global
- Erros internos do Next.js (`NEXT_REDIRECT`, `Dynamic server usage`, `NEXT_NOT_FOUND`) são
  re-lançados para o framework tratá-los corretamente

**`app/(private)/profile/page.tsx`**

- Restaurada a versão completa da página com todas as funcionalidades:
  - Preferências de notificação (silenciáveis vs. críticas)
  - Histórico de sessões e alertas de novo dispositivo
  - Upload de documentos pendentes (para cadastros em análise)
- Adicionado `try/catch` em cada chamada ao banco de dados
- Fallback defensivo para valores `undefined`/`null` em todos os campos

**Cobertura de testes:** 685/685 testes passando. `updateOwnProfile` coberto por 3 testes existentes. Nenhum novo teste necessário — as alterações são de infraestrutura e tratamento de erro.

### Arquivos

| Arquivo                          | Mudança                                     |
| -------------------------------- | ------------------------------------------- |
| `app/(private)/layout.tsx`       | try/catch defensivo em getCurrentUser       |
| `app/(private)/profile/page.tsx` | Página completa restaurada + error handling |

---

## [5.1.1] — 2026-04-11 — Página de perfil do usuário (versão inicial)

### Correção

Ao clicar no nome no canto superior direito → "Meu perfil", a plataforma redirecionava para `/profile`
causando uma página em branco com modal de erro inesperado.

**Criado `app/(private)/profile/page.tsx`** com card de resumo e formulário editável.

**Cobertura de testes:** `updateOwnProfile` já coberto por 3 testes em `tests/unit/services/users.test.ts`.

### Arquivos

| Arquivo                               | Mudança                   |
| ------------------------------------- | ------------------------- |
| `app/(private)/profile/page.tsx`      | Novo: página de perfil    |
| `components/profile/profile-form.tsx` | Novo: formulário editável |

---

## [5.1.0] — 2026-04-08 — Política de Privacidade e Termos de Uso

### Conformidade legal (Pendência #6)

Implementação das páginas públicas `/privacy` e `/terms`, eliminando o último bloqueio de
conformidade legal passível de resolução via código.

**Política de Privacidade** (`/privacy`) — 12 seções:

- Identificação do Controlador e canal DPO (`privacidade@clinipharma.com.br`)
- Mapeamento de dados coletados: identificação, uso, financeiros, documentos e dados de saúde
- Tabela de finalidades × bases legais (Art. 7 LGPD) para cada tipo de tratamento
- Todos os operadores/subprocessadores listados com suas responsabilidades (Asaas, Clicksign, Supabase, Vercel, Resend, Twilio, Inngest, ReceitaWS)
- Transferência internacional: SCCs e DPAs exigidos
- Tabela de retenção por categoria com prazo e base legal (RDC ANVISA 67/2007, Código Civil, Marco Civil, Lei 9.613/98)
- Segurança documentada: TLS 1.3, AES-256-GCM, RBAC, RLS, logs imutáveis, rate limiting
- Notificação de incidente em 72h (Art. 48 LGPD)
- 10 direitos do titular com canal explícito e prazo de 15 dias
- Cookies: apenas estritamente necessários (HttpOnly, Secure, SameSite=Lax)

**Termos de Uso** (`/terms`) — 15 cláusulas:

- Elegibilidade setorial: AFE/AE ANVISA, CRM ativo, CNES, CRF exigidos por papel de usuário
- Cláusula essencial de intermediação tecnológica (afasta responsabilidade por qualidade dos produtos)
- Obrigações específicas por ator: farmácia, médico/clínica
- Usos proibidos com referência às normas ANVISA, Portaria 344/98, Lei 5.991/73
- Pagamentos via Asaas PCI DSS, comissões, inadimplência com multa 2% + 1% a.m.
- Propriedade intelectual, limitação de responsabilidade, indenização
- Rescisão automática por cassação de licenças regulatórias
- Conformidade com RDC 67/2007, RDC 204/2017, CFM, CFF, LGPD
- Foro eleito: Comarca de São Paulo/SP

**Infraestrutura compartilhada:**

- Componente `LegalLayout` com helpers `Section`, `Sub`, `P`, `UL`, `Highlight`, `Warning`
- Link "Termos de Uso · Política de Privacidade" no rodapé da tela de login

### Arquivos criados/alterados

| Arquivo                             | Mudança                                           |
| ----------------------------------- | ------------------------------------------------- |
| `app/privacy/page.tsx`              | Novo: Política de Privacidade completa            |
| `app/terms/page.tsx`                | Novo: Termos de Uso completos                     |
| `components/legal/legal-layout.tsx` | Novo: layout e helpers compartilhados             |
| `app/(auth)/layout.tsx`             | Link para Termos e Privacidade no rodapé do login |
| `docs/PENDING.md`                   | Pendência #6 marcada como concluída               |

### Normas referenciadas

Lei 13.709/2018 (LGPD), Lei 12.965/2014 (Marco Civil), Lei 9.610/1998 (Direitos Autorais),
Lei 9.279/1996 (Propriedade Industrial), Lei 5.991/1973, Lei 9.613/1998, Código Civil (Lei
10.406/2002), RDC ANVISA 67/2007, RDC ANVISA 204/2017, Portaria SVS/MS 344/1998,
Resolução CFM 1.931/2009, Resolução CFF 586/2013.

---

## [5.0.0] — 2026-04-08 — Sistema de Suporte por Tickets

### Funcionalidade

Substituição do suporte por e-mail por um sistema moderno de tickets conversacionais, acessível
diretamente na plataforma.

**Principais recursos**:

- Tickets com código único (`TKT-2026-00001`) gerado automaticamente por trigger SQL
- Categorias: Pedido, Pagamento, Técnico, Reclamação, Geral
- Prioridades: Baixa, Normal, Alta, Urgente (gerenciadas por admins)
- Status flow: `ABERTO → EM ATENDIMENTO → AGUARDANDO CLIENTE ↔ EM ATENDIMENTO → RESOLVIDO → FECHADO`
- Thread de conversa estilo chat (bolhas de mensagem por remetente)
- **Notas internas** (`is_internal`) — visíveis apenas para admins, fundo âmbar
- **Auto-assign** — o primeiro admin a responder é automaticamente atribuído ao ticket
- **Notificações push** — cliente é notificado a cada resposta do admin e vice-versa; `SUPPORT_REPLY` e `SUPPORT_RESOLVED` são tipos críticos (nunca silenciados)
- Status automático — se cliente responde a ticket `WAITING_CLIENT`, volta para `IN_PROGRESS`
- Sidebar: entrada "Suporte" (ícone LifeBuoy) visível para todos os papéis

### Arquivos criados/alterados

| Arquivo                                       | Mudança                                                                          |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| `supabase/migrations/025_support_tickets.sql` | Tabelas, enums, trigger de código, RLS                                           |
| `services/support.ts`                         | Novo: `createTicket`, `addMessage`, `updateTicketStatus`, `updateTicketPriority` |
| `app/(private)/support/page.tsx`              | Novo: lista de tickets com filtros de status                                     |
| `app/(private)/support/new/page.tsx`          | Novo: formulário de abertura de ticket                                           |
| `app/(private)/support/[id]/page.tsx`         | Novo: detalhe do ticket + conversa                                               |
| `components/support/ticket-list.tsx`          | Novo: tabela com tabs de status                                                  |
| `components/support/new-ticket-form.tsx`      | Novo: formulário com seleção visual de categoria                                 |
| `components/support/ticket-conversation.tsx`  | Novo: thread chat + painel admin (status/prioridade)                             |
| `components/layout/sidebar.tsx`               | Adicionado item "Suporte" para todos os papéis                                   |
| `lib/notification-types.ts`                   | Adicionados `SUPPORT_TICKET`, `SUPPORT_REPLY`, `SUPPORT_RESOLVED`                |
| `tests/unit/services/support.test.ts`         | Novo: 13 testes unitários do serviço                                             |
| `tests/unit/notifications.test.ts`            | Atualizado: inclui novos tipos críticos de suporte                               |

### Cobertura de testes

- **685 testes passando** (13 novos para o módulo de suporte)

---

## [4.8.0] — 2026-04-11 — SKU gerado automaticamente no formato [CAT]-[FAR]-[NNNN]

### Funcionalidade

O campo SKU deixa de ser preenchido manualmente e passa a ser gerado automaticamente pelo backend
no momento da criação do produto.

**Formato**: `[CAT3]-[FAR3]-[NNNN]`

- `CAT3` — 3 primeiras letras da categoria, sem acento, maiúsculas (ex: "Hormônios" → `HOR`)
- `FAR3` — 3 primeiras letras da farmácia, sem acento, maiúsculas (ex: "FarmaMag SP" → `FAR`)
- `NNNN` — contador sequencial de produtos da farmácia, zero-padded de 4 dígitos

**Exemplos**: `HOR-FAR-0001`, `VIT-FAR-0002`, `ANA-CLI-0001`

### Comportamento

- **Criação**: campo SKU não aparece mais no formulário — é exibida uma prévia do formato com a mensagem "Gerado automaticamente — ex: HOR-FAR-0001"
- **Edição**: SKU exibido como read-only com ícone de etiqueta — imutável após criação
- **Colisão** (raro): se dois produtos geram o mesmo SKU simultaneamente, o backend retenta automaticamente com sufixo aleatório de 4 caracteres (ex: `HOR-FAR-0001-A3F2`)
- **Fallback**: se a categoria ou farmácia não forem encontradas, usa `PRD` e `FRM` como prefixo

### Arquivos alterados

| Arquivo                                | Mudança                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `lib/validators/index.ts`              | `sku` agora é `optional()` no `productSchema`                                                                            |
| `services/products.ts`                 | Adicionado `generateSKU()` (exportado); `createProduct` chama-o se `sku` não fornecido; retorna `sku` gerado na resposta |
| `components/products/product-form.tsx` | Campo SKU removido do formulário de criação; exibido read-only na edição; glossário atualizado                           |

### Cobertura de testes

| Teste                                          | O que valida                                         |
| ---------------------------------------------- | ---------------------------------------------------- |
| `generateSKU > generates correct format`       | `HOR-FAR-0001` para Hormônios + FarmaMag com count=0 |
| `generateSKU > sequential counter`             | `VIT-CLI-0015` para count=14                         |
| `generateSKU > strips accents`                 | `ANA-PHA-0001` para Analgésicos + Phármácia          |
| `generateSKU > fallback PRD/FRM`               | quando queries retornam null                         |
| `createProduct > retries on 23505`             | sucesso no retry com sufixo aleatório                |
| `createProduct > error when both inserts fail` | retorna "Erro ao criar produto"                      |

**659 testes passando** (eram 654).

---

## [4.7.0] — 2026-04-08 — UX: explicações contextuais de SKU, Slug e Variantes na edição de produto

### Funcionalidade

Adicionadas explicações visuais diretamente na página de criação/edição de produto para os três campos que causavam confusão:

#### Glossário visual (topo da seção Identificação)

Card azul com três painéis lado a lado explicando cada conceito com linguagem simples e exemplos farmacêuticos reais:

- **SKU** (`Stock Keeping Unit`) — código interno de controle de estoque, livre para definir. Ex: `SEMA-10MG · OZEM-500`
- **Slug** (URL amigável) — identificador do produto no endereço da página. Gerado automaticamente a partir do nome. Ex: `/produtos/semaglutida-10mg`
- **Variantes** — versões do mesmo produto com concentração/quantidade diferentes, cada uma com preço próprio. Ex: Ozempic 0,5mg vs 1mg vs 2mg

#### Preview de URL ao vivo no campo Slug

Enquanto o usuário edita o slug, aparece abaixo do campo o endereço real da página: `clinipharma.com.br/produtos/[slug-digitado]`.

#### Campo SKU

Adicionado placeholder (`Ex: SEMA-10MG`) e hint de rodapé explicando que o formato é livre.

#### Callout "Quando usar variantes?" (seção Variantes)

Acordeão âmbar colapsável antes do gerenciador de variantes com:

- Quando usar variantes (exemplos reais: Ozempic 0,5mg / 1mg / 2mg; frascos 10mL / 20mL)
- Quando NÃO usar (criar produtos separados): medicamentos diferentes, fabricantes distintos
- Nota sobre variante Padrão

#### Seção Variantes com título próprio

Movida para `<section>` com cabeçalho "VARIANTES" no mesmo estilo das outras seções.

### Cobertura de testes

Mudanças exclusivamente em componentes React client (`product-form.tsx`, `product-variants-manager.tsx`) — sem lógica de negócio. Cobertura por E2E/visual. Testes unitários: 654 passando (inalterado).

---

## [4.6.0] — 2026-04-08 — Correção dos silent failures MEDIUM + cobertura de testes

### Contexto

Completada a correção dos itens MEDIUM identificados na varredura de silent failures de `v4.5.0`.
Corrigido também timeout de teste em `pharmacies.test.ts` (mock de `validateCNPJ` ausente).

### Arquivos corrigidos

| Arquivo                                  | Risco     | Correção                                                                                                                                      |
| ---------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/orders.ts`                     | 🟡 MEDIUM | `createOrder`: `order_status_history.insert` e `order_tracking_tokens.upsert` agora capturam e logam erros (não bloqueantes)                  |
| `services/orders.ts`                     | 🟡 MEDIUM | `updateOrderStatus`: `order_status_history.insert` agora captura e loga erro (não bloqueante)                                                 |
| `app/api/orders/reorder/route.ts`        | 🟡 MEDIUM | `order_items.insert`: agora retorna 500 e faz rollback do pedido se falhar; `order_status_history` e `tracking_token` logam erros (não bloq.) |
| `app/api/registration/submit/route.ts`   | 🟡 MEDIUM | `profiles.upsert` e `user_roles.insert`: agora retornam 500 e fazem rollback do auth user se falharem; `registration_documents.insert` loga   |
| `tests/unit/services/pharmacies.test.ts` | fix       | Adicionado mock de `@/lib/compliance` — `validateCNPJ` causava timeout de 5s por chamada HTTP real em ambiente de teste                       |

### Cobertura de testes adicionada

| Teste novo                                                                            | Arquivo                                      | O que valida                                                       |
| ------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| `updateOrderStatus > succeeds even when status history insert fails`                  | `tests/unit/services/orders.test.ts`         | History insert failure é não bloqueante (não propaga erro)         |
| `POST /api/registration/submit > returns 500 when profile upsert fails`               | `tests/unit/api/registration-submit.test.ts` | `profiles.upsert` falha → 500 + rollback do auth user              |
| `POST /api/registration/submit > returns 500 when user_roles insert fails`            | `tests/unit/api/registration-submit.test.ts` | `user_roles.insert` falha → 500 + rollback do auth user            |
| `POST /api/registration/submit > returns 500 when registration_requests insert fails` | `tests/unit/api/registration-submit.test.ts` | `registration_requests.insert` falha → 500 + rollback do auth user |
| `POST /api/registration/submit > returns 201 on successful registration`              | `tests/unit/api/registration-submit.test.ts` | Happy path completo de registro                                    |

### Total de testes

**654 testes passando** em 46 arquivos (era 648 em 45 arquivos).

### Status da varredura de silent failures

✅ **Todos os itens identificados foram corrigidos** (CRITICAL + HIGH em v4.5.0, MEDIUM em v4.6.0).
Nenhum item pendente da varredura original.

---

## [4.4.0] — 2026-04-08 — Lista de usuários: indicar ativos/inativos com filtros

### Funcionalidade

- **Migration 024**: coluna `is_active boolean NOT NULL DEFAULT true` adicionada à tabela `profiles`. Mantida em sincronia pelos server actions `deactivateUser` (→ `false`) e `reactivateUser` (→ `true`). Evita chamar a Auth Admin API para cada linha da lista.
- **`UsersTable`**: reformulado com:
  - Abas de filtro **Todos / Ativos / Desativados** com contadores coloridos.
  - Badge `Desativado` vermelho inline ao lado do nome do usuário inativo.
  - Linha com `opacity-60` para usuários desativados, distinguindo visualmente sem esconder.
  - Ordenação padrão: ativos primeiro, depois alfabético.
- **`users/page.tsx`**: inclui `is_active` no `SELECT` e ordena por `is_active DESC, full_name ASC`.
- **`services/users.ts`**: `deactivateUser` e `reactivateUser` agora espelham `is_active` em `profiles` após alterar o ban no Auth.

### Testes

| Camada                                    | Coberta?    | Arquivo                                             |
| ----------------------------------------- | ----------- | --------------------------------------------------- |
| `deactivateUser` → `is_active: false`     | ✅ unitário | `users.test.ts`                                     |
| `reactivateUser` → `is_active: true`      | ✅ unitário | `users.test.ts`                                     |
| `UsersTable` (coluna Status, filtro tabs) | ➖ E2E      | Componente React client puro, sem lógica de negócio |
| `users/page.tsx` query `is_active`        | ➖ E2E      | Server Component                                    |

19 testes passando em `users.test.ts`.

---

## [4.5.0] — 2026-04-08 — Varredura de silent failures: 50+ writes sem error check corrigidos

### Contexto

Varredura automatizada identificou 61 ocorrências de operações de escrita no Supabase
(`.update()`, `.insert()`, `.delete()`, `.upsert()`) cujo `{ error }` de retorno não era
capturado — falhas de DB eram silenciosamente ignoradas. Padrão encontrado a partir do bug
`is_active` que não era atualizado após `deactivateUser`.

### Arquivos corrigidos

| Arquivo                                          | Risco       | Correção                                                                                                                        |
| ------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `lib/token-revocation.ts`                        | 🔴 CRITICAL | `revokeToken` e `revokeAllUserTokens`: erro no upsert de blacklist agora logado                                                 |
| `services/payments.ts`                           | 🔴 HIGH     | `confirmPayment`: retorna erro se `payments.update(CONFIRMED)` falhar; loga falhas em commissions, transfers, order status      |
| `services/payments.ts`                           | 🔴 HIGH     | `completeTransfer`: retorna erro se `transfers.update` falhar; loga falhas em orders e history                                  |
| `services/consultants.ts`                        | 🔴 HIGH     | Rollback de comissões e mark-paid agora logam falha explicitamente                                                              |
| `services/users.ts`                              | 🔴 HIGH     | `createUser`: todos os linking ops (clinic_members, doctor_clinic_links, pharmacy_members, sales_consultants) agora logam falha |
| `services/settings.ts`                           | 🔴 HIGH     | `updateSetting`: retorna erro se upsert falhar                                                                                  |
| `lib/retention-policy.ts`                        | 🔴 HIGH     | LGPD: anonimização por perfil agora verifica erro e não incrementa contador se falhar; purge de notifications e audit_logs idem |
| `app/api/admin/lgpd/anonymize/[userId]/route.ts` | 🔴 HIGH     | Retorna 500 se `profiles.update` falhar; loga falhas em doctors e notifications                                                 |
| `app/api/registration/[id]/route.ts`             | 🔴 HIGH     | approve: retorna 500 se clinic/doctor insert falhar; loga falhas em memberships, status updates e profiles                      |

### Cobertura de testes

- **Novo teste**: `deactivateUser > logs error when profiles.update fails after auth ban but still succeeds`
- **Total**: 648 testes passando (era 644)
- Os outros silent failures são logados (não bloqueantes) — cobertos indiretamente pelos testes existentes dos happy paths

### Items MEDIUM corrigidos em v4.6.0

Todos os itens MEDIUM identificados na varredura foram corrigidos — ver `v4.6.0`.

---

## [4.4.1] — 2026-04-08 — Coluna Status explícita na lista de usuários

### Melhoria

- **`UsersTable`**: adicionada coluna **Status** com badge `🟢 Ativo` / `🔴 Desativado` em cada linha, tornando o estado de cada usuário visível sem necessidade de entrar no perfil. `colSpan` do empty state corrigido de 5 → 6.

### Cobertura

Mesma análise de `v4.4.0` — lógica de serviço (`is_active`) coberta por testes unitários; componente de UI coberto por E2E.

---

## [4.3.0] — 2026-04-08 — UI Sweep: ações de status em Farmácias, Médicos e Produtos + testes

### Funcionalidades adicionadas

- **Farmácias — Alterar status**: botão dropdown "Alterar status" na página de detalhe da farmácia, idêntico ao de clínicas. Usa `updatePharmacyStatus` (já existia no serviço, sem exposição na UI). Novo componente: `components/pharmacies/pharmacy-status-actions.tsx`.
- **Médicos — Alterar status**: botão dropdown "Alterar status" na página de detalhe do médico. Usa `updateDoctorStatus` (já existia no serviço, sem exposição na UI). Novo componente: `components/doctors/doctor-status-actions.tsx`.
- **Produtos — Ativar/Desativar**: botão "Ativar / Desativar" na página de detalhe do produto. Usa `toggleProductActive` (já existia no serviço, sem exposição na UI). Novo componente: `components/products/toggle-product-active.tsx`.
- **Usuários — Reativar**: nova server action `reactivateUser` em `services/users.ts` (desbanir via `ban_duration: 'none'`). O `DeactivateUserDialog` alterna entre desativar e reativar conforme o status atual.
- **Usuários — Proteção auto-desativação**: `deactivateUser` agora retorna erro ao tentar desativar a própria conta.

### Cobertura de Testes

**Serviços — todos cobertos por testes unitários existentes ou novos:**

| Serviço                | Arquivo de teste     | Casos                                            |
| ---------------------- | -------------------- | ------------------------------------------------ |
| `updatePharmacyStatus` | `pharmacies.test.ts` | 2 (ACTIVE, INACTIVE) — já existiam               |
| `updateDoctorStatus`   | `doctors.test.ts`    | 1 (success) — já existia                         |
| `toggleProductActive`  | `products.test.ts`   | 2 (true, false) — já existiam                    |
| `deactivateUser`       | `users.test.ts`      | 3 (success, error, self-guard) — self-guard novo |
| `reactivateUser`       | `users.test.ts`      | 2 (success, error) — novos                       |

**Componentes de UI** (`PharmacyStatusActions`, `DoctorStatusActions`, `ToggleProductActive`, `DeactivateUserDialog`): wrappers thin client-side sem lógica de negócio — cobertos por testes E2E (não unitários), padrão adotado no projeto.

**Total de testes unitários em `users.test.ts`: 19** (era 14 antes desta versão).

### Varredura de funcionalidades ausentes

| Página             | Serviço existia           | UI existia | Ação                                    |
| ------------------ | ------------------------- | ---------- | --------------------------------------- |
| `/pharmacies/[id]` | `updatePharmacyStatus` ✅ | ❌         | Adicionado `PharmacyStatusActions`      |
| `/doctors/[id]`    | `updateDoctorStatus` ✅   | ❌         | Adicionado `DoctorStatusActions`        |
| `/products/[id]`   | `toggleProductActive` ✅  | ❌         | Adicionado `ToggleProductActive`        |
| `/users/[id]`      | `reactivateUser` ❌       | ❌         | Criado serviço + `DeactivateUserDialog` |

---

## [4.2.0] — 2026-04-08 — Hotfix: Dashboard crash (unstable_cache + coluna inexistente)

### Bugs corrigidos (CRÍTICO)

- **CRÍTICO**: Dashboard retornava "Algo deu errado" (código `@E157`) para todos os usuários.
  Dois bugs simultâneos em `lib/dashboard.ts`:
  1. **Coluna inexistente**: query selecionava `order_code` — coluna não existe; correta é `code`. Supabase retornava erro 400.
  2. **`createClient()` dentro de `unstable_cache`**: `createClient()` usa `cookies()` do Next.js internamente (API de escopo de requisição). O `unstable_cache` executa a função fora do contexto de request após o TTL de 5 minutos, onde `cookies()` não está disponível — causando crash na revalidação do cache.
     **Correção**: substituído `createClient()` por `createAdminClient()` (service role, sem cookies). Auth continua garantida no `dashboard/page.tsx`.

### Arquivos alterados

- `lib/dashboard.ts`

---

## [4.1.0] — 2026-04-08 — Audit & QA Round Final (bugs, cobertura, docs)

### Bugs corrigidos

- **LOW**: `console.log/error` em `app/api/auth/forgot-password/route.ts` substituídos por `logger.info/warn/error`
- **LOW**: `console.error` em `app/api/registration/[id]/route.ts` substituído por `logger.error`
- **LOW**: `console.error` em `app/api/documents/upload/route.ts` substituído por `logger.error`
- **LOW**: `console.error` em `app/api/admin/lgpd/anonymize/[userId]/route.ts` substituído por `logger.error`
- **MEDIUM (info disclosure)**: `/api/health` não expõe mais os estados internos dos circuit breakers — retorna `circuitStatus: 'ok' | 'N open'` em vez do objeto completo

### Cobertura de Testes (+ 18 novos testes)

- `tests/unit/lib/rate-limit.test.ts` — 8 novos testes: in-memory backend, isolamento, reset de janela, cache de limiter
- `tests/unit/services/payments.test.ts` — 2 novos testes: race condition (claim vazio), completeTransfer success path
- `tests/unit/services/products.test.ts` — 5 novos testes: updateProduct success/error, createProduct validation, priceUpdate validation
- `tests/unit/services/consultants.test.ts` — 4 novos testes: registerConsultantTransfer rollback e success path, FORBIDDEN

| Métrica    | Antes  | Depois     |
| ---------- | ------ | ---------- |
| Test Files | 44     | 45         |
| Tests      | 626    | 644        |
| Statements | 80.58% | **84.37%** |
| Branches   | 67.52% | **70.63%** |
| Functions  | 85.98% | **87.26%** |
| Lines      | 81.81% | **85.51%** |

### Documentação atualizada

- `README.md` — versão 4.0.0, scripts de E2E, tabela de docs atualizada, coverage atual
- `docs/go-live-checklist.md` — E2E Playwright, CI workflow, structured logging, SLOs, PWA, DR plan
- `CHANGELOG.md` — histórico completo

---

## [4.0.0] — 2026-04-08 — Roadmap 90pts: Conclusão (E2E + CI + Cobertura)

### Playwright E2E (A16)

- Configurado `playwright.config.ts` com projetos Desktop Chrome, Mobile Chrome e setup de autenticação
- `tests/e2e/auth.setup.ts` — login único com sessão persistida (sem repetição de auth entre testes)
- `tests/e2e/01-auth.test.ts` — fluxos de autenticação: login inválido, redirecionamento, link de reset
- `tests/e2e/02-admin-clinic-approval.test.ts` — painel admin: aprovação de cadastros, navegação de rotas
- `tests/e2e/03-order-lifecycle.test.ts` — ciclo de vida de pedido + farmácia atualizando status
- `tests/e2e/04-profile-privacy.test.ts` — portal de privacidade LGPD (export, solicitação de exclusão)
- `tests/e2e/smoke.test.ts` — smoke tests rápidos para Deploy checks (Desktop + Mobile)
- Page Object Models: `LoginPage`, `OrdersListPage`, `NewOrderPage`, `RegistrationRequestsPage`
- `.github/workflows/ci.yml` — GitHub Actions: unit tests + lint + TypeScript check + E2E smoke
- Scripts npm: `test:e2e`, `test:e2e:smoke`, `test:e2e:ui`, `test:e2e:report`
- `.gitignore` atualizado: `tests/e2e/.auth/` e `blob-report/` excluídos do controle de versão

### Pentest Externo (A17) — documentado

- `docs/roadmap-90pts.md` atualizado com escopo completo de pentest, empresas recomendadas e custo estimado

### Cobertura de Testes

- `tests/unit/services/orders.test.ts` — 8 novos testes: compliance block, success path admin, pharmacy membership denial, notify triggers, rollback on items error
- `orders.ts` coverage: **37% → 71.5% (statements)**, **46% → 76.9% (functions)**
- Coverage geral: Statements **76.72% → 80.58%**, Lines **77.69% → 81.81%**, Functions **83.56% → 85.98%**
- Total: **636 testes passando** (eram 618)

---

## [3.0.0] — 2026-04-08 — Roadmap 90pts: Semana 1–2 (Segurança + API + Compliance)

### Security — Session Revocation (Camadas 3 e 6)

- **`revoked_tokens` table (migration 021):** Blacklist de JWTs com índices em `jti` e `expires_at`. RLS habilitada, acesso exclusivo via service_role.
- **`lib/token-revocation.ts`:** `revokeToken()`, `revokeAllUserTokens()` (invalida refresh tokens via Supabase Admin API + insere sentinel `user:{id}:all`), `isTokenRevoked()`, `purgeExpiredTokens()`.
- **`middleware.ts`:** Agora verifica blacklist a cada request autenticado. Token revogado → redireciona para login limpando cookies. Adicionado `X-Request-ID` em todos os responses.
- **`services/users.ts`:** `deactivateUser()` e `assignUserRole()` chamam `revokeAllUserTokens()` imediatamente após a mudança.
- **`/api/cron/purge-revoked-tokens`:** Cron diário às 03h UTC para limpar tokens expirados da blacklist.

### Security — HTTP Security Headers (Camada 3)

- **`next.config.ts`:** Adicionados em todas as rotas: `Content-Security-Policy`, `Strict-Transport-Security` (HSTS com preload), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`.

### Reliability — Circuit Breaker (Camada 2)

- **`lib/circuit-breaker.ts`:** Padrão CLOSED→OPEN→HALF_OPEN com threshold de 3 falhas em 60s, recovery de 30s. Alerta Sentry quando abre.
- **`lib/asaas.ts`:** Envolvido com `withCircuitBreaker('asaas', ...)`.
- **`lib/clicksign.ts`:** Envolvido com `withCircuitBreaker('clicksign', ...)`.
- **`/api/health`:** Expõe estado de todos os circuits em `circuits` + alerta em `checks.circuits` quando algum está OPEN. Versão atualizada para `2.4.0`.

### API — Resposta Padronizada (Camada 2)

- **`lib/api-response.ts`:** Helpers `apiSuccess(data)` e `apiError(code, message, status)` com shape consistente: `{ data, meta: { requestId, timestamp, version } }` / `{ error: { code, message }, meta }`. Factory `ApiErrors` com erros comuns pré-definidos.

### Compliance — CNPJ Validation (Camada 4)

- **`lib/compliance.ts`:** Engine completo com `validateCNPJ()` (ReceitaWS API, fail-open em timeout/rate-limit), `canPlaceOrder()` (valida clínica + farmácia + CNPJ + produto), `canAcceptOrder()` (verifica farmácia ativa antes de avançar status).
- **Migration 022:** Colunas `cnpj_validated_at` e `cnpj_situation` em `pharmacies` com índice partial para o cron.
- **`/api/cron/revalidate-pharmacies`:** Cron semanal (segundas-feiras 06h UTC). Re-valida CNPJ de todas as farmácias ativas. Suspende automaticamente e notifica SUPER_ADMIN se CNPJ ficar inativo.

### Infrastructure

- **`vercel.json`:** Adicionados 2 novos crons: `purge-revoked-tokens` (diário 03h) e `revalidate-pharmacies` (semanal segunda 06h).

### Documentation

- **`docs/roadmap-90pts.md`:** Plano completo para atingir ≥ 90/100 em cada camada, com scores por camada, 17 itens de ação, cronograma de 10 semanas, e checklist de desbloqueio para quando CNPJ estiver disponível.

### Tests

- **510 testes passando** (sem regressões). Mock de `token-revocation` adicionado em `users.test.ts`.

---

## [2.3.0] — 2026-04-08 — Auditoria 5: Services, Webhooks, Constraints

### Security — Critical

- **`createUser` — PHARMACY_ADMIN não vinculado a `pharmacy_members`:** Farmacêuticos criados via painel admin nunca eram inseridos na tabela `pharmacy_members`. Resultado: RLS bloqueava todos os pedidos para esse usuário, e o fix da Auditoria 3 (`updateOrderStatus`) também os bloqueava. Adicionado `from('pharmacy_members').insert(...)` no path `PHARMACY_ADMIN` de `services/users.ts`.
- **Webhook Clicksign sem verificação de assinatura:** `POST /api/contracts/webhook` aceitava qualquer payload sem validação. Qualquer pessoa com a URL podia forjar eventos de contrato assinado. Adicionada verificação de `X-Clicksign-Secret` header contra `CLICKSIGN_WEBHOOK_SECRET` env var (retorna 401 se inválido).

### Security — High

- **`registerConsultantTransfer` — race condition / double-payment:** Duas requisições simultâneas com os mesmos `commissionIds` podiam criar dois repasses. Implementado guarda atômico: `UPDATE consultant_commissions SET status='PROCESSING' WHERE status='PENDING'` antes de criar o repasse. Com rollback para `PENDING` se a criação do repasse falhar.
- **`assignUserRole` — operação não atômica:** Delete + Insert separados deixavam janela onde o usuário ficava sem papel. Substituído por `upsert({ user_id, role }, { onConflict: 'user_id' })`.

### Bug Fixes

- **`updatePharmacyStatus` + `updateDoctorStatus` — audit log incompleto:** Ambas as funções não buscavam o status antigo antes de atualizar, resultando em audit logs sem `oldValues`. Adicionado `select('status')` antes do `update` em ambas.
- **SMS (`lib/sms.ts`) — guard contra phone vazio:** `sendSms('')` chamava Twilio com número inválido (`+55`). Adicionado early return se `phone.trim()` for vazio ou tiver menos de 10 dígitos.
- **WhatsApp (`lib/whatsapp.ts`) — guard contra phone vazio:** Mesmo problema. Adicionado early return com log de aviso.

### Database — Migrations (019, 020)

- **Migration 019 — Constraints financeiras:** `pharmacy_cost <= price_current` em `products`; `price_current > 0` em `products`; `gross_amount > 0` em `payments`, `consultant_transfers`, `transfers`; `commission_amount >= 0` em `consultant_commissions`; `quantity > 0` e `unit_price >= 0` em `order_items`.
- **Migration 020 — Status `PROCESSING`:** Expandido o CHECK de `consultant_commissions.status` para incluir `'PROCESSING'` (necessário para o guarda atômico de double-payment) e `'CANCELLED'`.

### Tests

- **26 novos testes** em `tests/unit/audit5-fixes.test.ts` cobrindo: phone guards (SMS/WhatsApp), constraint logic simulado, verificação do source das correções aplicadas.
- **Testes existentes atualizados:** `assignUserRole` agora testa `upsert`; `registerConsultantTransfer` testa o novo guarda atômico com mensagem de erro correta.
- **Total: 510 testes passando** (26 novos).

---

## [2.2.0] — 2026-04-08 — Auditoria 4: RLS e Pages

### Database — RLS (migration 018)

- **`order_operational_updates` sem RLS:** Tabela expunha atualizações operacionais de qualquer pedido para qualquer usuário autenticado. Adicionados 4 políticas: admins (ALL), farmácia da atualização (INSERT + SELECT), clínica do pedido (SELECT), service_role (ALL).
- **`pharmacy_products` sem RLS:** Associações farmácia-produto visíveis por qualquer usuário. Adicionadas políticas: admins (ALL), farmácia membro (SELECT próprios), usuários autenticados (SELECT ativos — necessário para fluxo de pedido), service_role (ALL).
- **`products` política com precedência ambígua:** `auth.uid() IS NOT NULL AND active = true OR is_platform_admin()` reescrita com parênteses explícitos: `is_platform_admin() OR (auth.uid() IS NOT NULL AND active = true)`.
- **`sla_configs` sem política de leitura para farmácias:** PHARMACY_ADMIN não conseguia ler seus próprios SLAs via Supabase client. Adicionada política: SLA global (pharmacy_id IS NULL) visível para todos autenticados; SLA específico visível apenas para membros da farmácia.

### Components

- **`order-detail.tsx` — comissões sem guarda de role:** Seção de comissões renderizava sem `isAdmin &&`. RLS bloqueava os dados, mas a defesa em profundidade estava ausente. Adicionado `{isAdmin && commission && (`.

### Tests

- **36 novos testes** de lógica de políticas RLS para: commissions, transfers, orders, order_operational_updates, products, sla_configs, pharmacy_products.
- **Total: 484 testes passando.**

---

## [2.1.0] — 2026-04-08 — Auditoria 3: Segurança Cirúrgica

### Security — Critical (3 IDORs corrigidos)

- **`updateOrderStatus` — PHARMACY_ADMIN bypass:** Qualquer farmacêutico podia alterar o status de pedidos de outras farmácias. Adicionado check de `pharmacy_members` verificando se `user_id + pharmacy_id` do pedido coincidem antes de permitir a transição.
- **`/api/orders/templates` — IDOR completo:** GET, POST e DELETE aceitavam qualquer `clinicId` sem verificar se o usuário pertencia àquela clínica. Adicionado check de `clinic_members` + verificação de `created_by` no DELETE. Zod schema com UUID obrigatório.
- **`/api/orders/reorder` — IDOR:** Qualquer usuário autenticado podia repetir pedido de qualquer clínica passando um `orderId` ou `templateId` arbitrário. Adicionado check de `clinic_members` em ambos os caminhos. Zod schema com `.uuid()` obrigatório.

### Security — Medium (5 vulnerabilidades)

- **`GET /api/settings/sla` sem autenticação:** Qualquer pessoa podia consultar configurações de SLA sem estar logada. Adicionado `getCurrentUser()` com 401.
- **`GET /api/products/variants` sem autenticação:** Preços e atributos de variantes expostos sem autenticação. Adicionado `getCurrentUser()` com 401.
- **Race condition em `confirmPayment`:** Duas requisições simultâneas podiam ambas passar pelo guard `status !== 'PENDING'` antes de qualquer uma atualizar. Substituído por UPDATE atômico `WHERE status = 'PENDING'` com verificação de linhas afetadas.
- **`/api/registration/upload-docs` sem validação server-side:** Qualquer tipo e tamanho de arquivo era aceito. Adicionado whitelist de MIME types (PDF, JPG, PNG, WEBP) e limite de 10 MB por arquivo.
- **`/api/documents/upload` sem rate limiting:** Endpoint de upload sem proteção contra abuso. Adicionado `uploadLimiter` (20 uploads/min por usuário).

### Validation — Zod schemas adicionados

- **`/api/payments/asaas/create`:** `orderId` agora validado como UUID.
- **`/api/contracts` POST:** `entityType` como enum + `entityId` como UUID obrigatório.
- **`/api/settings/sla` PATCH:** Configs validados: `warning_days`, `alert_days`, `critical_days` como inteiros ≥ 0.
- **`/api/orders/reorder`:** Schema com `.uuid()` para `orderId` e `templateId`.
- **`/api/orders/templates` POST:** Schema com validação de `name`, `clinicId` (UUID) e `items`.

### Tests

- **37 novos testes** cobrindo: state machine (admin + pharmacy, todos os estados, transições inválidas, estados terminais), cálculo de comissões com edge cases de ponto flutuante, schemas Zod com entradas inválidas.
- **Total: 448 testes passando.**

---

## [2.0.0] — 2026-04-08 — Mês 2: Observabilidade, Resiliência e Escala

### Infrastructure

- **`/api/health` endpoint:** Verifica conectividade com Supabase e variáveis de ambiente. Retorna 200/503 com latência por serviço. Integrado ao middleware como rota pública (sem autenticação).
- **Sentry estrutural (`@sentry/nextjs`):** Instalado e configurado em `sentry.client.config.ts`, `sentry.server.config.ts` e `sentry.edge.config.ts`. Completamente no-op quando `NEXT_PUBLIC_SENTRY_DSN` não está definido. Source maps e performance sampling desativados sem `SENTRY_AUTH_TOKEN`.
- **`lib/monitoring.ts`:** Abstração de observabilidade desacoplada do Sentry. `captureError()`, `recordMetric()`, `identifyUser()` — fallback para `console.error` estruturado quando sem DSN. A app nunca importa `@sentry/nextjs` diretamente.

### Resilience

- **Error boundaries completos:** `app/global-error.tsx` captura erros no root layout. `app/(private)/error.tsx` captura erros em todas as páginas autenticadas com botão "Tentar novamente" e link para o dashboard. Erros auto-reportados via `captureError()`.
- **Loading skeletons:** `app/(private)/loading.tsx` (genérico) e `app/(private)/dashboard/loading.tsx` (específico para KPIs). Mostrados durante server-side rendering sem bloquear navegação.

### Rate Limiting

- **`lib/rate-limit.ts` — abstração Redis-ready:** `check()` agora `async`. Backend selecionado automaticamente:
  - `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` presentes → Upstash Redis (sliding window, multi-instance)
  - Variáveis ausentes → in-memory (dev/staging, sem custo)
- **`exportLimiter` adicionado:** 10 exports/minuto por usuário na rota `/api/export`.
- **Ativação Redis (quando pronto):** Adicionar `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` no Vercel. Sem alteração de código.

### Cursor Pagination

- **`/consultant-transfers`:** Histórico de repasses migrado para cursor pagination. A tabela de comissões pendentes (que não cresce da mesma forma) permanece com query direta.

### Tests

- **411 testes passando** (era 394 após Semana 2).
- `tests/unit/rate-limit-redis.test.ts` — 12 testes: in-memory backend, pre-configured limiters, Redis detection.
- `tests/unit/lib/monitoring.test.ts` — 8 testes: no-op mode, active Sentry mode, fallback logging.
- `tests/__mocks__/@upstash/ratelimit.ts` e `@upstash/redis.ts` — stubs para testes sem pacotes instalados.
- `vitest.config.ts` — `resolve.alias` para pacotes Upstash opcionais.

### Credentials required to activate (documentado em `docs/go-live-checklist.md`)

```
NEXT_PUBLIC_SENTRY_DSN=https://xxx@oyyy.ingest.sentry.io/zzz
SENTRY_ORG=your-org
SENTRY_PROJECT=clinipharma
SENTRY_AUTH_TOKEN=sntrys_xxx
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=AXxx...
```

---

## [1.9.0] — 2026-04-08 — Semana 2: Índices, Cursor Pagination e Cache de Widget

### Performance (Semana 2)

- **Migration 017 — `pg_stat_statements` + 11 índices:** Extensão de diagnóstico habilitada. Índices adicionados por análise de código: `profiles(full_name)`, `clinics(trade_name)`, `pharmacies(trade_name)`, `doctors(full_name)`, `sales_consultants(full_name)`, `payments(created_at DESC)`, `transfers(created_at DESC)`, `consultant_commissions(created_at DESC)`, `audit_logs(created_at DESC)`, `notifications(user_id, created_at DESC)`, `products(name)`, `orders(updated_at)`, `registration_requests(status, created_at DESC)`.
- **Cursor pagination em `/payments`, `/audit`, `/transfers`:** Substituído `OFFSET/LIMIT` por cursor `created_at` nas três páginas de maior crescimento após `/orders`. Novo helper reutilizável `lib/cursor-pagination.ts` com `parseCursorParams` e `sliceCursorResult`.
- **StaleOrdersWidget — filtro DB pré-cursor + `unstable_cache`:** O widget agora filtra `updated_at <= now() - 1 day` no banco (eliminando full table scan de toda a tabela `orders`). Resultado cacheado por 10 minutos com tag `'dashboard'`.

### Tests

- **394 testes passando** (era 370 após Semana 1).
- `tests/unit/cursor-pagination.test.ts` — 15 novos testes cobrindo `parseCursorParams`, `sliceCursorResult`, e cenário de navegação multi-página (3 páginas, 55 registros).
- `tests/unit/lib/notifications-batch.test.ts` — 10 novos testes para `isPreferenceEnabled` (pure function) e semântica do batch query (profileMap filtering).

### Changes

- `supabase/migrations/017_week2_indexes.sql` — migration aplicada
- `lib/cursor-pagination.ts` — helper reutilizável de cursor pagination
- `app/(private)/payments/page.tsx` — cursor pagination
- `app/(private)/audit/page.tsx` — cursor pagination
- `app/(private)/transfers/page.tsx` — cursor pagination
- `components/dashboard/stale-orders-widget.tsx` — filtro DB + `unstable_cache` 10min

---

## [1.8.0] — 2026-04-08 — Semana 1: Performance & Escala

### Performance (Semana 1 — zero custo, só código)

- **Fix N+1 em `createNotificationForRole`:** O loop de N queries individuais para `isTypeEnabled()` substituído por uma única query batch via `.in('id', userIds)` em `profiles`, filtragem em memória. O(n) → O(1) por chamada de role notification.
- **Singleton do admin client:** `createAdminClient()` agora reutiliza o mesmo `SupabaseClient` entre invocações quentes (processo Node.js/V8 warm). Elimina re-inicialização de conexão, headers e interceptors por request.
- **Cache do dashboard admin (`unstable_cache`):** `getDashboardData()` — que fazia 6 queries ao banco a cada carregamento — agora é cacheada por 5 minutos com `unstable_cache` do Next.js 15. Revalidação automática por tag `'dashboard'` nas mutações de `createOrder`, `updateOrderStatus`, `confirmPayment` e `completeTransfer`.
- **Cursor-based pagination na listagem de pedidos:** Substituído `OFFSET/LIMIT` por cursor via `created_at` na página `/orders`. Elimina full-table scan ao navegar para páginas tardias (OFFSET 50000 → `WHERE created_at < cursor`). Novo componente `CursorPagination`.
- **Streaming export CSV:** O endpoint `/api/export` agora transmite dados em batches de 1000 linhas via `ReadableStream`. O CSV começa a ser enviado ao cliente antes de todos os dados serem buscados. Uso de memória: O(1) independente do tamanho da exportação. XLSX permanece buffered (limitação do ExcelJS).

### Changes

- `lib/notifications.ts` — batch fetch de `notification_preferences`, `isPreferenceEnabled()` como função pura
- `lib/db/admin.ts` — singleton pattern com tipo explícito `SupabaseClient<any, 'public', any>`
- `lib/dashboard.ts` — novo arquivo com `getAdminDashboardData` cacheada
- `lib/export.ts` — `toCSV()` aceita `opts.skipHeader` para streaming
- `components/ui/cursor-pagination.tsx` — novo componente de paginação por cursor
- `app/(private)/orders/page.tsx` — migrado para cursor pagination (`?after=` / `?before=`)
- `app/api/export/route.ts` — streaming CSV via `ReadableStream`, XLSX via `fetchAllRows`
- `services/orders.ts` — `revalidateTag('dashboard')` em `createOrder` e `updateOrderStatus`
- `services/payments.ts` — `revalidateTag('dashboard')` em `confirmPayment` e `completeTransfer`
- `components/dashboard/admin-dashboard.tsx` — usa `getAdminDashboardData` do cache

### Documentation

- `docs/scale-1000-clinics.md` — plano revisado com checklist por faixa de clínicas, status de execução por semana, e análise crítica do plano anterior

---

## [1.7.0] — 2026-04-10

### Performance

- **Fix O(n) → O(1) no cron `stale-orders`:** loop de N queries SQL por PHARMACY_ADMIN substituído por uma única query batch via `.in('user_id', pharmacyAdminIds)`. Ganho: de ~N×latência a 1×latência, independente do número de farmácias.

### Tests

- **Cobertura unitária:** de 45% (baseline) para **75.86% statements / 81.55% functions** com 370 testes em 28 arquivos de teste.
- **Novos testes para todos os services:** `clinics`, `doctors`, `pharmacies`, `products`, `payments`, `consultants`, `users`, `orders`, `settings`.
- **Novos testes para lib:** `utils`, `cnpj`, `rate-limit`, `notification-types`, `stale-orders`, `export` (CSV + XLSX), `session`, `rbac`, `commission`, `audit`.
- **Vitest coverage configurado:** `@vitest/coverage-v8` com thresholds de 75% statements / 60% branches / 80% functions.
- **Setup de mocks centralizado:** `tests/setup.ts` com factory `makeQueryBuilder`, `mockSupabaseAdmin`, `mockSupabaseClient` reutilizáveis.

### Documentation

- **`docs/scale-1000-clinics.md` criado:** plano técnico detalhado para operação com 1000+ clínicas cobrindo rate limiter distribuído, particionamento de tabelas, cache de métricas, streaming de exports, Firebase batch, PgBouncer tuning, disaster recovery, roadmap de custo por faixa de clínicas.

### Config

- **`tsconfig.json`:** excluído `tests/**` da compilação principal (mocks são tipados frouxamente por design).
- **`vitest.config.ts`:** coverage configurado com include/exclude adequados e thresholds para CI.

---

## [1.6.0] — 2026-04-08

### Fixed (Auditoria completa — Round 2: arquivo por arquivo)

- **P0 — `clinic_members` coluna errada em dois lugares:** `registration/[id]/route.ts` e `services/users.ts` inseriam `role: 'ADMIN'` mas a coluna no schema é `membership_role`. Todo aprovação de registro de clínica e criação de usuário CLINIC_ADMIN falhava silenciosamente — usuário era criado no Auth mas nunca linkado à clínica.
- **P0 — `product_price_history` coluna errada:** `services/products.ts` inserindo `price:` mas as colunas são `old_price` e `new_price`. Histórico de alteração de preço nunca era persistido.
- **P0 — Confirmação de pagamento: join morto `orders.products(name)`:** `services/payments.ts` buscava nome do produto via `orders.select('products(name)')` mas a FK `orders.product_id` foi removida na migration 008. Email de confirmação ao cliente sempre mostrava "—". Corrigido para extrair nomes via `order_items → products`.
- **P0 — `order_status_history` com `old_status` hardcoded `'AWAITING_PAYMENT'`:** pedido poderia estar em `PAYMENT_UNDER_REVIEW` no momento da confirmação. Corrigido para usar `orderData.order_status` real.
- **P0 — Cron `stale-orders`: PHARMACY_ADMINs nunca notificados:** código consultava `profiles.pharmacy_id` mas a tabela `profiles` não tem essa coluna. Corrigido para buscar via `pharmacy_members` (join correto).
- **P0 — Tracking route: `isCancelled` sempre `false`:** comparava `order_status === 'CANCELLED'` mas o schema usa `'CANCELED'` (um L). Portal público de rastreamento nunca marcava pedido como cancelado.
- **P1 — Contracts webhook: admin sem notificação de assinatura:** `createNotification({ userId: '' })` → `createNotificationForRole('SUPER_ADMIN')`.
- **P1 — IDOR em `updateOwnProfile`:** server action aceitava qualquer `userId` sem verificar se era o caller autenticado. Qualquer usuário logado poderia editar o perfil de outro. Adicionada verificação `user.id !== userId`.
- **P1 — `WITH_ISSUE` não monitorado pelo sistema de alertas de pedidos parados:** status crítico ficava invisível. Adicionado threshold de 1 dia.
- **P1 — Vulnerabilidade HIGH em `xlsx`:** CVE Prototype Pollution + ReDoS. Substituído por `exceljs` (sem vulnerabilidades conhecidas). Export XLSX agora com header em negrito e auto-width de colunas.

### Database

- `supabase/migrations/016_second_audit_fixes.sql`:
  - Precisão `numeric(15,2)` em `product_price_history` e `product_pharmacy_cost_history`
  - 8 novos índices: `clinic_members.user_id`, `pharmacy_members.user_id`, `doctor_clinic_links.clinic_id`, `fcm_tokens.user_id`, `access_logs(user_id, created_at DESC)`, `notifications(user_id, created_at DESC) WHERE read_at IS NULL`, `sla_configs.order_status`, `order_tracking_tokens.token`
  - RLS: clinic members e doctors podem ler seus próprios `order_tracking_tokens`

---

## [1.5.0] — 2026-04-08

### Fixed (Auditoria pré-release)

- **P0 — State machine de status de pedido:** `PHARMACY_ADMIN` podia setar qualquer status arbitrário (inclusive `CANCELED`, `COMMISSION_CALCULATED`). Criado `lib/orders/status-machine.ts` com matriz de transições por papel. Agora toda mudança de status é validada antes de persistir.
- **P0 — Reorder completamente quebrado:** `app/api/orders/reorder/route.ts` usava campos errados (`total_amount` vs `total_price`, `created_by` vs `created_by_user_id`) e não enviava `doctor_id` (coluna `NOT NULL`). Todos os pedidos de repetição falhavam silenciosamente. Corrigido com busca automática do médico principal da clínica.
- **P0 — Reorder gerava código de formato errado:** gerava `PED-{timestamp}` manualmente, bypassando o trigger do banco (`MED-YYYY-NNNNNN`). Corrigido para deixar `code: ''` e o trigger gerar o código padrão.
- **P0 — Webhook Asaas: admin jamais recebia notificação de pagamento confirmado:** `createNotification({ userId: '' })` retorna imediatamente sem fazer nada. Corrigido para `createNotificationForRole('SUPER_ADMIN')`.
- **P0 — Webhook Asaas sem idempotência:** processar `PAYMENT_CONFIRMED` duas vezes avançava o status e criava histórico duplicado. Adicionado guard de idempotência.
- **P0 — Asaas create payment: campo `amount` inexistente na tabela:** deveria ser `gross_amount`. Pagamentos inseridos sem valor.
- **P1 — Farmácia não podia ler documentos dos seus pedidos (RLS):** necessário para execução da manipulação. Policy adicionada.
- **P1 — Sem rate limiting em endpoints sensíveis:** `/forgot-password` e `/registration/submit` expostos a brute force. Rate limiter aplicado.
- **P1 — Sem idempotência em `payments.order_id`:** sem `UNIQUE` constraint, era possível criar múltiplos pagamentos para o mesmo pedido.

### Added

- `lib/orders/status-machine.ts` — máquina de estados com `isValidTransition()` e `getAllowedTransitions()` por papel
- `lib/rate-limit.ts` — rate limiter in-memory (pronto para Upstash Redis em produção multi-instância)
- `lib/utils/cnpj.ts` — validador CNPJ com algoritmo de dígito da Receita Federal
- `tests/unit/status-machine.test.ts` — 13 testes cobrindo transições válidas/inválidas por papel

### Database

- `supabase/migrations/015_audit_fixes.sql`:
  - `UNIQUE(payments.order_id)` — previne cobrança duplicada
  - 9 índices novos em `orders`, `order_items`, `payments`, `profiles`, `clinics`, `order_templates`
  - Precisão financeira ampliada: `numeric(10,2)` → `numeric(15,2)` em todas as colunas de valor
  - `orders.deleted_at` — soft-delete
  - `profiles.last_login_at` — monitoramento de atividade
  - RLS: farmácia lê documentos de seus pedidos
  - RLS: clínica pode cancelar pedido em `DRAFT`/`AWAITING_DOCUMENTS`
  - RLS: DOCTOR pode ver seus próprios pedidos

---

## [1.4.0] — 2026-04-08

### Added

- **Variações de produto:**
  - Tabela `product_variants` com atributos livres (concentração, apresentação, quantidade), preço, custo farmácia e comissão independentes por variante
  - `components/products/product-variants-manager.tsx` — gerenciador inline no formulário de produto; adicionar, editar, marcar padrão, desativar variantes
  - `app/api/products/variants/route.ts` — CRUD completo de variantes (GET, POST, PATCH, DELETE)
  - Migração automática: todos os produtos existentes receberam uma variante "Padrão"
  - `variant_id` adicionado a `order_items` para rastreamento futuro

- **Templates de pedido e Reorder:**
  - Tabela `order_templates` por clínica (todos os membros da clínica enxergam)
  - `components/orders/templates/save-template-modal.tsx` — salva produtos de um pedido como template nomeado
  - `components/orders/templates/templates-list.tsx` — lista de templates na página de pedidos, com botão "Usar"
  - `components/orders/reorder-button.tsx` — botão "Repetir pedido" na tela de detalhe (pedidos concluídos)
  - `app/api/orders/templates/route.ts` — GET/POST/DELETE de templates
  - `app/api/orders/reorder/route.ts` — cria novo pedido a partir de pedido anterior ou template

- **Portal de rastreamento público:**
  - Tabela `order_tracking_tokens` com token único por pedido (gerado automaticamente)
  - `app/track/[token]/page.tsx` — página pública sem autenticação com timeline visual, status atual e ETA estimada; dados financeiros omitidos
  - `app/api/tracking/route.ts` — valida token e retorna dados públicos do pedido
  - Link gerado automaticamente na tela de detalhe do pedido
  - Link expira 30 dias após entrega (configurável via `expires_at`)

- **SLA configurável por farmácia:**
  - Tabela `sla_configs` com thresholds globais (null = padrão) e por farmácia (overrides)
  - 3 níveis de alerta: aviso (warning), alerta (alert), crítico (critical)
  - Seed automático de defaults globais equivalentes aos antigos thresholds hardcoded
  - `components/settings/sla-config.tsx` — UI em Configurações para editar SLA global e por farmácia
  - `app/api/settings/sla/route.ts` — GET/PATCH para leitura e atualização
  - `lib/stale-orders.ts` refatorado para usar DB com fallback

- **BI Avançado (4 novos gráficos em Relatórios):**
  - **Comparação de períodos** — métricas do período atual vs. anterior com delta %
  - **Ranking de clínicas** — top 10 por receita com barras proporcionais
  - **Funil de conversão** — pedidos por etapa (criados → pagos → execução → entregues)
  - **Margem real por produto** — empilhado: custo farmácia + comissão consultor + margem plataforma
  - `components/reports/advanced-bi.tsx` — 4 componentes Recharts independentes

- **Histórico de sessões:**
  - Tabela `access_logs` com IP, user-agent, detecção de novo dispositivo, retenção 90 dias
  - `lib/session-logger.ts` — registra acesso; envia alerta in-app em novo dispositivo
  - `app/api/sessions/route.ts` — GET (usuário vê próprios logs, admin vê todos) + POST (registra sessão)
  - `components/profile/session-history.tsx` — UI no perfil com browser, OS, IP, badge "Novo dispositivo"

### Database

- `supabase/migrations/014_templates_sla_variants_tracking_sessions.sql`:
  - Tabelas: `order_templates`, `sla_configs`, `order_tracking_tokens`, `product_variants`, `access_logs`
  - RLS em todas as novas tabelas
  - Triggers `updated_at` nas tabelas relevantes
  - Seed de 11 configs SLA globais padrão

---

## [1.3.0] — 2026-04-10

### Added

- **Firebase Push Notifications (FCM):**
  - `lib/firebase-admin.ts` — Firebase Admin SDK singleton (server-side)
  - `lib/push.ts` — `sendPushToUser` / `sendPushToRole` helpers
  - `lib/notification-types.ts` — tipos/constantes separados para uso client-side sem dependências Node.js
  - `public/firebase-messaging-sw.js` — service worker para mensagens em background
  - `lib/firebase/client.ts` — SDK cliente; `requestPushPermission` (captura token FCM) + `onForegroundMessage` (toast em foreground)
  - `components/push/push-permission.tsx` — botão no header para solicitar permissão; exibe status ativo/bloqueado
  - `app/api/push/subscribe/route.ts` — `POST`/`DELETE` para salvar/remover FCM tokens na tabela `fcm_tokens`
  - `lib/notifications.ts` — agora envia push automático para `CRITICAL_TYPES`; suporte a `push` flag por notificação
  - ~~Pendente VAPID key~~ ✅ **Configurada:** `BNrMF4L9UwGqH3dHkIZp9-plConcw5YXpcTbfL-mF6_XTv6oIlV10Buw1sgCqd-YVveXECTWcxvWxXgbgf_VQ-U` no Vercel. Push notifications FCM totalmente operacionais.

- **Asaas Payment Gateway (sandbox):**
  - `lib/asaas.ts` — wrapper completo: `findOrCreateCustomer`, `createPayment`, `getPixQrCode`, `cancelPayment`, validação de webhook
  - `app/api/payments/asaas/create/route.ts` — `POST`: cria cobrança Asaas para um pedido; salva `asaas_payment_id`, QR PIX, boleto URL, invoice URL
  - `app/api/payments/asaas/webhook/route.ts` — recebe eventos Asaas (`PAYMENT_CONFIRMED`, `PAYMENT_OVERDUE`); avança status do pedido; dispara notificação in-app + push + SMS + WhatsApp + email
  - `components/orders/payment-options.tsx` — UI com abas PIX (QR Code + copia-e-cola), Boleto e Cartão; botão de geração para admins
  - Integrado na tela de detalhe do pedido (status `AWAITING_PAYMENT`)
  - **Variáveis Vercel configuradas:** `ASAAS_API_KEY`, `ASAAS_API_URL` (sandbox), `ASAAS_WEBHOOK_SECRET`
  - **Pendente produção:** substituir sandbox URL/key; configurar webhook no painel Asaas → `https://clinipharma.com.br/api/payments/asaas/webhook?accessToken=<secret>`

- **SMS via Twilio (test credentials):**
  - `lib/sms.ts` — `sendSms` com normalização de número BR; templates para eventos críticos
  - Integrado no webhook Asaas (PAYMENT_CONFIRMED → SMS à clínica)
  - **Variáveis Vercel:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (test), `TWILIO_PHONE_NUMBER` (+15005550006 test)
  - **Pendente produção:** conta real Twilio + número BR +55

- **WhatsApp via Evolution API (infraestrutura pronta, deploy pendente):**
  - `lib/whatsapp.ts` — wrapper `sendWhatsApp` + templates completos (pedido criado/confirmado/pronto/enviado/entregue, contrato enviado, cadastro aprovado/reprovado, alerta parado)
  - Integrado no webhook Asaas e notificações
  - **Pendente:** (1) número WhatsApp; (2) deploy Evolution API (Docker `atendai/evolution-api:v2.2.3` em Render/VPS pago ou Railway); (3) atualizar `EVOLUTION_API_URL` no Vercel

- **Assinatura eletrônica Clicksign (sandbox):**
  - `lib/clicksign.ts` — `generateContractPdf` (gera PDF A4 com `pdf-lib`), `uploadDocument`, `addSigner`, `notifySigners`, `createAndSendContract`
  - Templates de contrato para CLINIC, DOCTOR, PHARMACY, CONSULTANT
  - `app/api/contracts/route.ts` — `POST` (SUPER_ADMIN cria e envia contrato) + `GET` (lista contratos por entidade)
  - `app/api/contracts/webhook/route.ts` — recebe eventos Clicksign (`sign`, `auto_close`, `deadline_exceeded`, `cancelled`); atualiza status + notifica usuário
  - `components/contracts/contract-status.tsx` — exibe status do contrato com badge, data de assinatura e link para download
  - Botão "Enviar contrato" adicionado em `RegistrationActions` (aprovação de clínica/médico)
  - **Variáveis Vercel:** `CLICKSIGN_ACCESS_TOKEN` (sandbox), `CLICKSIGN_API_URL` (sandbox)
  - **Pendente produção:** token + URL produção Clicksign; configurar webhook → `https://clinipharma.com.br/api/contracts/webhook`

- **NF-e / NFS-e — modelo fiscal definido (implementação pendente CNPJ):**
  - Modelo: Clinipharma recebe pagamento integral → repassa `pharmacy_cost` à farmácia + `consultant_commission` ao consultor → retém margem
  - Farmácia emite NF-e para a clínica (produtos); Clinipharma emite NFS-e para a clínica (serviço de intermediação)
  - Integrador escolhido: **Nuvem Fiscal**
  - **Variáveis Vercel pré-configuradas:** `NUVEM_FISCAL_CLIENT_ID`, `NUVEM_FISCAL_CLIENT_SECRET`, `NUVEM_FISCAL_CNPJ` (todos com valor `PENDING_CNPJ`)
  - **Pendente:** CNPJ + regime tributário com contadora → substituir valores no Vercel → implementar emissão

### Database

- **Migration 013 (`013_payments_push_contracts.sql`) aplicada:**
  - `fcm_tokens` — armazena tokens FCM por usuário (com RLS)
  - `payments.asaas_payment_id`, `asaas_invoice_url`, `asaas_pix_qr_code`, `asaas_pix_copy_paste`, `asaas_boleto_url`, `payment_link`, `payment_due_date` — campos do gateway Asaas
  - `clinics.asaas_customer_id` — ID do cliente no Asaas (evita re-criação)
  - `contracts` — contratos digitais com status, chaves Clicksign, signatários (com RLS)

### Tests

- **142 testes unitários passando (zero falhas)**
- `tests/setup.ts` atualizado: mocks para `firebase-admin`, Firebase client SDK e Twilio (evita inicialização de credenciais nos testes)
- `tests/unit/notifications.test.ts` — atualizado para importar de `@/lib/notification-types` (sem dependências Node.js)

---

## [1.2.0] — 2026-04-10

### Added

- **Filtro de período nos relatórios:** `DateRangePicker` com atalhos (Hoje, Esta semana, Este mês, Mês anterior, Últimos 3/6/12 meses, Personalizado). Padrão: Este mês. Persiste em URL params (`?from=&to=&preset=`). Todos os KPIs e gráficos filtrados pelo período.
- **Gráficos interativos com Recharts:** substituídas as barras CSS por:
  - `OrdersBarChart` — pedidos por período (BarChart)
  - `RevenueBarChart` — faturamento por período (BarChart)
  - `StatusPieChart` — pedidos por status (donut chart)
  - `PharmacyRevenueChart` — faturamento por farmácia (horizontal bar)
  - `ConsultantCommChart` — comissões por consultor (horizontal bar)
  - Todos com tooltip, hover e valores formatados em R$
- **Export filtrado por período:** botão de exportação em relatórios agora passa `from`/`to` para a API; nome do arquivo inclui o período (ex: `pedidos_2026-04-01_a_2026-04-30.csv`).
- **Alertas de pedidos parados:**
  - Widget vermelho no dashboard do SUPER_ADMIN e PHARMACY_ADMIN listando pedidos stale com link direto
  - Thresholds: 3 dias (fases financeiras/docs), 5 dias (fases operacionais)
  - Vercel Cron (`0 8 * * *`) em `/api/cron/stale-orders`: notificação in-app + email digest para SUPER_ADMIN e farmácia responsável pelos pedidos dela
  - Tipo `STALE_ORDER` adicionado a `NotificationType`
- **Preferências de notificação por usuário:**
  - Migration 012: coluna `notification_preferences jsonb` em `profiles` (default `{}`)
  - Críticas (sempre enviadas): `ORDER_CREATED`, `ORDER_STATUS`, `PAYMENT_CONFIRMED`, `DOCUMENT_UPLOADED`
  - Silenciáveis: `TRANSFER_REGISTERED`, `CONSULTANT_TRANSFER`, `PRODUCT_INTEREST`, `REGISTRATION_REQUEST`, `STALE_ORDER`
  - UI em `/profile` — seção "Preferências de notificação" com toggles por tipo
  - API `PATCH /api/profile/notification-preferences` persiste as preferências
  - `lib/notifications.ts` checa `notification_preferences` antes de inserir qualquer notificação (críticos ignoram a preferência)
- **Variável de ambiente `CRON_SECRET`:** adicionada ao `.env.local` (desenvolvimento) e ao Vercel via API REST (Production + Preview + Development). Redeploy disparado e concluído automaticamente.

### Tests

- **142 testes unitários passando (zero falhas):** 56 novos testes em 3 novos arquivos.
- **`tests/unit/stale-orders.test.ts`** (19 casos): cobre `getStaleThreshold` (thresholds corretos por fase, null para terminais), `getDaysDiff` (com fake timers), e lógica de detecção de pedido parado.
- **`tests/unit/notifications.test.ts`** (20 casos): valida `SILENCEABLE_TYPES`, `CRITICAL_TYPES`, disjunção entre os dois conjuntos, e semântica de preferências (tipos críticos sempre ativos; silenciáveis respeitam `prefs[type] !== false`).
- **`tests/unit/date-range.test.ts`** (17 casos): testa as funções puras `today`, `daysAgo`, `startOfMonth`, `endOfMonth`, `startOfYear` e garante que todos os presets têm `from <= to`.

---

## [1.1.0] — 2026-04-10

### Fixed

- **Upload de documentos no fluxo PENDING_DOCS:** a página `/profile` agora detecta automaticamente quando o usuário está com status `PENDING_DOCS` e exibe um bloco laranja no topo com a lista exata de documentos solicitados pelo admin, incluindo texto personalizado ("Outro"). Cada documento tem botão de upload individual com troca de arquivo.
- **Re-notificação ao SUPER_ADMIN:** após o usuário enviar os documentos extras, a API `POST /api/registration/upload-docs` reverte o status para `PENDING`, envia notificação in-app e email HTML a todos os SUPER_ADMINs com link direto para a solicitação.
- **Status do cadastro visível em /profile:** campo "Status do cadastro" exibido na sidebar de informações quando o usuário não está APPROVED.

### Tests

- **86 testes unitários passando (zero falhas):** corrigido prefixo `CP-` em `generateOrderCode`; `orderSchema` refatorado para `items array`; `clinicSchema` e `productSchema` validados com campos reais.
- **Novo arquivo `tests/unit/registration.test.ts`:** 13 casos cobrindo `CLINIC_REQUIRED_DOCS`, `DOCTOR_REQUIRED_DOCS`, labels, cores de status e `ALL_REQUESTABLE_DOCS`; duplicata `OPERATING_LICENSE` removida de `EXTRA_DOC_OPTIONS`.
- **E2E (Playwright) expandido:** credenciais atualizadas; 10 novos casos em `auth.test.ts` cobrindo `/registro`; `catalog.test.ts` expandido com filtros, modal de interesse, painéis `/registrations` e `/interests`.

---

## [1.0.0] — 2026-04-10

### Added

- **Auto-cadastro de clínicas e médicos (`/registro`):**
  - Página pública multi-step: escolha de perfil (Clínica ou Médico) → dados cadastrais → upload de documentos obrigatórios
  - Conta criada imediatamente com `registration_status: PENDING`; usuário pode logar e navegar, mas não pode criar pedidos até aprovação
  - Email de confirmação enviado ao solicitante; email + notificação in-app ao SUPER_ADMIN
  - Farmácias continuam sendo cadastradas exclusivamente pelo SUPER_ADMIN (sem auto-cadastro)

- **Fluxo de aprovação (painel `/registrations`):**
  - Lista filtrável por status: Aguardando análise / Documentos pendentes / Aprovado / Reprovado
  - Página de detalhe com todos os dados e documentos do solicitante (links para abrir cada arquivo)
  - Três ações exclusivas do SUPER_ADMIN:
    - **Aprovar** → cria a entidade (clínica ou médico), email de boas-vindas com link para o usuário definir a própria senha (mesmo mecanismo da recuperação de senha)
    - **Reprovar** → modal com campo de motivo, email com a justificativa enviado ao solicitante
    - **Pedir documentos** → seleção de lista predefinida + campo livre "Outro", email e notificação in-app ao solicitante
  - Item "Cadastros" adicionado à sidebar do SUPER_ADMIN com ícone `ClipboardList`

- **Welcome email com definição de senha:**
  - Qualquer usuário criado pelo admin (farmácia, clínica, médico via painel) recebe email com link "Definir minha senha" gerado via `supabase.auth.admin.generateLink({ type: 'recovery' })`
  - Campo de senha removido do formulário de criação de usuário pelo admin; sistema gera senha temporária internamente

- **Banner de status no dashboard:**
  - Usuários PENDING: banner âmbar "Cadastro em análise"
  - Usuários PENDING_DOCS: banner laranja "Documentos pendentes" com link para `/profile`
  - Usuários REJECTED: banner vermelho "Cadastro não aprovado"

- **Bloqueio de criação de pedidos:**
  - Redirecionamento automático para `/dashboard` ao tentar acessar `/orders/new` sem `registration_status = APPROVED`

- **Seleção de clínica no pedido para médicos:**
  - Médicos vinculados a uma só clínica: clínica auto-selecionada
  - Médicos com múltiplas clínicas: dropdown exibe apenas as clínicas vinculadas ao médico
  - Vinculação via tabela `doctor_clinic_links`

- **Link "Solicitar cadastro" na tela de login** aponta para `/registro`

- **Migration `011_registration_flow.sql`:**
  - Campo `registration_status text DEFAULT 'APPROVED' CHECK (IN ('PENDING','PENDING_DOCS','APPROVED','REJECTED'))` em `profiles`
  - Tabela `registration_requests` (tipo, status, form_data jsonb, user_id, entity_id, admin_notes, requested_docs jsonb, reviewer info, timestamps)
  - Tabela `registration_documents` (request_id, document_type, label, filename, storage_path, public_url)
  - Bucket `registration-documents` (privado) no Supabase Storage
  - RLS em ambas as tabelas (owner, admins, service_role)

- **Novos tipos:** `RegistrationStatus`, `RegistrationType`, `RequestedDoc`, `RegistrationRequest`, `RegistrationDocument` em `types/index.ts`

- **Constantes de registro:** `lib/registration-constants.ts` — listas de documentos obrigatórios por tipo, opções extras, labels e cores de status

- **Novo tipo de notificação `REGISTRATION_REQUEST`** adicionado a `lib/notifications.ts`

### Changed

- `services/users.ts`: campo `password` agora opcional; sistema gera senha temporária e envia welcome email automaticamente
- `middleware.ts`: `/registro` e `/api/registration/submit` adicionados às rotas públicas
- `ProfileWithRoles` e `Profile` agora expõem `registration_status`

---

## [0.9.0] — 2026-04-09

### Added

- **Status `unavailable` nos produtos:** terceiro estado além de `active` e `inactive`. No formulário de produto, o toggle virou um select de 3 opções (✅ Ativo / ⚠️ Indisponível / 🚫 Inativo).
- **Botão "Tenho interesse" no catálogo:** produtos indisponíveis aparecem com imagem em grayscale, overlay "Indisponível" e botão âmbar no lugar de "Ver detalhes".
- **Modal de interesse:** formulário com nome e WhatsApp (sempre em branco), confirmação visual após envio.
- **API `POST /api/products/interest`:** valida dados, salva na tabela `product_interests`, dispara notificação in-app e email ao SUPER_ADMIN com link clicável para WhatsApp.
- **Painel `/interests`:** exclusivo para SUPER_ADMIN. Lista todos os interesses registrados (produto, interessado, WhatsApp clicável, email, data) com paginação. Card de resumo dos produtos com mais interesse no topo. Adicionado à sidebar.
- **Notificação in-app (`PRODUCT_INTEREST`):** novo tipo no `NotificationType`, envia para todos os usuários com papel `SUPER_ADMIN`.
- **Email ao SUPER_ADMIN:** HTML com tabela de dados do interessado + botão "Ver todos os interesses" linkando para `/interests`.
- **Migration `010_product_status_interests.sql`:** adiciona coluna `status` em `products` com constraint `CHECK (status IN ('active','unavailable','inactive'))`; cria tabela `product_interests` com RLS.

### Changed

- Catálogo (`/catalog`) agora filtra por `status IN ('active', 'unavailable')` em vez de `active = true`, exibindo produtos indisponíveis com visual diferenciado.
- `ProductCard` no `CatalogGrid` virou Client Component para suportar abertura do modal de interesse.
- `services/products.ts`: na criação/atualização, o campo `active` é derivado automaticamente do `status` (`status !== 'inactive'`).
- `types/index.ts`: campo `status` adicionado em `Product`; novo tipo `ProductInterest`.
- `lib/validators`: novo schema `productInterestSchema`; campo `status` adicionado em `productSchema`.

---

## [0.8.0] — 2026-04-09

### Added

- **Fluxo completo de recuperação de senha end-to-end:**
  - Rota `POST /api/auth/forgot-password` — gera `token_hash` via `supabase.auth.admin.generateLink()` e envia email HTML diretamente pelo Resend, sem depender de SMTP ou Auth Hooks
  - Callback `/auth/callback` agora trata dois fluxos: `token_hash` + `verifyOtp` (recovery) e `code` + `exchangeCodeForSession` (PKCE/OAuth)
  - Nova página `/reset-password` — formulário com validação de senha (mín. 8 chars) e confirmação; após salvar redireciona para o dashboard
  - Edge Function `send-auth-email` deployada no Supabase (reserva para Auth Hook, não utilizada ativamente)
- **Usuário SUPER_ADMIN real cadastrado:** `cabralandre@yahoo.com.br` (André) com acesso completo à plataforma

### Fixed

- Middleware: adicionado `/api/auth/forgot-password` e `/reset-password` às rotas públicas — sem isso o middleware redirecionava o POST para `/login` causando erro 405
- `tsconfig.json`: exclui `supabase/functions/` do TypeScript do Next.js para evitar conflito com tipos Deno
- `NEXT_PUBLIC_APP_URL` substituído por detecção dinâmica do `origin` no header da requisição — funciona corretamente em qualquer ambiente (local, preview, produção)

---

## [0.7.0] — 2026-04-09

### Added

- **Paginação server-side** em todas as listagens (20 itens/página, Auditoria 50). Componente `Pagination` com elipsis, first/last e navegação por URL (`?page=N`).
- **Catálogo melhorado:** filtro de categoria corrigido (usa `category_id`), ordenação configurável (destaque, A–Z, menor/maior preço, mais recente), paginação de 12/página.
- **Notificações in-app:** tabela `notifications` com RLS e realtime. Sino no header com badge de contagem, dropdown, marcar como lida/todas, navegação ao link. Integrado em: criação de pedido, confirmação de pagamento, status do pedido e conclusão de repasse.
- **Exportação CSV/Excel:** `ExportButton` com dropdown CSV/xlsx em Pedidos (admins), Pagamentos, Repasses e Repasses a Consultores. Rota `/api/export?type=&format=` protegida por RBAC.
- **Dashboard de relatórios enriquecido:** KPIs com ícones e cores, gráfico de barras CSS (últimos 6 meses), breakdown de status com barra de progresso, cards de entidades, alertas de pendências financeiras no topo.
- **Busca global `⌘K`** no header: pesquisa pedidos, clínicas, médicos e produtos em tempo real com debounce 300ms, navegação por teclado (↑↓ Enter Esc), ícones por tipo.
- **Gestão de documentos por tipo:** `DocumentManager` com checklist de tipos obrigatórios (receita médica, identidade, relatório médico, autorização, outro), indicadores visual presente/ausente, upload adicional diretamente no detalhe do pedido.
- Rota `POST /api/documents/upload` — upload seguro para Supabase Storage com RBAC (max 10 MB, PDF/JPG/PNG).
- Cloudflare DNS configurado e propagado. Domínio `clinipharma.com.br` ativo com HTTPS.
- Resend verificado e emails transacionais ativos em produção.

### Changed

- Todas as listagens agora usam `.range()` + `count: 'exact'` para total real no servidor.
- `CatalogFilters` reseta `?page` ao trocar qualquer filtro para evitar página fora do range.
- `lib/utils` ganhou `parsePage` e `paginationRange` helpers.

---

## [0.6.0] — 2026-04-09

### Added

- **Múltiplos produtos por pedido:** nova tabela `order_items` com campos congelados (`unit_price`, `pharmacy_cost_per_unit`, `platform_commission_per_unit`) por item. A tabela `orders` passa a ser cabeçalho do pedido.
- Formulário de criação de pedido virou um **carrinho**: permite adicionar N produtos da mesma farmácia com quantidade individual e resumo em tempo real.
- Página de detalhe do pedido exibe tabela de itens com subtotal por linha.
- Trigger `freeze_order_item_price` congela preço e custos no INSERT de cada `order_item`.
- Trigger `recalc_order_total` recalcula `orders.total_price` automaticamente após qualquer alteração em `order_items`.
- RLS para `order_items` espelhando as políticas de `orders`.

### Changed

- `orders` não possui mais as colunas `product_id`, `quantity`, `unit_price`, `pharmacy_cost_per_unit`, `platform_commission_per_unit` (migradas para `order_items`).
- `services/payments.ts` agora soma os custos de todos os itens para calcular repasse e comissão.
- `services/orders.ts` aceita array de itens na criação.
- `types/index.ts` — novo tipo `OrderItem`; `Order` atualizado.

---

## [0.5.0] — 2026-04-09

### Alterado

- **Renomeação da plataforma: MedAxis → Clinipharma**
  - Substituição global em todo o codebase (58 arquivos): nome, URLs, emails, metadados
  - Prefixo dos códigos de pedido: `MED-` → `CP-` (ex: `CP-2026-000001`)
  - Migration 006: atualiza `app_settings` (platform_name, support_email) e recria trigger `generate_order_code()` com prefixo `CP-`
  - Emails atualizados: `noreply@clinipharma.com.br`, `suporte@clinipharma.com.br`
  - Repositório GitHub: `cabralandre82/MedAxis` (pendente renomear)
  - Domínio: `clinipharma.com.br` (configuração de DNS em andamento)

- **Email transacional ativado com Resend**
  - `RESEND_API_KEY` configurada em `.env.local` e pendente no Vercel
  - 5 templates ativos: novo pedido, pagamento confirmado, repasse à farmácia, status atualizado, repasse a consultor

---

## [0.4.0] — 2026-04-08

### Adicionado

- **Custo de repasse por produto (`pharmacy_cost`)**
  - Campo `pharmacy_cost` obrigatório em `products` — valor fixo que a plataforma deve repassar à farmácia por unidade vendida
  - Campos `pharmacy_cost_per_unit` e `platform_commission_per_unit` em `orders` — congelados no `INSERT` via trigger junto com `unit_price`
  - Migration 005 aplica todas as alterações de schema

- **Painel de análise de margem no formulário de produto**
  - Preview em tempo real: preço ao cliente → repasse farmácia → margem bruta → comissão do consultor → lucro líquido (com e sem consultor)
  - Aviso em vermelho quando `pharmacy_cost` é tão alto que a margem bruta não cobre a comissão global dos consultores

- **Seção "Análise de margem" no detalhe do produto**
  - Breakdown estático completo: margem bruta em R$ e %, comissão de consultor, lucro líquido nos dois cenários

### Alterado

- **Comissão de consultores: de individual para global**
  - `sales_consultants.commission_rate` removido — taxa não é mais por consultor
  - Nova chave `consultant_commission_rate` em `app_settings` — percentual único aplicado a todos os consultores sobre o valor total de cada pedido
  - Página de Configurações atualizada com label, hint descritivo e unidade (%)
  - Formulário, listagem e detalhe de consultores: campo `commission_rate` removido; informativo sobre taxa global adicionado

- **`services/payments.ts` — cálculo financeiro na confirmação de pagamento**
  - Usa `pharmacy_cost_per_unit` e `platform_commission_per_unit` congelados no pedido (fallback para produto atual em pedidos antigos)
  - Busca `consultant_commission_rate` de `app_settings` em vez de `commission_rate` do consultor

- **`app_settings`**: `default_commission_percentage` substituído por `consultant_commission_rate` (padrão: 5%)

### Regras de negócio acrescentadas

- RN-16 a RN-19: custo de farmácia por produto, congelamento no pedido, margem da plataforma e regra de não-prejuízo para consultores (ver `BUSINESS_RULES.md`)

---

## [0.3.0] — 2026-04-09

### Adicionado

- **Módulo de Consultores de Vendas**
  - Tabelas: `sales_consultants`, `consultant_commissions`, `consultant_transfers` (migration 004)
  - `clinics.consultant_id` — FK vinculando cada clínica ao seu consultor
  - CRUD completo: `/consultants`, `/consultants/new`, `/consultants/[id]`, `/consultants/[id]/edit`
  - Página `/consultant-transfers` — comissões pendentes + registro de repasse em batch
  - `AssignConsultantDialog` — vincula/troca consultor diretamente no detalhe da clínica
  - `ConsultantTransferDialog` — registra repasse batch com referência e observações
  - Dashboard do consultor (`SALES_CONSULTANT`) — KPIs, clínicas vinculadas, histórico de comissões
  - `services/consultants.ts` — createConsultant, updateConsultant, updateStatus, assignToClinic, registerTransfer
  - Auto-criação de `consultant_commission` na confirmação de pagamento (`services/payments.ts`)
  - Role `SALES_CONSULTANT` adicionado ao sistema de papéis
  - Suporte ao role `SALES_CONSULTANT` na criação de usuários com vínculo de `consultant_id`
  - Sidebar: itens "Consultores" e "Repasses Consultores" para admins

### Alterado

- **RBAC: Consultores restrito ao SUPER_ADMIN**
  - `PLATFORM_ADMIN` pode somente visualizar listagem e detalhes de consultores
  - Criação, edição, vinculação e repasse a consultores: exclusivo `SUPER_ADMIN`
  - Proteção em duas camadas: UI (botões ocultos) + backend (Server Actions rejeitam)
- `RBAC_MATRIX.md` — atualizado com coluna `SALES_CONSULTANT` e novos módulos

---

## [0.2.0] — 2026-04-09

### Adicionado

- **Gestão de Usuários** (`/users`, `/users/new`, `/users/[id]`)
  - Criação de usuário via Supabase Admin API (auth + profile + role + vínculo de org)
  - Redefinição de senha pelo admin (`ResetPasswordDialog`)
  - Listagem com busca por nome, email e papel
- **Página de Perfil** (`/profile`) — qualquer usuário edita nome e telefone
- **CRUD completo de entidades**
  - Clínicas: `/clinics/new`, `/clinics/[id]`, `/clinics/[id]/edit`, controle de status
  - Médicos: `/doctors/new`, `/doctors/[id]`, `/doctors/[id]/edit`
  - Farmácias: `/pharmacies/new`, `/pharmacies/[id]`, `/pharmacies/[id]/edit`, dados bancários
  - Produtos: `/products/new`, `/products/[id]`, `/products/[id]/edit`, histórico de preço
- **`PriceUpdateForm`** — dialog com campo de motivo obrigatório para atualização de preço
- **`PharmacyOrderActions`** — farmácia avança status do pedido (execução → enviado → entregue)
- **`ClinicStatusActions`** — dropdown de transição de status para clínicas
- **`services/clinics.ts`** — createClinic, updateClinic, updateClinicStatus
- **`services/doctors.ts`** — createDoctor, updateDoctor, linkDoctorToClinic
- **`services/pharmacies.ts`** — createPharmacy, updatePharmacy, updatePharmacyStatus
- **`services/products.ts`** — createProduct, updateProduct, updateProductPrice, toggleActive
- **`services/users.ts`** — createUser, updateUserProfile, assignUserRole, resetUserPassword, deactivateUser, updateOwnProfile
- **`components/shared/status-badge.tsx`** — EntityStatusBadge e OrderStatusBadge
- **`next.config.ts`** — imagens Supabase Storage + serverActions bodySizeLimit 10MB
- **`vercel.json`** — configuração de deploy com região GRU (São Paulo)
- Sidebar: item "Usuários" (admins) e ícone separado para Produtos (Package)
- Header: link "Meu perfil" aponta para `/profile`

### Infraestrutura (produção)

- Migrations aplicadas no Supabase via `supabase db push`
- Seed executado: 5 categorias, 2 farmácias, 2 clínicas, 2 médicos, 5 produtos
- Storage buckets criados: `product-images` (público) e `order-documents` (privado)
- 5 usuários criados com papéis e vínculos de organização
- Deploy realizado na Vercel — https://clinipharma-three.vercel.app
- Supabase Auth configurado com Site URL e Redirect URLs de produção

### Corrigido

- `lib/db/server.ts` — exporta `createServerClient` como alias de `createClient`
- `EntityStatus` — adicionados `INACTIVE` e `SUSPENDED`
- `OrderStatus` no status-badge alinhado com valores reais do banco
- `ProductPriceHistory` — campo `price` correto (substituía `old_price`/`new_price`)
- `DialogTrigger` e `DropdownMenuTrigger` — substituído `asChild` por `render` prop (base-ui)
- Imports `Button` não utilizados removidos de múltiplos componentes

---

## [0.1.0] — 2026-04-08

### Adicionado

- Bootstrap Next.js 15 + TypeScript + Tailwind CSS v4 + shadcn/ui
- ESLint, Prettier, Husky, lint-staged
- Estrutura completa de pastas e tipos TypeScript
- Documentação base: README, PRODUCT_OVERVIEW, PRD, ARCHITECTURE, DATABASE_SCHEMA, RBAC_MATRIX, BUSINESS_RULES, DEPLOY, USER_FLOWS, TEST_PLAN, CHANGELOG
- Migrations do banco de dados (001 schema, 002 functions/triggers, 003 RLS policies)
- Autenticação Supabase Auth (email/senha, recuperação de senha)
- Middleware de proteção de rotas + RBAC com guards de papel
- Layout base (sidebar, header, shell) com navegação dinâmica por papel
- Dashboard diferenciado por papel (admin, clínica, médico, farmácia)
- Catálogo privado com filtros por categoria, farmácia e busca
- Página de detalhe de produto
- Criação de pedidos com congelamento de preço por trigger de banco
- Upload de documentos obrigatório para Supabase Storage
- Timeline de status do pedido com histórico
- Módulo de pagamentos — confirmação manual pelo admin
- Módulo de comissões — cálculo automático no momento da confirmação
- Módulo de repasses — registro manual de transferência
- Logs de auditoria automáticos em todas as ações críticas
- Configurações globais (comissão default)
- Relatórios com KPIs operacionais e financeiros
- Testes unitários com Vitest (46 testes)
- Testes E2E com Playwright
- Seeds de desenvolvimento
