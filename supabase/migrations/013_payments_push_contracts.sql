-- Migration 013: Payment gateway (Asaas), push tokens (FCM), contracts (Clicksign)

-- ── FCM push tokens ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fcm_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token       text        NOT NULL,
  device_info text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(token)
);
CREATE INDEX IF NOT EXISTS idx_fcm_tokens_user_id ON public.fcm_tokens(user_id);

ALTER TABLE public.fcm_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own tokens" ON public.fcm_tokens
  FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Service role full access fcm" ON public.fcm_tokens
  FOR ALL TO service_role USING (true);

-- ── Asaas fields on payments ──────────────────────────────────────────────────
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS asaas_payment_id    text,
  ADD COLUMN IF NOT EXISTS asaas_invoice_url   text,
  ADD COLUMN IF NOT EXISTS asaas_pix_qr_code   text,
  ADD COLUMN IF NOT EXISTS asaas_pix_copy_paste text,
  ADD COLUMN IF NOT EXISTS asaas_boleto_url    text,
  ADD COLUMN IF NOT EXISTS asaas_boleto_barcode text,
  ADD COLUMN IF NOT EXISTS payment_link        text,
  ADD COLUMN IF NOT EXISTS payment_due_date    date;

-- Asaas customer ID on clinics (to avoid re-creating customers)
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS asaas_customer_id text;

-- ── Contracts (Clicksign) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contracts (
  id                           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  type                         text        NOT NULL
    CHECK (type IN ('CLINIC_AGREEMENT','DOCTOR_AGREEMENT','PHARMACY_AGREEMENT','CONSULTANT_AGREEMENT')),
  status                       text        NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','SENT','VIEWED','SIGNED','CANCELLED','EXPIRED')),
  entity_type                  text        NOT NULL
    CHECK (entity_type IN ('CLINIC','DOCTOR','PHARMACY','CONSULTANT')),
  entity_id                    uuid        NOT NULL,
  user_id                      uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  clicksign_document_key       text,
  clicksign_request_signature_key text,
  signers                      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  signed_at                    timestamptz,
  expires_at                   timestamptz,
  document_url                 text,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contracts_entity_id ON public.contracts(entity_id);
CREATE INDEX IF NOT EXISTS idx_contracts_user_id   ON public.contracts(user_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status    ON public.contracts(status);

ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own contracts" ON public.contracts
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Admins full access contracts" ON public.contracts
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role IN ('SUPER_ADMIN','PLATFORM_ADMIN')
    )
  );
CREATE POLICY "Service role full access contracts" ON public.contracts
  FOR ALL TO service_role USING (true);

-- updated_at triggers
CREATE OR REPLACE TRIGGER set_updated_at_fcm_tokens
  BEFORE UPDATE ON public.fcm_tokens
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_contracts
  BEFORE UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
