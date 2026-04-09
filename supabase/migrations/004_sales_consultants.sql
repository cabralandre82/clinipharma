-- ============================================================
-- 004 — Sales Consultants Module
-- Consultores de vendas, comissões e repasses para consultores
-- ============================================================

-- 1. Tabela de consultores de vendas
CREATE TABLE IF NOT EXISTS public.sales_consultants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name           text NOT NULL,
  email               text NOT NULL UNIQUE,
  cnpj                text NOT NULL UNIQUE,
  phone               text,
  commission_rate     numeric(5, 2) NOT NULL DEFAULT 5.00
                      CHECK (commission_rate >= 0 AND commission_rate <= 100),
  bank_name           text,
  bank_agency         text,
  bank_account        text,
  pix_key             text,
  status              text NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- 2. Vincular consultor à clínica
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS consultant_id uuid
  REFERENCES public.sales_consultants(id) ON DELETE SET NULL;

-- 3. Tabela de repasses para consultores
--    Um repasse cobre N comissões (batch)
CREATE TABLE IF NOT EXISTS public.consultant_transfers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id       uuid NOT NULL REFERENCES public.sales_consultants(id),
  gross_amount        numeric(12, 2) NOT NULL,
  transfer_reference  text,
  transfer_date       timestamptz,
  notes               text,
  status              text NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING', 'COMPLETED')),
  confirmed_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- 4. Comissões de consultores por pedido (auto-criada na confirmação do pagamento)
CREATE TABLE IF NOT EXISTS public.consultant_commissions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL UNIQUE REFERENCES public.orders(id),
  consultant_id       uuid NOT NULL REFERENCES public.sales_consultants(id),
  order_total         numeric(12, 2) NOT NULL,
  commission_rate     numeric(5, 2) NOT NULL,
  commission_amount   numeric(12, 2) NOT NULL,
  status              text NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING', 'TRANSFER_PENDING', 'PAID')),
  transfer_id         uuid REFERENCES public.consultant_transfers(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- 5. Índices
CREATE INDEX IF NOT EXISTS idx_clinics_consultant_id
  ON public.clinics(consultant_id);

CREATE INDEX IF NOT EXISTS idx_consultant_commissions_consultant_id
  ON public.consultant_commissions(consultant_id);

CREATE INDEX IF NOT EXISTS idx_consultant_commissions_order_id
  ON public.consultant_commissions(order_id);

CREATE INDEX IF NOT EXISTS idx_consultant_commissions_status
  ON public.consultant_commissions(status);

CREATE INDEX IF NOT EXISTS idx_consultant_transfers_consultant_id
  ON public.consultant_transfers(consultant_id);

CREATE INDEX IF NOT EXISTS idx_consultant_transfers_status
  ON public.consultant_transfers(status);

CREATE INDEX IF NOT EXISTS idx_sales_consultants_user_id
  ON public.sales_consultants(user_id);

-- 6. updated_at triggers
CREATE TRIGGER handle_updated_at_sales_consultants
  BEFORE UPDATE ON public.sales_consultants
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER handle_updated_at_consultant_transfers
  BEFORE UPDATE ON public.consultant_transfers
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER handle_updated_at_consultant_commissions
  BEFORE UPDATE ON public.consultant_commissions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 7. RLS
ALTER TABLE public.sales_consultants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultant_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultant_transfers ENABLE ROW LEVEL SECURITY;

-- sales_consultants: admins veem tudo; consultores veem apenas o próprio registro
CREATE POLICY "admins_all_sales_consultants"
  ON public.sales_consultants
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin());

CREATE POLICY "consultant_read_own"
  ON public.sales_consultants
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- consultant_commissions: admins veem tudo; consultores veem as suas
CREATE POLICY "admins_all_consultant_commissions"
  ON public.consultant_commissions
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin());

CREATE POLICY "consultant_read_own_commissions"
  ON public.consultant_commissions
  FOR SELECT
  TO authenticated
  USING (
    consultant_id IN (
      SELECT id FROM public.sales_consultants WHERE user_id = auth.uid()
    )
  );

-- consultant_transfers: admins veem tudo; consultores veem os seus
CREATE POLICY "admins_all_consultant_transfers"
  ON public.consultant_transfers
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin());

CREATE POLICY "consultant_read_own_transfers"
  ON public.consultant_transfers
  FOR SELECT
  TO authenticated
  USING (
    consultant_id IN (
      SELECT id FROM public.sales_consultants WHERE user_id = auth.uid()
    )
  );
