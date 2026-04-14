-- Migration 038: Add manual-action flags for financial records linked to canceled orders
--
-- When a canceled order has a CONFIRMED payment or COMPLETED transfer, the
-- automatic cleanup cannot void them — manual action is required (refund /
-- transfer reversal). These boolean flags allow the platform to surface those
-- cases in the UI so the super admin can register when the external action
-- has been completed.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS needs_manual_refund boolean NOT NULL DEFAULT false;

ALTER TABLE public.transfers
  ADD COLUMN IF NOT EXISTS needs_manual_reversal boolean NOT NULL DEFAULT false;

-- Partial indexes for fast dashboard/list queries
CREATE INDEX IF NOT EXISTS idx_payments_needs_manual_refund
  ON public.payments (needs_manual_refund)
  WHERE needs_manual_refund = true;

CREATE INDEX IF NOT EXISTS idx_transfers_needs_manual_reversal
  ON public.transfers (needs_manual_reversal)
  WHERE needs_manual_reversal = true;
