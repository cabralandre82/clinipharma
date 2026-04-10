-- ── Migration 020: Expand consultant_commissions.status with PROCESSING ───────
-- Required by the atomic double-payment guard in services/consultants.ts
-- Applied: 2026-04-08

ALTER TABLE public.consultant_commissions
  DROP CONSTRAINT IF EXISTS consultant_commissions_status_check;

ALTER TABLE public.consultant_commissions
  ADD CONSTRAINT consultant_commissions_status_check
    CHECK (status IN ('PENDING', 'PROCESSING', 'TRANSFER_PENDING', 'PAID', 'CANCELLED'));
