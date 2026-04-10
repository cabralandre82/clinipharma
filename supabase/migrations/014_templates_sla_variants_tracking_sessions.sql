-- Migration 014: Order templates, SLA configs, public tracking, product variants, access logs

-- ── Order templates ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.order_templates (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid        NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  -- items: [{product_id, variant_id, quantity, pharmacy_id, product_name, unit_price, pharmacy_cost}]
  items       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_by  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_templates_clinic_id ON public.order_templates(clinic_id);
ALTER TABLE public.order_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clinic members manage templates" ON public.order_templates
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.clinic_members
      WHERE clinic_id = order_templates.clinic_id AND user_id = auth.uid()
    )
  );
CREATE POLICY "Admins full access templates" ON public.order_templates
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('SUPER_ADMIN','PLATFORM_ADMIN'))
  );
CREATE POLICY "Service role full access templates" ON public.order_templates
  FOR ALL TO service_role USING (true);

-- ── SLA configurations ────────────────────────────────────────────────────────
-- pharmacy_id NULL = global default; pharmacy-specific overrides the global
CREATE TABLE IF NOT EXISTS public.sla_configs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id   uuid        REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  order_status  text        NOT NULL,
  warning_days  int         NOT NULL DEFAULT 2,
  alert_days    int         NOT NULL DEFAULT 3,
  critical_days int         NOT NULL DEFAULT 5,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, order_status)
);
ALTER TABLE public.sla_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins full access sla" ON public.sla_configs
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('SUPER_ADMIN'))
  );
CREATE POLICY "Service role full access sla" ON public.sla_configs
  FOR ALL TO service_role USING (true);

-- Seed global defaults (mirrors old hardcoded STALE_THRESHOLDS)
INSERT INTO public.sla_configs (pharmacy_id, order_status, warning_days, alert_days, critical_days) VALUES
  (null, 'AWAITING_DOCUMENTS',    2, 3, 5),
  (null, 'AWAITING_PAYMENT',      2, 3, 5),
  (null, 'READY_FOR_REVIEW',      2, 3, 5),
  (null, 'PAYMENT_UNDER_REVIEW',  2, 3, 5),
  (null, 'COMMISSION_CALCULATED', 2, 3, 5),
  (null, 'TRANSFER_PENDING',      2, 3, 5),
  (null, 'READY',                 2, 3, 5),
  (null, 'RELEASED_FOR_EXECUTION',3, 5, 8),
  (null, 'RECEIVED_BY_PHARMACY',  3, 5, 8),
  (null, 'IN_EXECUTION',          3, 5, 8),
  (null, 'SHIPPED',               3, 5, 8)
ON CONFLICT (pharmacy_id, order_status) DO NOTHING;

-- ── Public order tracking tokens ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.order_tracking_tokens (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid        NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  token      text        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(order_id)
);
CREATE INDEX IF NOT EXISTS idx_order_tracking_tokens_token ON public.order_tracking_tokens(token);
-- No RLS needed: public access by token (validated in API route)
ALTER TABLE public.order_tracking_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access tracking" ON public.order_tracking_tokens
  FOR ALL TO service_role USING (true);
CREATE POLICY "Anon can read by token" ON public.order_tracking_tokens
  FOR SELECT USING (true);

-- ── Product variants ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_variants (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id               uuid        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name                     text        NOT NULL,
  -- Free-form attributes: {concentracao: "500mg", apresentacao: "Comprimido", quantidade: "30un"}
  attributes               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  price_current            numeric(12,2) NOT NULL,
  pharmacy_cost            numeric(12,2) NOT NULL DEFAULT 0,
  platform_commission_type text        NOT NULL DEFAULT 'PERCENTAGE'
    CHECK (platform_commission_type IN ('PERCENTAGE','FIXED')),
  platform_commission_value numeric(12,2) NOT NULL DEFAULT 0,
  is_default               boolean     NOT NULL DEFAULT false,
  is_active                boolean     NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON public.product_variants(product_id);
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read active variants" ON public.product_variants
  FOR SELECT USING (is_active = true);
CREATE POLICY "Admins manage variants" ON public.product_variants
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('SUPER_ADMIN','PLATFORM_ADMIN'))
  );
CREATE POLICY "Service role full access variants" ON public.product_variants
  FOR ALL TO service_role USING (true);

-- Add variant_id to order_items (nullable for backward compat)
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL;

-- Migrate existing products: create a default variant for each
-- Commission per unit = price - pharmacy_cost (same logic as order_items trigger)
INSERT INTO public.product_variants (
  product_id, name, attributes, price_current, pharmacy_cost,
  platform_commission_type, platform_commission_value, is_default, is_active
)
SELECT
  id,
  'Padrão',
  '{}'::jsonb,
  COALESCE(price_current, 0),
  COALESCE(pharmacy_cost, 0),
  'FIXED',
  GREATEST(COALESCE(price_current, 0) - COALESCE(pharmacy_cost, 0), 0),
  true,
  true
FROM public.products
ON CONFLICT DO NOTHING;

-- ── Access logs (session history) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.access_logs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event      text        NOT NULL DEFAULT 'LOGIN'
    CHECK (event IN ('LOGIN','LOGOUT','SESSION_START','PASSWORD_RESET')),
  ip         text,
  user_agent text,
  city       text,
  country    text        DEFAULT 'BR',
  is_new_device boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_access_logs_user_id    ON public.access_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON public.access_logs(created_at);

ALTER TABLE public.access_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own logs" ON public.access_logs
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Admins see all logs" ON public.access_logs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('SUPER_ADMIN','PLATFORM_ADMIN'))
  );
CREATE POLICY "Service role full access logs" ON public.access_logs
  FOR ALL TO service_role USING (true);

-- Triggers
CREATE OR REPLACE TRIGGER set_updated_at_order_templates
  BEFORE UPDATE ON public.order_templates
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_sla_configs
  BEFORE UPDATE ON public.sla_configs
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_product_variants
  BEFORE UPDATE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
