# Clinipharma — Estudo de Aplicações de IA na Plataforma

> **Autor:** Análise técnica gerada em 2026-04-12  
> **Objetivo:** Avaliação exaustiva de onde a inteligência artificial pode ser aplicada na plataforma Clinipharma, considerando viabilidade técnica, impacto de negócio, custo de implementação e riscos.  
> **Metodologia:** Análise de todas as tabelas do banco, fluxos de usuário, dados disponíveis, perfis de usuário e casos de uso existentes.

---

## 1. Mapa da Plataforma (base para o estudo)

Antes de qualquer recomendação, é fundamental entender quem usa a plataforma e quais dados existem.

### 1.1 Perfis de usuário

| Perfil               | O que faz na plataforma                                                                    | Volume esperado  |
| -------------------- | ------------------------------------------------------------------------------------------ | ---------------- |
| **Super Admin**      | Gerencia tudo: aprovar cadastros, configurar preços, ver relatórios globais, emitir cupons | 1–5 pessoas      |
| **Platform Admin**   | Opera dia a dia: pedidos, suporte, pagamentos                                              | 2–10 pessoas     |
| **Clinic Admin**     | Cria pedidos, gerencia médicos, acompanha status                                           | 1–3 por clínica  |
| **Doctor**           | Consulta catálogo, pode expressar interesse em produtos                                    | N por clínica    |
| **Pharmacy Admin**   | Recebe pedidos, atualiza status de execução                                                | 1–3 por farmácia |
| **Sales Consultant** | Acompanha comissões, gerencia carteira de clínicas                                         | 1–N              |

### 1.2 Dados disponíveis (capital de IA)

| Entidade     | Tabela                                                  | Dados relevantes para IA                                    |
| ------------ | ------------------------------------------------------- | ----------------------------------------------------------- |
| Pedidos      | `orders`, `order_items`, `order_status_history`         | produto, clínica, farmácia, valor, datas de cada status     |
| Produtos     | `products`, `product_variants`, `product_price_history` | preço, categoria, farmácia responsável, histórico de preços |
| Clínicas     | `clinics`, `clinic_members`                             | localização, estado, data de cadastro, status               |
| Médicos      | `doctors`, `doctor_clinic_links`                        | especialidade, CRM, estado                                  |
| Interesses   | `product_interests`                                     | produto desejado + dados do usuário                         |
| Suporte      | `support_tickets`, `support_messages`                   | categoria, prioridade, histórico de mensagens               |
| Cupons       | `coupons`                                               | produto, clínica, tipo de desconto, usos                    |
| Leads        | `registration_drafts`                                   | até onde chegou no cadastro, dados do formulário            |
| Financeiro   | `payments`, `consultant_commissions`, `transfers`       | valores, datas, status                                      |
| Auditoria    | `audit_logs`                                            | todas as ações com timestamp e usuário                      |
| Rastreamento | `order_tracking_tokens`, `access_logs`                  | comportamento de acesso                                     |

### 1.3 Fluxo de valor da plataforma

```
Clínica cadastra → Médico prescreve → Clínica pede produto → Farmácia manipula
→ Entrega → Pagamento → Comissão ao consultor → Plataforma retém margem
```

Cada etapa desse fluxo é uma oportunidade de IA.

---

## 2. Aplicações de IA — Análise Completa

As aplicações estão organizadas em 4 horizontes:

- **H1 — Curto prazo** (1–4 semanas, dados já existem, baixa complexidade)
- **H2 — Médio prazo** (1–3 meses, dados já existem, complexidade moderada)
- **H3 — Longo prazo** (3–6 meses, pode exigir acúmulo de dados ou infraestrutura extra)
- **H4 — Visão de futuro** (6–12 meses, transformacional, exige volume de dados maduro)

---

### 2.1 Classificação e Triagem Inteligente de Tickets de Suporte

**Horizonte:** H1  
**Impacto:** ⭐⭐⭐⭐⭐  
**Complexidade:** ⭐⭐

**Situação atual:**  
Quando uma clínica abre um ticket de suporte, ela precisa escolher manualmente a categoria (`ORDER`, `PAYMENT`, `TECHNICAL`, `GENERAL`, `COMPLAINT`) e a prioridade (`LOW`, `NORMAL`, `HIGH`, `URGENT`). Na prática, usuários escolhem `GENERAL` e `NORMAL` por padrão, e o admin precisa reclassificar. O campo `assigned_to_user_id` é nulo até o admin atribuir manualmente.

**O que a IA faz:**  
No momento em que o usuário submete o título e a primeira mensagem do ticket, um LLM (GPT-4o ou Claude Haiku — custo ~$0.001 por ticket) analisa o texto e:

1. Classifica automaticamente a categoria com justificativa
2. Sugere prioridade com base em palavras-chave de urgência ("pedido atrasado", "pagamento recusado", "entrega não chegou")
3. Detecta o pedido relacionado (se houver número no texto) e inclui contexto automaticamente
4. Direciona para o agente com menor fila ou especialidade mais adequada

**Dado que permite isso:**  
Histórico de `support_messages` + `support_tickets` já existente. Com ~100 tickets resolvidos, é possível fazer few-shot learning. Com 500+, é possível fine-tuning.

**Impacto esperado:**

- Redução de 60–70% no tempo de triagem manual
- Tickets críticos (ex: "pagamento duplicado") com prioridade URGENT chegam ao admin em segundos, não horas
- Base para SLA de resolução por categoria

**Implementação:**

```typescript
// Em app/api/support/route.ts — após salvar o ticket:
const classification = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [
    {
      role: 'system',
      content: 'Você é um classificador de tickets de suporte de uma plataforma B2B médica...',
    },
    {
      role: 'user',
      content: `Título: ${title}\nMensagem: ${body}`,
    },
  ],
  response_format: { type: 'json_object' },
})
// Aplica category, priority, e suggested_assignee_id automaticamente
```

**Custo estimado:** < R$10/mês até 1.000 clínicas ativas  
**Risco:** Baixo. Classificação errada é simplesmente corrigida pelo admin. Nunca bloqueia nenhuma ação.

---

### 2.2 Alerta Preditivo de Recompra (Previsão de Próximo Pedido)

**Horizonte:** H1  
**Impacto:** ⭐⭐⭐⭐⭐  
**Complexidade:** ⭐⭐

**Situação atual:**  
Cada clínica já possui um histórico de pedidos com datas, produtos e quantidades. Nenhuma inteligência é aplicada sobre esse histórico. A clínica precisa lembrar sozinha de reordenar.

**O que a IA faz:**  
Para cada par `(clinic_id, product_id)`, o sistema calcula:

1. **Ciclo médio de recompra** — quantos dias entre pedidos consecutivos do mesmo produto
2. **Janela de variância** — ±X dias de tolerância histórica
3. **Data prevista do próximo pedido**
4. **Confiança da previsão** (baixa confiança = poucos pedidos históricos)

Quando `data_prevista - hoje <= 5 dias`, dispara uma notificação push + email para o `CLINIC_ADMIN`:

> _"Atenção: você costuma pedir [Produto X] a cada 21 dias. O próximo pedido está previsto para [data]. Quer criar um pedido agora com base no seu template salvo?"_

Com o clique, a clínica acessa o `order_template` já pré-preenchido.

**Dado que permite isso:**  
`order_items (product_id, quantity, created_at)` + `orders (clinic_id, created_at)` + `order_templates`

**Impacto esperado:**

- Aumento de 15–30% no volume de pedidos recorrentes (benchmark de e-commerce B2B)
- Redução de quebras de estoque na clínica (benefício colateral de saúde pública)
- Clínicas que usam alertas têm LTV 2–3x maior (benchmark de SaaS B2B)

**Implementação:**  
Query SQL analítica + job Inngest rodando diariamente. Não requer LLM — algoritmo estatístico puro (média + desvio padrão dos intervalos entre pedidos).

```sql
WITH order_intervals AS (
  SELECT
    o.clinic_id,
    oi.product_id,
    o.created_at,
    LAG(o.created_at) OVER (
      PARTITION BY o.clinic_id, oi.product_id
      ORDER BY o.created_at
    ) AS prev_order_at
  FROM orders o JOIN order_items oi ON oi.order_id = o.id
  WHERE o.order_status = 'COMPLETED'
)
SELECT
  clinic_id, product_id,
  AVG(EXTRACT(EPOCH FROM (created_at - prev_order_at))/86400)::int AS avg_cycle_days,
  STDDEV(EXTRACT(EPOCH FROM (created_at - prev_order_at))/86400)::int AS stddev_days,
  MAX(created_at) AS last_order_at
FROM order_intervals
WHERE prev_order_at IS NOT NULL
GROUP BY clinic_id, product_id
HAVING COUNT(*) >= 2
```

**Custo:** Zero (SQL puro + Inngest já instalado)  
**Risco:** Muito baixo. Alerta errado é apenas ignorado. Nunca cria pedido automaticamente.

---

### 2.3 Detecção de Churn de Clínica

**Horizonte:** H1  
**Impacto:** ⭐⭐⭐⭐⭐  
**Complexidade:** ⭐⭐

**Situação atual:**  
Não há nenhum mecanismo que detecte quando uma clínica parou de comprar ou está reduzindo frequência. O consultor descobre tarde demais.

**O que a IA faz:**  
Calcula um **score de risco de churn** para cada clínica, rodando diariamente:

| Sinal                                               | Peso  | Lógica                                                     |
| --------------------------------------------------- | ----- | ---------------------------------------------------------- |
| Dias desde último pedido vs. ciclo médio da clínica | Alto  | 1.5x do ciclo médio = alarme amarelo; 2x = alarme vermelho |
| Frequência de pedidos caindo nos últimos 90 dias    | Alto  | Regressão linear sobre o histórico                         |
| Tickets de suporte sem resolução                    | Médio | Tickets `OPEN` > 7 dias são sinal de insatisfação          |
| Tentativas de pagamento falhas                      | Médio | Payments com status FAILED                                 |
| Redução de variedade de produtos                    | Baixo | Comprou 5 produtos distintos, agora só 2                   |

**Ações automáticas por score:**

- 🟡 Risco Moderado: Notificação ao consultor da clínica: _"Clínica X não faz pedido há 18 dias (ciclo médio: 14 dias)"_
- 🔴 Risco Alto: Notificação ao SUPER_ADMIN + consultor + sugestão automática de oferecer cupom de reativação

**Impacto esperado:**

- Redução de 30–50% no churn silencioso (clínicas que simplesmente param sem avisar)
- Intervenção proativa antes da perda definitiva

**Custo:** Zero (SQL puro)  
**Risco:** Baixo. Notificação excessiva pode irritar consultores — mitigar com limite de 1 alerta por semana por clínica.

---

### 2.4 Score de Qualificação de Leads Incompletos

**Horizonte:** H1  
**Impacto:** ⭐⭐⭐⭐  
**Complexidade:** ⭐⭐

**Situação atual:**  
A tabela `registration_drafts` (implementada em v5.2.0) captura clínicas que iniciaram o cadastro mas não enviaram documentos. O admin vê essa lista mas não tem como priorizar quais abordar primeiro.

**O que a IA faz:**  
Calcula um **lead score** para cada draft baseado em:

| Critério                                             | Score | Raciocínio                |
| ---------------------------------------------------- | ----- | ------------------------- |
| Preencheu todos os campos obrigatórios               | +30   | Alta intenção             |
| CNPJ válido e situação ATIVA na Receita              | +20   | Cliente real, não teste   |
| Cidade de grande mercado (SP, RJ, BH, POA, Curitiba) | +10   | Maior potencial de volume |
| Email corporativo (não gmail/hotmail)                | +10   | Empresa estabelecida      |
| Tentou cadastro 2x+                                  | +15   | Alta motivação            |
| Expirou rapidamente sem tentar novamente             | -10   | Baixa motivação           |
| Tipo de clínica = estética/dermatologia              | +5    | Alto consumo de magistral |

**Output:**  
Na tela de "Interesses Incompletos" do admin, cada draft aparece com score e badge (QUENTE 🔥 / MORNO ♨️ / FRIO 🧊), ordenados por score decrescente. Um botão "Entrar em contato" pré-preenche email com template personalizado.

**Custo:** Zero (regras + validação de CNPJ via ReceitaWS já existente em `lib/compliance.ts`)

---

### 2.5 Detecção de Anomalia em Pedidos e Pagamentos

**Horizonte:** H2  
**Impacto:** ⭐⭐⭐⭐⭐  
**Complexidade:** ⭐⭐⭐

**Situação atual:**  
Nenhum mecanismo detecta padrões suspeitos em pedidos ou pagamentos.

**O que a IA faz:**  
Modelo de detecção de anomalia (Isolation Forest ou DBSCAN — simples de implementar em Python/Edge Function) identifica:

1. **Pedido com valor 3σ acima da média histórica da clínica** → alerta SUPER_ADMIN antes de aprovar
2. **Mesma clínica cria N pedidos em menos de 1 hora** → possível erro ou fraude
3. **Pagamento confirmado mas valor diferente do pedido** → alerta de reconciliação
4. **Clínica usa PIX de CNPJ diferente do cadastrado** → risco de fraude
5. **Farmácia muda status diretamente de AWAITING_PAYMENT para COMPLETED** → bypass suspeito do fluxo

**Impacto esperado:**

- Proteção financeira direta
- Conformidade com eventual regulação BCB (Resolução 80/2021) à medida que o volume cresce

**Implementação:**  
Supabase Edge Function em Deno (JavaScript) ou job Inngest. Para os casos simples (desvio da média), puro SQL é suficiente. Para padrões mais complexos, chamada para uma Cloud Function Python com scikit-learn.

**Custo:** Baixo a médio. Supabase Edge Functions grátis até volume alto.

---

### 2.6 Recomendação de Produtos (Motor de Recomendação)

**Horizonte:** H2  
**Impacto:** ⭐⭐⭐⭐⭐  
**Complexidade:** ⭐⭐⭐

**Situação atual:**  
O catálogo é uma grade estática. A clínica precisa saber exatamente o que quer. Não há sugestão de "clínicas similares também compram" ou "você pode precisar também de".

**O que a IA faz:**  
Dois modelos independentes:

#### 2.6.1 Filtragem Colaborativa — "Clínicas como a sua também compram"

Baseado em `order_items`, identifica padrões de co-ocorrência de produtos entre clínicas com perfil similar (mesma especialidade médica inferida, mesma região, mesmo porte de pedidos).

```
Clínica X compra: [Produto A, Produto B, Produto C]
Clínica Y compra: [Produto A, Produto B, Produto D]
→ Recomendar Produto D para Clínica X
```

**Requisito de dados:** ~50 clínicas ativas com histórico de 3+ pedidos. Coldfstart resolvido por region/specialty.

#### 2.6.2 Recomendação Contextual — "Adicionar ao pedido"

Durante a criação de um pedido (`/orders/new`), enquanto a clínica adiciona itens, o sistema sugere produtos frequentemente combinados:

> _"Quem pede Produto A também costuma adicionar Produto B. Quer incluir?"_

Baseado em análise de `market basket` (algoritmo Apriori) sobre `order_items`.

**Impacto esperado:**

- Aumento de 10–25% no valor médio por pedido (ticket médio)
- Introdução de produtos novos ao mix de cada clínica

**Custo:** Processamento SQL + Inngest. Se volume crescer, mover para Vertex AI Recommendations (~$0.27/1000 events).

---

### 2.7 Busca Semântica no Catálogo de Produtos

**Horizonte:** H2  
**Impacto:** ⭐⭐⭐⭐  
**Complexidade:** ⭐⭐⭐

**Situação atual:**  
A busca no catálogo é por texto exato. Se o produto se chama "Metformina 500mg Cápsula" e o usuário digitar "medicamento para diabetes" ou "biguanida", não encontra nada.

**O que a IA faz:**  
**Busca vetorial semântica** usando embeddings de texto. Cada produto é representado como um vetor de alta dimensão que captura seu significado médico. A busca compara a query do usuário com esses vetores e retorna os mais similares semanticamente.

**Stack técnica:**

1. `pgvector` extension no Supabase (já disponível gratuitamente)
2. OpenAI `text-embedding-3-small` para gerar embeddings (custo ~$0.00002 por produto)
3. Nova coluna `embedding vector(1536)` na tabela `products`
4. Função SQL `cosine_similarity` para busca

```sql
-- Busca semântica
SELECT name, description, price_current
FROM products
ORDER BY embedding <-> $1  -- vetor da query do usuário
LIMIT 10;
```

**Exemplo prático:**

| Query do usuário                  | Produto encontrado                     |
| --------------------------------- | -------------------------------------- |
| "medicamento para diabetes"       | Metformina, Glibenclamida, Semaglutida |
| "hormônio feminino"               | Estradiol, Progesterona, Tibolona      |
| "manipulado para queda de cabelo" | Finasterida, Minoxidil                 |
| "vitamina para imunidade"         | Vitamina C, Zinco, Vitamina D          |

**Impacto esperado:**

- Redução drástica de "não encontrei o produto" → interesse expresso → perda de pedido
- Melhoria significativa de UX para usuários novos (médicos menos familiarizados com nomes técnicos)

**Custo:** pgvector grátis no Supabase. Embedding gerado uma vez por produto ao criar/editar (~$0.001 total por 1.000 produtos).

---

### 2.8 OCR Inteligente na Validação de Documentos de Cadastro

**Horizonte:** H2  
**Impacto:** ⭐⭐⭐⭐  
**Complexidade:** ⭐⭐⭐

**Situação atual:**  
Quando uma clínica envia documentos de cadastro (CNPJ, alvará, licença sanitária, etc.), um admin precisa abrir cada arquivo, ler manualmente, conferir se o CNPJ bate, se o alvará está válido, e aprovar ou rejeitar.

**O que a IA faz:**  
Na aprovação de cada documento, a IA (Vision API do GPT-4o ou Google Document AI):

1. **Extrai automaticamente:** razão social, CNPJ, data de validade do alvará, nome do responsável técnico
2. **Compara** os dados extraídos com o que a clínica preencheu no formulário — alerta se houver divergência
3. **Verifica validade:** se a data de vencimento do alvará é futura
4. **Classifica qualidade do documento:** nítido, ilegível, parcial
5. **Gera resumo para o admin:** "CNPJ bate ✅ | Razão social bate ✅ | Alvará válido até 12/2027 ✅ | Pronto para aprovação"

**Impacto esperado:**

- Redução de 70–80% no tempo de análise de cadastro
- Redução de erros humanos de conferência
- Aprovação mais rápida = melhor primeira impressão para a clínica

**Custo:** GPT-4o Vision ~$0.01–0.05 por documento. Com 100 cadastros/mês = R$3–15/mês.  
**Alternativa gratuita:** Google Document AI (90 pages/mês grátis).

---

### 2.9 Assistente de BI em Linguagem Natural (Text-to-SQL)

**Horizonte:** H3  
**Impacto:** ⭐⭐⭐⭐⭐  
**Complexidade:** ⭐⭐⭐⭐

**Situação atual:**  
A página `/reports` tem gráficos fixos muito bem construídos (receita, pedidos, status, farmácias, comissões, margem). Mas o Super Admin não consegue responder perguntas específicas sem saber SQL, como:

- "Quais clínicas do estado de SP reduziram pedidos este mês vs. o anterior?"
- "Qual farmácia teve o maior atraso médio de entrega no 1º trimestre?"
- "Quais médicos prescreveram Produto X mais de 3 vezes?"

**O que a IA faz:**  
Um campo de pesquisa em linguagem natural na página de relatórios. O admin digita a pergunta em português. A IA:

1. Converte para SQL (usando o schema do banco como contexto)
2. Executa a query com controles de segurança (somente SELECT, sem acesso a tabelas sensíveis)
3. Formata o resultado como tabela ou gráfico
4. Explica em linguagem natural o que encontrou

**Exemplo:**

```
Admin digita: "quais clínicas não fizeram pedidos nos últimos 60 dias mas fizeram
antes disso?"

IA gera:
SELECT c.trade_name, c.city, c.state, MAX(o.created_at) as ultimo_pedido
FROM clinics c
JOIN orders o ON o.clinic_id = c.id
GROUP BY c.id
HAVING MAX(o.created_at) < NOW() - INTERVAL '60 days'
  AND MAX(o.created_at) > NOW() - INTERVAL '180 days'
ORDER BY ultimo_pedido DESC;

Resultado: "14 clínicas. As 3 mais antigas sem pedido são:
Clínica Bem Estar (SP, 89 dias), Dermato Plus (RJ, 75 dias), ..."
```

**Implementação:**  
LLM com function calling + schema do banco como system prompt. Camada de segurança que bloqueia queries não-SELECT e adiciona filtros de RLS.

**Custo:** ~$0.01–0.05 por query. Com 50 queries/dia por admins = R$30–150/mês.

---

### 2.10 Sugestão Inteligente de Preço de Produto

**Horizonte:** H3  
**Impacto:** ⭐⭐⭐⭐  
**Complexidade:** ⭐⭐⭐⭐

**Situação atual:**  
Preços são definidos manualmente pelo admin. Não há análise de elasticidade, comparação de mercado ou otimização de margem.

**O que a IA faz:**  
Ao atualizar o preço de um produto, o admin vê um painel de IA ao lado:

1. **Análise de elasticidade histórica:** "quando o preço deste produto subiu 10% em Jan/2026, os pedidos caíram 12% nas 2 semanas seguintes"
2. **Comparação de volume por faixa de preço:** curva de demanda histórica
3. **Sugestão de preço ótimo:** ponto que maximiza receita total (preço × quantidade)
4. **Análise de impacto nos coupons ativos:** "2 clínicas têm cupom ativo para este produto — a alteração de preço impactará o valor absoluto do desconto"

**Dado que permite isso:**  
`product_price_history` + `order_items` por período + `coupons`

**Custo:** Análise estatística pura (sem LLM) — zero custo adicional.

---

### 2.11 Insights Automáticos no Dashboard (Narrativa de Dados)

**Horizonte:** H3  
**Impacto:** ⭐⭐⭐⭐  
**Complexidade:** ⭐⭐⭐

**Situação atual:**  
O dashboard admin mostra métricas (pedidos hoje, receita, etc.) mas são números mudos — o admin precisa interpretar sozinho.

**O que a IA faz:**  
Diariamente, um job gera 3–5 "insights do dia" em linguagem natural para o SUPER_ADMIN, exibidos no topo do dashboard:

> 💡 **Atenção:** A clínica "Dermato Center SP" não faz pedidos há 28 dias. Ciclo médio histórico: 14 dias. Consultora responsável: Maria Silva.

> 📈 **Destaque:** Produto "Semaglutida 1mg" teve aumento de 40% nos pedidos esta semana vs. semana anterior. Pode indicar escassez de original no mercado.

> ⚠️ **Alerta:** Farmácia "Pharma Norte" tem 7 pedidos em status "IN_EXECUTION" por mais de 5 dias. SLA crítico.

> 💰 **Oportunidade:** 12 clínicas fizeram pedidos acima de R$5.000 este mês pela primeira vez. Potencial para up-sell de produtos premium.

**Custo:** LLM call 1x/dia com ~3.000 tokens = ~$0.005/dia = R$9/mês.

---

### 2.12 Análise de Sentimento em Suporte (Prioridade Emocional)

**Horizonte:** H2  
**Impacto:** ⭐⭐⭐  
**Complexidade:** ⭐⭐

**Situação atual:**  
Tickets têm prioridade técnica (LOW/NORMAL/HIGH/URGENT) mas não capturam o estado emocional do cliente. Uma mensagem como "Vocês destruíram minha clínica, isso é um absurdo!!!" pode estar classificada como NORMAL.

**O que a IA faz:**  
Análise de sentimento em cada nova mensagem de ticket:

- **Muito negativo + palavras de churn** ("vou cancelar", "nunca mais", "absurdo", "judicializar"): eleva automaticamente para URGENT + notifica o admin
- **Neutro/técnico:** mantém classificação atual
- **Positivo:** registra para relatório de NPS implícito

**Custo:** ~$0.001 por mensagem. Com 100 tickets/dia com 5 mensagens médias = R$3/mês.

---

### 2.13 Coach de Performance para Consultores

**Horizonte:** H3  
**Impacto:** ⭐⭐⭐⭐  
**Complexidade:** ⭐⭐⭐

**Situação atual:**  
Consultores veem sua lista de comissões mas não recebem nenhuma orientação sobre o que fazer para melhorar sua carteira.

**O que a IA faz:**  
No dashboard do consultor, uma seção "Minha Carteira — Análise IA" mostra:

1. **Clínicas em risco de churn** na carteira do consultor (com score)
2. **Oportunidades de up-sell** — clínicas que só compram 1–2 produtos mas perfil sugere potencial maior
3. **Comparação anônima com outros consultores** — "você está 23% abaixo da média do grupo em reativação de clínicas inativas"
4. **Ação recomendada por clínica:** "Ligue para Clínica X — 18 dias sem pedido, cliente de 2 anos, bom pagador"

**Impacto esperado:**

- Aumento de produtividade da força de vendas sem contratar mais consultores
- Redução do churn nas carteiras com menor performance

---

### 2.14 Verificação de Identidade Médica (CRM Validation via IA)

**Horizonte:** H2  
**Impacto:** ⭐⭐⭐⭐  
**Complexidade:** ⭐⭐⭐

**Situação atual:**  
Médicos são cadastrados com CRM + estado, mas não há validação automatizada contra o CFM (Conselho Federal de Medicina). A validação é manual.

**O que a IA faz:**

1. Web scraping responsável do site público do CFM (ou API não-oficial documentada pela comunidade)
2. Valida que o CRM existe, está ativo, e o nome bate com o cadastrado
3. Armazena `crm_validated_at` + `crm_situation` (espelhando o padrão já existente para CNPJ em `pharmacies`)
4. Cron semanal revalida todos os CRMs ativos

**Impacto esperado:**

- Conformidade regulatória (RDC ANVISA)
- Redução de médicos fictícios ou com registro suspenso associados a clínicas

**Implementação:**  
Extensão natural de `lib/compliance.ts` que já faz validação de CNPJ.

---

### 2.15 Geração Automática de Contrato Personalizado

**Horizonte:** H3  
**Impacto:** ⭐⭐⭐⭐  
**Complexidade:** ⭐⭐⭐

**Situação atual:**  
Contratos com clínicas, farmácias e consultores são gerados e enviados via Clicksign. O processo é manual — um admin precisa criar o documento, configurar os signatários, e enviar.

**O que a IA faz:**

1. A IA preenche o template do contrato com os dados cadastrais da entidade (razão social, CNPJ, endereço, responsável)
2. Personaliza cláusulas com base no tipo de contrato e termos específicos (ex: comissão do consultor)
3. Envia automaticamente para assinatura via Clicksign logo após aprovação do cadastro
4. Resume o contrato em linguagem simples para o signatário: "Este contrato estabelece que você receberá X% de comissão sobre pedidos das clínicas Y e Z"

**Impacto esperado:**

- Eliminação de 95% do trabalho manual de contratos
- Onboarding de novas entidades em minutos, não dias

---

## 3. Matriz de Priorização

| #   | Aplicação                         | Impacto Negócio | Complexidade | Custo       | Dados Disponíveis | Horizonte | Prioridade |
| --- | --------------------------------- | --------------- | ------------ | ----------- | ----------------- | --------- | ---------- |
| 1   | Alerta preditivo de recompra      | ⭐⭐⭐⭐⭐      | Baixa        | Zero        | ✅ Sim            | H1        | 🔴 ALTA    |
| 2   | Detecção de churn                 | ⭐⭐⭐⭐⭐      | Baixa        | Zero        | ✅ Sim            | H1        | 🔴 ALTA    |
| 3   | Triagem inteligente de tickets    | ⭐⭐⭐⭐⭐      | Baixa        | < R$10/mês  | ✅ Sim            | H1        | 🔴 ALTA    |
| 4   | Score de leads incompletos        | ⭐⭐⭐⭐        | Baixa        | Zero        | ✅ Sim            | H1        | 🔴 ALTA    |
| 5   | Insights automáticos no dashboard | ⭐⭐⭐⭐        | Média        | < R$15/mês  | ✅ Sim            | H2/H3     | 🟡 MÉDIA   |
| 6   | Busca semântica no catálogo       | ⭐⭐⭐⭐        | Média        | < R$5/mês   | ✅ Sim            | H2        | 🟡 MÉDIA   |
| 7   | Recomendação de produtos          | ⭐⭐⭐⭐⭐      | Média        | Zero        | ⚠️ Precisa volume | H2        | 🟡 MÉDIA   |
| 8   | OCR de documentos no cadastro     | ⭐⭐⭐⭐        | Média        | < R$20/mês  | ✅ Sim            | H2        | 🟡 MÉDIA   |
| 9   | Análise de sentimento em suporte  | ⭐⭐⭐          | Baixa        | < R$5/mês   | ✅ Sim            | H2        | 🟡 MÉDIA   |
| 10  | Validação CRM médico              | ⭐⭐⭐⭐        | Média        | Zero        | ✅ Sim            | H2        | 🟡 MÉDIA   |
| 11  | Detecção de anomalia/fraude       | ⭐⭐⭐⭐⭐      | Alta         | Baixo       | ⚠️ Precisa volume | H2        | 🟡 MÉDIA   |
| 12  | Coach de performance (consultor)  | ⭐⭐⭐⭐        | Alta         | Baixo       | ⚠️ Precisa volume | H3        | 🟢 BAIXA   |
| 13  | BI em linguagem natural           | ⭐⭐⭐⭐⭐      | Alta         | < R$150/mês | ✅ Sim            | H3        | 🟢 BAIXA   |
| 14  | Otimização de preço               | ⭐⭐⭐⭐        | Alta         | Zero        | ⚠️ Precisa volume | H3        | 🟢 BAIXA   |
| 15  | Geração de contrato automático    | ⭐⭐⭐⭐        | Alta         | Médio       | ✅ Sim            | H3        | 🟢 BAIXA   |

---

## 4. Plano de Implementação por Horizonte

### H1 — Implementar agora (sem custo ou custo mínimo, sem dependência de volume)

```
Semana 1–2: Score de leads incompletos
  → Regras + ReceitaWS (já integrado)
  → UI na tela /registrations

Semana 2–3: Detecção de churn
  → Job Inngest diário (SQL puro)
  → Notificação push para consultores e admin

Semana 3–4: Alerta preditivo de recompra
  → Job Inngest diário (SQL analítico)
  → Notificação push + link para order_template

Semana 4: Triagem inteligente de tickets
  → Hook no POST /api/support
  → OpenAI API (gpt-4o-mini) → classificação automática
```

**Custo total H1: < R$50/mês quando escalar**

### H2 — Após atingir 30+ clínicas ativas (1–3 meses)

```
Mês 1: Busca semântica (pgvector já disponível no Supabase)
Mês 1: OCR de documentos no cadastro
Mês 2: Análise de sentimento em suporte
Mês 2: Validação automática de CRM médico
Mês 3: Recomendação de produtos (com dados suficientes)
```

### H3 — Após atingir 100+ clínicas (3–6 meses)

```
Mês 3–4: Detecção de anomalia em pedidos (dados suficientes para baseline)
Mês 4–5: BI em linguagem natural
Mês 5–6: Coach de performance para consultores
Mês 6: Otimização de preço (elasticidade)
```

### H4 — Visão de futuro (6–12 meses)

```
IA generativa integrada: assistente contextual por perfil de usuário
  → Clinic Admin: "Como faço para rastrear meu pedido?"
  → Pharmacy Admin: "Quais pedidos devo priorizar hoje?"
  → Super Admin: interface conversacional com o ERP

Integração com sistemas de prontuário eletrônico (RNDS/FHIR):
  → Médico valida prescrição diretamente na plataforma
  → IA sugere produto baseado no CID da prescrição

Precificação dinâmica em tempo real:
  → Preço varia com estoque da farmácia, demanda e perfil da clínica
```

---

## 5. Requisitos Técnicos e Arquitetura

### 5.1 O que já existe e serve de base

| Componente                | Status                 | Uso em IA                                     |
| ------------------------- | ---------------------- | --------------------------------------------- |
| Inngest (background jobs) | ✅ Instalado           | Jobs diários de previsão, churn, insights     |
| Upstash Redis             | ✅ Ativo               | Cache de embeddings, rate-limit de queries IA |
| Sentry                    | ✅ Ativo               | Monitorar erros de modelos IA                 |
| `lib/notifications.ts`    | ✅ Implementado        | Disparar alertas preditivos                   |
| `lib/compliance.ts`       | ✅ Implementado        | Extensível para validação CRM                 |
| Supabase pgvector         | ✅ Disponível (grátis) | Busca semântica                               |
| `lib/logger.ts`           | ✅ Implementado        | Auditar decisões de IA                        |

### 5.2 O que precisará ser adicionado

| Componente                       | Para que serve                                       | Custo                               |
| -------------------------------- | ---------------------------------------------------- | ----------------------------------- |
| OpenAI API key                   | Tickets, OCR, insights, embeddings                   | Pay-per-use (~R$30–200/mês no pico) |
| `lib/ai.ts`                      | Client único para OpenAI (circuit breaker integrado) | Zero                                |
| `ai` npm package (Vercel AI SDK) | Streaming de respostas, tool calling padronizado     | Zero                                |
| Coluna `embedding` em `products` | Busca semântica                                      | Zero (Supabase)                     |
| Tabela `ai_predictions`          | Auditar e armazenar previsões de churn/recompra      | Zero                                |

### 5.3 Princípios de design para IA na plataforma

1. **IA como copiloto, não piloto:** Nenhuma decisão crítica (aprovar cadastro, cancelar pedido, cobrar cliente) é tomada automaticamente pela IA. Sempre como sugestão + ação humana.

2. **Explicabilidade:** Cada sugestão de IA deve vir com justificativa em linguagem natural. Ex: "Score de churn 82% — motivo: 28 dias sem pedido (ciclo médio: 14 dias) + 1 ticket não resolvido"

3. **Fallback gracioso:** Se a IA falhar (API fora, timeout), o sistema funciona normalmente sem a sugestão. Circuit breaker já implementado.

4. **Auditoria:** Toda decisão de IA registrada em `audit_logs` para rastreabilidade e LGPD.

5. **LGPD:** Dados enviados para APIs externas (OpenAI) devem ser anonimizados onde possível (IDs em vez de nomes, dados agregados em vez de individuais).

---

## 6. Análise de Custo Total

### Cenário 1: 30 clínicas ativas (Go-live)

| Serviço                     | Uso estimado                         | Custo/mês               |
| --------------------------- | ------------------------------------ | ----------------------- |
| OpenAI (tickets + insights) | 500 classificações + 30 insights/dia | ~R$25                   |
| OpenAI (embeddings)         | 200 produtos (geração única)         | ~R$0.50 (único)         |
| Inngest jobs IA             | 4 jobs diários                       | Incluído no plano atual |
| **Total H1**                |                                      | **~R$25/mês**           |

### Cenário 2: 200 clínicas ativas

| Serviço                           | Custo/mês      |
| --------------------------------- | -------------- |
| OpenAI (tickets + OCR + insights) | ~R$120         |
| Busca semântica (queries)         | ~R$20          |
| Recomendações (Inngest)           | Incluído       |
| **Total H2**                      | **~R$140/mês** |

### Cenário 3: 1.000 clínicas ativas

| Serviço                    | Custo/mês      |
| -------------------------- | -------------- |
| OpenAI (todas as features) | ~R$500         |
| BI em linguagem natural    | ~R$150         |
| Detecção de anomalia       | ~R$50          |
| **Total H3**               | **~R$700/mês** |

**Comparação:** R$700/mês para 1.000 clínicas = R$0,70/clínica/mês. Se a IA aumentar o ticket médio em apenas 5%, o ROI é de dezenas de vezes o custo.

---

## 7. Riscos e Mitigações

| Risco                                                         | Probabilidade          | Impacto | Mitigação                                                       |
| ------------------------------------------------------------- | ---------------------- | ------- | --------------------------------------------------------------- |
| Alucinação do LLM em ticket crítico                           | Média                  | Alto    | IA classifica, humano sempre revisa antes de agir               |
| LGPD: dados de saúde enviados para OpenAI                     | Alta (se não mitigado) | Crítico | Anonimizar antes de enviar; usar apenas IDs e categorias        |
| Falso positivo de churn (cliente ativo classificado em risco) | Alta                   | Baixo   | Alerta é apenas informativo; consultor verifica                 |
| Dependência de fornecedor único (OpenAI)                      | Média                  | Alto    | Circuit breaker já implementado; Anthropic como fallback        |
| Custo escalando sem controle                                  | Baixa                  | Médio   | Limites por API key + alertas de custo                          |
| Viés no modelo de recomendação                                | Baixa                  | Médio   | Monitorar diversidade de sugestões; fallback para mais vendidos |

---

## 8. Conclusão e Recomendação

A plataforma Clinipharma tem **perfil ideal para IA** pelos seguintes motivos:

1. **Dados ricos e estruturados** — pedidos, produtos, clínicas, médicos, histórico financeiro — tudo bem modelado e disponível
2. **Usuários profissionais** — que valorizam eficiência e informação de qualidade, não se importam com complexidade adicional se ela traz valor
3. **Modelo B2B de recorrência** — o valor da IA aumenta com o tempo (quanto mais dados, melhores as previsões)
4. **Infraestrutura já preparada** — Inngest, Redis, pgvector, circuit breaker, logger estruturado — tudo no lugar certo

### Recomendação de primeiro passo

**Implementar as 4 aplicações H1 em ordem de impacto:**

```
1. Score de leads incompletos  → 1 semana, zero custo, melhora conversão imediata
2. Detecção de churn           → 1 semana, zero custo, protege receita recorrente
3. Alerta de recompra          → 1 semana, zero custo, aumenta volume de pedidos
4. Triagem de tickets (IA)     → 1 semana, < R$25/mês, libera tempo operacional
```

Essas 4 aplicações juntas podem ser implementadas em 3–4 semanas, têm custo próximo de zero na fase inicial, e endereçam os 3 maiores problemas de um B2B em crescimento: **retenção, expansão e eficiência operacional**.

---

_Documento gerado em 2026-04-12 | Clinipharma v5.3.2_  
_Revisar a cada trimestre conforme dados e volume de clínicas crescerem._
