# Usuários Seed — Clinipharma

Usuários criados pelo script `scripts/setup-production.ts` via Supabase Admin API.

> Esses usuários existem tanto no ambiente de desenvolvimento quanto no Supabase de produção (`jomdntqlgrupvhrqoyai`), pois o script foi executado em produção.

---

## Credenciais

| Email                           | Senha               | Papel          | Organização               |
| ------------------------------- | ------------------- | -------------- | ------------------------- |
| `superadmin@clinipharma.com.br` | `Clinipharma@2026!` | SUPER_ADMIN    | Plataforma (acesso total) |
| `admin@clinipharma.com.br`      | `Clinipharma@2026!` | PLATFORM_ADMIN | Operação diária           |
| `admin@clinicasaude.com.br`     | `Clinipharma@2026!` | CLINIC_ADMIN   | Clínica Saúde Total       |
| `dr.silva@clinipharma.com.br`   | `Clinipharma@2026!` | DOCTOR         | Clínica Saúde Total       |
| `admin@farmaciaforte.com.br`    | `Clinipharma@2026!` | PHARMACY_ADMIN | Farmácia Forte            |

---

## Dados seed (banco)

Inseridos via `supabase/seed.sql` (executado com `supabase db push --include-seed`):

**Categorias:**

- Hormônios e TRH
- Dermatologia
- Emagrecimento
- Suplementação
- Ginecologia

**Farmácias:**

- Farmácia Forte — CNPJ 11.222.333/0001-44
- Farmácia Verde — CNPJ 22.333.444/0001-55

**Clínicas:**

- Clínica Saúde Total — CNPJ 33.444.555/0001-66
- Clínica Vida Plena — CNPJ 44.555.666/0001-77

**Médicos:**

- Dr. Carlos Silva — CRM SP 12345
- Dra. Ana Santos — CRM RJ 67890

**Produtos (5 produtos ativos):**

- Testosterona Gel 50mg — R$ 285,00
- Progesterona Creme 100mg — R$ 195,00
- Semaglutida 1mg/ml — R$ 890,00
- Ácido Retinoico 0.05% — R$ 145,00
- DHEA 25mg — R$ 165,00

---

## Fluxo de criação de pedidos

Ao acessar `/orders/new`:

- **`CLINIC_ADMIN` / `STAFF`** — a clínica é detectada automaticamente via `clinic_members`; nenhum dropdown é exibido.
- **`DOCTOR`** — se vinculado a uma clínica, auto-selecionada; se a múltiplas, exibe dropdown apenas das suas clínicas.
- **`SUPER_ADMIN` / `PLATFORM_ADMIN`** — dropdown com todas as clínicas ativas.

**Campo "Médico solicitante":**

| Clínica tem médicos vinculados? | Carrinho tem produto com `requires_prescription`? | Comportamento |
| ------------------------------- | ------------------------------------------------- | ------------- |
| Não                             | Qualquer                                          | Campo oculto  |
| Sim                             | Não                                               | Opcional      |
| Sim                             | Sim                                               | Obrigatório   |

A coluna `orders.doctor_id` é nullable desde a migration 032.

---

## Para criar novos usuários

Use a página de gestão de usuários em `/users/new` (requer `SUPER_ADMIN` ou `PLATFORM_ADMIN`).

---

> ⚠️ Altere as senhas dos usuários de produção antes de compartilhar acesso com clientes reais.
