-- ============================================================
-- Migration 015: Correções de auditoria pré-release
-- ============================================================

-- ── 1. UNIQUE constraint: payments.order_id ──────────────────────────────────
-- Impede criação de múltiplos pagamentos para o mesmo pedido (idempotência)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payments_order_id_unique'
  ) THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_order_id_unique UNIQUE (order_id);
  END IF;
END $$;

-- ── 2. Índices críticos ausentes ──────────────────────────────────────────────
-- Orders por período (relatórios, filtros)
CREATE INDEX IF NOT EXISTS idx_orders_created_at
  ON public.orders(created_at DESC);

-- Orders por status + updated_at (SLA/stale queries)
CREATE INDEX IF NOT EXISTS idx_orders_status_updated
  ON public.orders(order_status, updated_at);

-- Order items por período (BI por produto)
CREATE INDEX IF NOT EXISTS idx_order_items_created_at
  ON public.order_items(created_at DESC);

-- Payments por status (webhook lookups, relatórios)
CREATE INDEX IF NOT EXISTS idx_payments_status
  ON public.payments(status);

-- Profiles por email (auth queries, duplicate check)
CREATE INDEX IF NOT EXISTS idx_profiles_email
  ON public.profiles(email);

-- Clinics por status (listagem admin)
CREATE INDEX IF NOT EXISTS idx_clinics_status
  ON public.clinics(status);

-- Registration requests por user_id + type (evitar duplicatas)
CREATE INDEX IF NOT EXISTS idx_reg_requests_user_type
  ON public.registration_requests(user_id, type);

-- ── 3. RLS: farmácia pode ler documentos dos seus pedidos ─────────────────────
-- (Farmácia precisa ver a prescrição para executar o pedido)
DROP POLICY IF EXISTS "order_docs_pharmacy_read" ON public.order_documents;
CREATE POLICY "order_docs_pharmacy_read" ON public.order_documents
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.pharmacy_members pm ON pm.pharmacy_id = o.pharmacy_id
      WHERE o.id = order_documents.order_id
        AND pm.user_id = auth.uid()
    )
  );

-- ── 4. RLS: clínica pode atualizar status do seu próprio pedido (apenas CANCELED) ──
-- Remove a política genérica e adiciona com restrição de status
DROP POLICY IF EXISTS "clinic_cancel_own_order" ON public.orders;
CREATE POLICY "clinic_cancel_own_order" ON public.orders
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.clinic_members cm
      WHERE cm.clinic_id = orders.clinic_id
        AND cm.user_id = auth.uid()
    )
    AND order_status IN ('DRAFT', 'AWAITING_DOCUMENTS')
  )
  WITH CHECK (
    order_status = 'CANCELED'
  );

-- ── 5. Coluna deleted_at para soft-delete em orders ──────────────────────────
-- Permite "cancelar" mantendo histórico completo
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- ── 6. Precisão financeira: ampliar para numeric(15,2) ───────────────────────
-- Futuras transações de alto volume (B2B pode escalar)
ALTER TABLE public.orders
  ALTER COLUMN total_price TYPE numeric(15,2);

ALTER TABLE public.payments
  ALTER COLUMN gross_amount TYPE numeric(15,2);

ALTER TABLE public.transfers
  ALTER COLUMN gross_amount TYPE numeric(15,2),
  ALTER COLUMN commission_amount TYPE numeric(15,2),
  ALTER COLUMN net_amount TYPE numeric(15,2);

ALTER TABLE public.commissions
  ALTER COLUMN commission_fixed_amount TYPE numeric(15,2),
  ALTER COLUMN commission_total_amount TYPE numeric(15,2);

ALTER TABLE public.order_items
  ALTER COLUMN unit_price TYPE numeric(15,2),
  ALTER COLUMN total_price TYPE numeric(15,2),
  ALTER COLUMN pharmacy_cost_per_unit TYPE numeric(15,2),
  ALTER COLUMN platform_commission_per_unit TYPE numeric(15,2);

-- ── 7. Coluna updated_at em order_items ──────────────────────────────────────
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- ── 8. Constraint: impedir pedido com produto inativo ─────────────────────────
-- (Aplicado no nível de aplicação, mas documentado aqui para auditoria)

-- ── 9. Campo last_login_at em profiles para monitoramento ───────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

-- ── 10. Campo registration_status default review ─────────────────────────────
-- Usuários criados pelo admin já devem ser APPROVED; 
-- auto-cadastro deve iniciar como PENDING (já implementado)

-- ── 11. Índice composto em order_templates para queries por clínica ───────────
CREATE INDEX IF NOT EXISTS idx_order_templates_clinic_updated
  ON public.order_templates(clinic_id, updated_at DESC);

-- ── 12. Retorna 200 idempotente no webhook — garantir que processamento duplo
-- de PAYMENT_CONFIRMED não duplica order_status_history
-- (tratado no código com guard no app, documentado aqui)

-- ── 13. RLS: médicos (DOCTOR role) podem ler seus próprios pedidos ────────────
DROP POLICY IF EXISTS "orders_select_doctor" ON public.orders;
CREATE POLICY "orders_select_doctor" ON public.orders
  FOR SELECT USING (
    created_by_user_id = auth.uid()
  );
