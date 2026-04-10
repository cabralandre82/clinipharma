-- ─────────────────────────────────────────────────────────────────────────────
-- 017_week2_indexes.sql
-- Semana 2: pg_stat_statements + índices confirmados por análise de código
--
-- Metodologia:
--   Cada índice abaixo foi identificado por varredura de .order(), .eq(), .in()
--   no código fonte (services/, app/api/, components/dashboard/).
--   Índices para colunas já cobertas por PKs/FKs existentes foram omitidos.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 0. Habilitar pg_stat_statements ────────────────────────────────────────
-- Permite monitorar as queries mais lentas após go-live.
-- Query de diagnóstico (rodar após 1 semana de produção):
--
--   SELECT substring(query,1,120), round(mean_exec_time::numeric,2) AS avg_ms,
--          calls, round(total_exec_time::numeric,2) AS total_ms
--   FROM pg_stat_statements WHERE calls > 10
--   ORDER BY mean_exec_time DESC LIMIT 20;
--
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- ── 1. profiles — ordenação por full_name (página /users, /reports) ─────────
-- Página /users ordena por full_name sem filtro → seq scan sem índice.
CREATE INDEX IF NOT EXISTS idx_profiles_full_name
  ON public.profiles(full_name);

-- ── 2. clinics — ordenação por trade_name (página /clinics) ────────────────
-- Página /clinics ordena por trade_name → seq scan sem índice.
CREATE INDEX IF NOT EXISTS idx_clinics_trade_name
  ON public.clinics(trade_name);

-- ── 3. pharmacies — ordenação por trade_name ────────────────────────────────
-- Páginas /pharmacies e consultant dashboard ordenam por trade_name.
CREATE INDEX IF NOT EXISTS idx_pharmacies_trade_name
  ON public.pharmacies(trade_name);

-- ── 4. doctors — ordenação por full_name (página /doctors) ──────────────────
CREATE INDEX IF NOT EXISTS idx_doctors_full_name
  ON public.doctors(full_name);

-- ── 5. sales_consultants — ordenação por full_name ──────────────────────────
CREATE INDEX IF NOT EXISTS idx_sales_consultants_full_name
  ON public.sales_consultants(full_name);

-- ── 6. payments — cursor pagination + export streaming ──────────────────────
-- Endpoint /api/export e página /payments ordenam por created_at DESC.
-- payments.order_id já tem índice; payments.created_at estava sem.
CREATE INDEX IF NOT EXISTS idx_payments_created_at
  ON public.payments(created_at DESC);

-- ── 7. transfers — cursor pagination + export streaming ─────────────────────
CREATE INDEX IF NOT EXISTS idx_transfers_created_at
  ON public.transfers(created_at DESC);

-- ── 8. consultant_commissions — export streaming ────────────────────────────
CREATE INDEX IF NOT EXISTS idx_consultant_commissions_created_at
  ON public.consultant_commissions(created_at DESC);

-- ── 9. audit_logs — cursor pagination (página /audit, alta taxa de crescimento)
-- Já temos: idx_audit_logs_created_at e idx_audit_logs_actor_user_id separados.
-- Adicionamos composto para evitar sort + index scan simultâneamente.
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at_desc
  ON public.audit_logs(created_at DESC);

-- ── 10. notifications — listagem geral por user (sem filtro WHERE read_at IS NULL)
-- O idx_notifications_user_unread filtra só não-lidas.
-- Adicionamos cobertura para consultas sem filtro (ex: histórico de notificações).
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications(user_id, created_at DESC);

-- ── 11. products — ordenação por name (página /products, /catalog) ───────────
CREATE INDEX IF NOT EXISTS idx_products_name
  ON public.products(name);

-- ── 12. order_status_history — busca por order_id (detalhes de pedido) ──────
-- Já existe idx em orders(order_id) via PK, mas order_status_history precisa de
-- busca rápida por order_id para exibir o histórico de status.
CREATE INDEX IF NOT EXISTS idx_order_status_history_order_id
  ON public.order_status_history(order_id);

-- ── 13. stale-orders widget: updated_at para filtro pré-DB ──────────────────
-- O widget busca pedidos não atualizados há X dias.
-- WITHOUT índice, faz seq scan em toda a tabela orders.
CREATE INDEX IF NOT EXISTS idx_orders_updated_at
  ON public.orders(updated_at);

-- ── 14. registration_requests — busca por user_id (fluxo de aprovação) ──────
-- Já existe idx em registration_requests(user_id) via migration 016.
-- Adicionamos por status (PENDING, PENDING_DOCS) para a fila de aprovação.
CREATE INDEX IF NOT EXISTS idx_reg_requests_status_created
  ON public.registration_requests(status, created_at DESC);
