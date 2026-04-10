-- ── Migration 022: Pharmacy CNPJ validation tracking ────────────────────────
-- Enables automated CNPJ status tracking via ReceitaWS API.
-- Applied: 2026-04-08

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS cnpj_validated_at  timestamptz,
  ADD COLUMN IF NOT EXISTS cnpj_situation     text;

-- Index for the weekly revalidation cron (finds pharmacies needing re-check)
CREATE INDEX IF NOT EXISTS idx_pharmacies_cnpj_validated_at
  ON public.pharmacies(cnpj_validated_at)
  WHERE status = 'ACTIVE';

COMMENT ON COLUMN public.pharmacies.cnpj_validated_at IS
  'Last time this pharmacy CNPJ was validated against ReceitaWS API';

COMMENT ON COLUMN public.pharmacies.cnpj_situation IS
  'Last known CNPJ situation from Receita Federal (ATIVA, BAIXADA, SUSPENSA, INAPTA, etc.)';
