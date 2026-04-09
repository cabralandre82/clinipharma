-- ============================================================
-- 007 — Histórico de alterações do pharmacy_cost por produto
-- ============================================================

CREATE TABLE IF NOT EXISTS public.product_pharmacy_cost_history (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  old_cost            numeric(12, 2) NOT NULL,
  new_cost            numeric(12, 2) NOT NULL,
  changed_by_user_id  uuid NOT NULL REFERENCES public.profiles(id),
  reason              text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pharmacy_cost_history_product ON public.product_pharmacy_cost_history(product_id);

-- RLS
ALTER TABLE public.product_pharmacy_cost_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read pharmacy cost history"
  ON public.product_pharmacy_cost_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('SUPER_ADMIN', 'PLATFORM_ADMIN')
    )
  );

CREATE POLICY "Admins insert pharmacy cost history"
  ON public.product_pharmacy_cost_history FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('SUPER_ADMIN', 'PLATFORM_ADMIN')
    )
  );
