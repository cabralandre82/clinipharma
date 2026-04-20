# RLS Matrix — Tenant Isolation Ground Truth

**Uso:** mapa canônico de quais tabelas em `public` têm Row-Level Security habilitado, qual é o modelo de acesso de cada uma, e qual é o escopo esperado para cada papel (role). Usado pelo skill [`rls-violation-triage`](../../.cursor/skills/rls-violation-triage/SKILL.md) durante um alerta do RLS canary, e como checklist obrigatório para toda nova migration que cria tabela.

**Fonte da verdade:** este arquivo deve ser atualizado **no mesmo PR** que adiciona/altera uma tabela. O verifier `check-invariants` (Wave 16.2) garante que toda nova tabela tenha RLS habilitado via event trigger, mas **não** garante que a matriz aqui esteja atualizada — é compromisso humano + code review.

**Auto-enable:** a migration `supabase/migrations/057_rls_auto_enable_safety_net.sql` instala um event trigger que executa `ENABLE ROW LEVEL SECURITY` automaticamente após todo `CREATE TABLE public.X`. Isso é a salvaguarda de último recurso: se um desenvolvedor esquecer o `ALTER TABLE ... ENABLE`, o DB corrige silenciosamente. **Não** conta como substituto para policies explícitas.

---

## Legenda de papéis (roles)

| Papel (role)       | Descrição                                  |
| ------------------ | ------------------------------------------ |
| `anon`             | Usuário não autenticado (JWT ausente).     |
| `authenticated`    | Qualquer usuário autenticado (JWT válido). |
| `PHARMACY`         | Usuário de farmácia (vendor).              |
| `CLINIC`           | Usuário de clínica (buyer).                |
| `SALES_CONSULTANT` | Consultor de vendas.                       |
| `PLATFORM_ADMIN`   | Admin da plataforma.                       |
| `SUPER_ADMIN`      | Super-admin (DPO-level).                   |
| `service_role`     | Supabase service role (bypassa RLS).       |

## Legenda de modelos de acesso

- **`tenant-scoped`** — linha pertence a uma organização (`pharmacy_id` ou `clinic_id`); cada titular vê apenas as suas.
- **`user-scoped`** — linha pertence a um usuário individual (`user_id`); o titular vê apenas as suas.
- **`shared-read`** — catalogo global legível por todos os autenticados (às vezes por `anon`); escrita restrita a admin.
- **`append-only`** — inserção restrita a RPC `SECURITY DEFINER`; leitura restrita a admin.
- **`admin-only`** — leitura e escrita via `PLATFORM_ADMIN`/`SUPER_ADMIN` ou `service_role`.
- **`deny-all`** — RLS habilitado, zero policies → deny-all por default. Acesso apenas via `service_role`.

---

## Como verificar a matriz em runtime

```sql
-- 1. Tabelas em public com RLS habilitado
select tablename, rowsecurity
  from pg_tables
 where schemaname = 'public'
 order by tablename;

-- 2. Policies ativas por tabela
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public'
 order by tablename, policyname;

-- 3. Tabelas com RLS habilitado mas SEM policies (deny-all por default)
select t.tablename
  from pg_tables t
 where t.schemaname = 'public'
   and t.rowsecurity = true
   and not exists (
     select 1 from pg_policies p
      where p.schemaname = t.schemaname
        and p.tablename = t.tablename
   );
```

A saída desta última query pode ser esperada (tabelas `append-only` e `admin-only` propositalmente sem policy além da rota via RPC) ou suspeita (tabela tenant-scoped sem policy = vazou porque deny-all só bloqueia chamadas autenticadas sem service_role).

---

## Matriz principal (por categoria)

### 1. Tabelas tenant-scoped (farmácia / clínica)

| Tabela                  | Escopo | PHARMACY lê | PHARMACY escreve | CLINIC lê | CLINIC escreve | Observação                                     |
| ----------------------- | ------ | :---------: | :--------------: | :-------: | :------------: | ---------------------------------------------- |
| `orders`                | tenant |   própria   |     própria      |  própria  |    própria     | Duas visões via `pharmacy_id` e `clinic_id`.   |
| `order_items`           | tenant |  via order  |    via order     | via order |   via order    | Policy herda de `orders`.                      |
| `products`              | tenant |  próprios   |     próprios     | catálogo  |       ✗        | PHARMACY define catálogo; CLINIC vê oferta.    |
| `product_pharmacy_cost` | tenant |  próprios   |     próprios     |     ✗     |       ✗        | Custo só visível para a farmácia que publicou. |
| `pharmacy_cost_history` | tenant |  próprios   |   append-only    |     ✗     |       ✗        | Audit interno da farmácia.                     |
| `prescriptions`         | tenant |  via order  |        ✗         | próprias  |    próprias    | Dados de saúde — policy extra-restrita.        |
| `support_tickets`       | tenant |  próprios   |     próprios     | próprios  |    próprios    | Cada lado vê seus próprios tickets.            |

### 2. Tabelas user-scoped

| Tabela                     | Escopo | user lê | user escreve | Observação                                   |
| -------------------------- | ------ | :-----: | :----------: | -------------------------------------------- |
| `notifications`            | user   | própria | ack/dismiss  | Push + e-mail + in-app.                      |
| `notification_preferences` | user   | própria |   própria    | Cada usuário configura suas preferências.    |
| `push_subscriptions`       | user   | própria |   própria    | Token do navegador; rotacionado por browser. |
| `tracking_sessions`        | user   | própria | append-only  | Auditoria de navegação do usuário.           |
| `user_roles`               | user   | próprio |      ✗       | Escrita só via admin/service_role.           |

### 3. Tabelas shared-read (catálogo/configuração global)

| Tabela             | anon lê | authenticated lê | Escrita                      |
| ------------------ | :-----: | :--------------: | ---------------------------- |
| `feature_flags`    |    ✗    |        ✓         | `SUPER_ADMIN` via migration. |
| `settings_sla`     |    ✗    |        ✓         | `SUPER_ADMIN`.               |
| `categories`       |    ✗    |        ✓         | `PLATFORM_ADMIN`.            |
| `product_variants` |    ✗    |        ✓         | `PLATFORM_ADMIN`.            |

### 4. Tabelas append-only (audit / ledger)

| Tabela                    | Leitura                           | Escrita                                    | Observação                            |
| ------------------------- | --------------------------------- | ------------------------------------------ | ------------------------------------- |
| `audit_logs`              | `SUPER_ADMIN` + `service_role`    | `SECURITY DEFINER` RPCs                    | Append-only com hash chain (Wave 11). |
| `audit_chain_checkpoints` | `SUPER_ADMIN`                     | `verify-audit-chain` cron                  |                                       |
| `cron_runs`               | `SUPER_ADMIN`                     | Runner do cron                             |                                       |
| `rate_limit_violations`   | `SUPER_ADMIN`                     | RPC `rate_limit_record` (SECURITY DEFINER) | IP SHA-256 hasheado.                  |
| `webhook_events`          | `SUPER_ADMIN`                     | Handler de webhook                         |                                       |
| `legal_holds`             | `SUPER_ADMIN` (= DPO-level)       | RPC `apply_legal_hold` (SECURITY DEFINER)  |                                       |
| `dsar_requests`           | Titular (própria) + `SUPER_ADMIN` | RPC `dsar_open`                            | DSAR = Data Subject Access Request.   |
| `backup_runs`             | `SUPER_ADMIN` + `service_role`    | Endpoint `/api/backups/record`             | Ledger de backups com hash chain.     |
| `secret_rotation_record`  | `SUPER_ADMIN`                     | RPC `secret_rotation_record`               | Hash chain (sha256).                  |
| `server_logs`             | `SUPER_ADMIN`                     | `logger.*`                                 |                                       |

### 5. Tabelas admin-only

| Tabela                 | Regra                                                |
| ---------------------- | ---------------------------------------------------- |
| `consultant_transfers` | `SALES_CONSULTANT` (próprios) + `SUPER_ADMIN`        |
| `commissions`          | `SALES_CONSULTANT` (próprios) + `SUPER_ADMIN`        |
| `coupons`              | `PLATFORM_ADMIN` + `SUPER_ADMIN`                     |
| `distributors`         | `PLATFORM_ADMIN` + `SUPER_ADMIN`                     |
| `doctor_addresses`     | Owner-only (médico dono do endereço) + `SUPER_ADMIN` |

### 6. Tabelas com tratamento especial (dados de saúde / sensíveis — LGPD Art. 5º, II)

Essas tabelas têm **restrição adicional** e **qualquer expansão de acesso** deve passar por revisão do DPO:

- `prescriptions` — dados de saúde.
- `doctor_addresses` — endereços de profissionais (quase-identificáveis).
- `dsar_requests` — contém pedido do titular; tratamento sensível.
- `audit_logs` quando contém payload com dado de saúde (hash em vez de plaintext quando possível).

---

## Processo — PR que adiciona ou altera tabela

1. **Migration** cria a tabela.
2. **Event trigger** habilita RLS automaticamente (Wave 16.2). Mas **você ainda deve** adicionar `ENABLE ROW LEVEL SECURITY` explícito + as policies.
3. **Adicionar linha** na seção correspondente desta matriz.
4. **Adicionar teste de policy** em `tests/unit/rbac-extended.test.ts` ou correspondente.
5. **RLS canary** (`rls-canary` cron, Wave 14) vai tentar acessar a tabela como usuário não afiliado; se passar, alerta P0.
6. **Schema drift** (CI) compara o dump com as migrations → alerta se alguém mexeu direto no dashboard.

## Anti-patterns

- **Nunca** pular passos 3 e 4 em PR de migration. O event trigger salva o RLS enabled, mas deixar uma tabela tenant-scoped com deny-all policies é um incidente funcional esperando para acontecer.
- **Nunca** desabilitar RLS temporariamente "só para testar" — faça em migration local com rollback imediato. Desabilitar em prod é P0 regulatório.
- **Nunca** usar `service_role` do frontend. Service role bypassa RLS; toda interação com dados do usuário deve ser via `lib/db/server.ts` (cliente SSR com sessão).

---

## Referências

- Skill: [`rls-violation-triage`](../../.cursor/skills/rls-violation-triage/SKILL.md).
- Runbook: [`docs/runbooks/rls-violation.md`](../runbooks/rls-violation.md).
- Rule: [`.cursor/rules/database.mdc`](../../.cursor/rules/database.mdc).
- Invariant: `check-invariants.sh` (Wave 16.2 — RLS event trigger).
- Migration: [`supabase/migrations/057_rls_auto_enable_safety_net.sql`](../../supabase/migrations/057_rls_auto_enable_safety_net.sql).
- Cron: `rls-canary` (Wave 14) em `vercel.json`.
