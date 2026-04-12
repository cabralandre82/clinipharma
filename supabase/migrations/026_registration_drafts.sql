-- ============================================================
-- Migration 026: Registration Drafts
--   Captura interesses de cadastro antes do envio de documentos.
--   Não cria usuário — apenas salva os dados do formulário.
--   Expiração automática em 7 dias (cron diário purga os expirados).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.registration_drafts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  type         text        NOT NULL CHECK (type IN ('CLINIC', 'DOCTOR')),
  form_data    jsonb       NOT NULL DEFAULT '{}',
  ip_address   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);

CREATE INDEX IF NOT EXISTS idx_reg_drafts_expires_at  ON public.registration_drafts(expires_at);
CREATE INDEX IF NOT EXISTS idx_reg_drafts_created_at  ON public.registration_drafts(created_at DESC);

-- auto updated_at
CREATE OR REPLACE FUNCTION public.set_draft_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_draft_updated_at ON public.registration_drafts;
CREATE TRIGGER trg_draft_updated_at
  BEFORE UPDATE ON public.registration_drafts
  FOR EACH ROW EXECUTE FUNCTION public.set_draft_updated_at();

-- RLS: apenas service_role acessa (admin client)
ALTER TABLE public.registration_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drafts_service_only"
  ON public.registration_drafts
  TO service_role
  USING (true)
  WITH CHECK (true);
