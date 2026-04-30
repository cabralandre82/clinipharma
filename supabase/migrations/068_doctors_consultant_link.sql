-- Migration 068 — link a sales consultant to a doctor.
--
-- Bug
-- ---
-- Pedidos cuja `orders.buyer_type = 'DOCTOR'` (e portanto
-- `clinic_id IS NULL`, `doctor_id IS NOT NULL`) NUNCA geram comissão
-- de consultor. O `confirm_payment_atomic` resolve consultor SOMENTE
-- por `clinics.consultant_id`. E `doctors` não tem coluna
-- `consultant_id` — então mesmo se ele quisesse olhar, não tem onde.
--
-- Isto é uma regressão: regras do produto sempre disseram que o
-- consultor é vinculável tanto a clínica quanto a médico.
--
-- Confirmado via inspeção do schema em 2026-04-29:
--
--   doctors columns:
--     id, full_name, crm, crm_state, specialty, email, phone,
--     status, created_at, updated_at, crm_encrypted, cpf, user_id,
--     crm_validated_at
--     ↑ não há consultant_id.
--
-- Fix
-- ---
-- Esta migration faz a parte SQL: ADD COLUMN + index parcial. A
-- segunda metade (resolver `doctors.consultant_id` em
-- `confirm_payment_atomic`) está em `069_confirm_payment_atomic_doctor_consultant.sql`,
-- que precisa rodar no mesmo PR para fechar o ciclo.
--
-- Backfill: nenhum. Médicos existentes ficam com `consultant_id = NULL`,
-- comportamento idêntico ao atual (consultor não atribuído). Nada
-- regride retroativamente — só pedidos NOVOS de doctors com consultor
-- assignado pela UI passarão a gerar `consultant_commissions`.
--
-- Verificação
-- -----------
-- Após aplicar:
--   SELECT consultant_id IS NULL FROM doctors LIMIT 1;  -- TRUE em todos
--   \d doctors  -- coluna deve aparecer
--
-- Rollback
-- --------
-- ALTER TABLE doctors DROP COLUMN consultant_id;
-- (Não destrói nada — coluna foi recém-criada, fica em NULL em todos.)
--
-- LGPD: a vinculação consultor↔médico é dado profissional, não dado
-- pessoal sensível adicional ao já existente em `doctors`. Sem novo
-- consentimento necessário (LGPD Art. 7, V — execução de contrato).

SET search_path TO public, extensions, pg_temp;

ALTER TABLE public.doctors
  ADD COLUMN IF NOT EXISTS consultant_id uuid NULL
    REFERENCES public.sales_consultants(id) ON DELETE SET NULL;

-- Index parcial só em registros com consultor — evita inflar o índice
-- com a maioria dos médicos que não terá consultor atribuído.
CREATE INDEX IF NOT EXISTS ix_doctors_consultant_id
  ON public.doctors(consultant_id)
  WHERE consultant_id IS NOT NULL;

-- ── Smoke ──────────────────────────────────────────────────────────────
DO $smoke$
DECLARE
  v_col_exists boolean;
  v_idx_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'doctors'
       AND column_name  = 'consultant_id'
  ) INTO v_col_exists;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename  = 'doctors'
       AND indexname  = 'ix_doctors_consultant_id'
  ) INTO v_idx_exists;

  IF NOT v_col_exists THEN
    RAISE EXCEPTION 'Migration 068 smoke: doctors.consultant_id missing';
  END IF;
  IF NOT v_idx_exists THEN
    RAISE EXCEPTION 'Migration 068 smoke: ix_doctors_consultant_id missing';
  END IF;

  RAISE NOTICE 'Migration 068 smoke passed (doctors.consultant_id + index)';
END
$smoke$;
