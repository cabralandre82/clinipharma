# Fluxo de Precificação de Produtos

> Atualizado em: 2026-04-13 — v6.5.23

---

## Visão geral da ownership de preços

| Quem       | Campo           | Significado                               |
| ---------- | --------------- | ----------------------------------------- |
| Farmácia   | `pharmacy_cost` | Valor que a plataforma repassa à farmácia |
| Plataforma | `price_current` | Valor que a clínica paga à plataforma     |

A farmácia **nunca vê** `price_current`. A margem/lucro da plataforma é exclusiva para SUPER_ADMIN e PLATFORM_ADMIN.

---

## 1. Farmácia cria um produto

1. Farmácia acessa **Produtos → Novo produto**
2. Preenche os dados e define o **Repasse** (`pharmacy_cost`) — o valor que quer receber
3. Ao salvar:
   - `price_current` é forçado para `0` (produto não vai ao catálogo)
   - `active = false` (produto inativo até o admin precificar)
   - Notificação `PRODUCT_AWAITING_PRICE` enviada para SUPER_ADMIN e PLATFORM_ADMIN

### Como o admin descobre o produto novo

- **Sino de notificações** — badge com alerta imediato
- **Dashboard → card "Aguardando preço"** — contador âmbar com ponto vermelho enquanto houver produtos sem preço

---

## 2. Admin define o preço ao cliente

1. Clique na notificação **ou** no card "Aguardando preço" → vai para `/products`
2. Localize o produto (aparece no topo da lista com badge `⏳ Aguardando preço`)
3. Abra o detalhe — banner âmbar aparece com botão **"Definir preço"** em destaque
4. Preencha:
   - Novo preço (`price_current`)
   - Motivo (obrigatório)
5. Salvar → produto pode ser ativado para venda

### O que acontece ao salvar

- `products.price_current` atualizado
- `products.needs_price_review = false` (card "Revisar preço" decrementado)
- Registro em `product_price_history`
- Registro em `audit_logs`
- `revalidateTag('dashboard')` — cards do dashboard atualizam

---

## 3. Farmácia atualiza o repasse

Quando a farmácia altera o `pharmacy_cost` de um produto já precificado, o sistema aplica 3 camadas de resposta automática:

| Situação                        | Ação automática                        | Notificação para admin                                                |
| ------------------------------- | -------------------------------------- | --------------------------------------------------------------------- |
| `price_current = 0`             | Nenhuma                                | Nenhuma (produto já inativo)                                          |
| Margem > 15%                    | Produto permanece ativo                | 🟡 "Repasse atualizado, margem parece OK — revise o preço ao cliente" |
| Margem ≤ 15%                    | Produto permanece ativo                | 🟠 "Margem crítica — revise o preço com urgência"                     |
| `pharmacy_cost ≥ price_current` | **Produto desativado automaticamente** | 🔴 "Produto desativado — repasse excede preço ao cliente"             |

Em todos os casos com `price_current > 0`:

- `needs_price_review = true` → card **"Revisar preço"** no dashboard fica laranja com alerta
- Notificação `PRODUCT_COST_UPDATED` (não silenciável) enviada para SUPER_ADMIN e PLATFORM_ADMIN

### Como o admin revisa após alteração de repasse

1. **Sino de notificações** — badge atualiza em tempo real (Realtime via migration 035)
2. **Dashboard → card "Revisar preço"** — contador laranja com ponto vermelho
3. Abra o produto → atualize `price_current` se necessário
4. Ao salvar o novo preço: `needs_price_review` volta para `false`, card some do alerta

---

## 4. Regras de negócio importantes

- Pedidos já existentes **não são afetados** por mudanças de preço (preço congelado no momento do pedido)
- Produto com `pharmacy_cost ≥ price_current` é desativado automaticamente — reative apenas após corrigir os preços
- O admin vê a **análise de margem** completa (% margem bruta, comissão consultor, lucro líquido) — a farmácia nunca vê esses dados
