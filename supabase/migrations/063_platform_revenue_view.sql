-- Migration 063 — platform revenue reconciliation view.
--
-- Why this exists
-- ---------------
-- 2026-04-29 incident: operator reported "I can only see my own
-- (platform) commission inside the pharmacy transfer page, and on
-- order CP-2026-000015 the math is wrong — pharmacy gets R$100 and
-- the recorded commission is R$90 but the customer paid R$180.50."
--
-- Two distinct issues exposed:
--
--  1. Coupon-funded reconciliation gap. `services/payments.ts` was
--     summing `platform_commission_per_unit * quantity` from the
--     price-freeze snapshot — that snapshot was computed at item
--     creation as `unit_price - pharmacy_cost` BEFORE coupons were
--     applied, so a coupon order ended up with
--     `pharmacy_transfer + platform_commission > total_price`. The
--     services/payments.ts fix (same commit as this migration)
--     derives platform_commission from the reconciliation invariant
--     instead.
--
--  2. No first-class platform revenue surface. The /reports page
--     showed "totalCommission" only as a side-effect of completed
--     transfers; there was no aggregate "this is what the platform
--     made on a paid order" anywhere in SQL or UI.
--
-- This migration creates the canonical, audit-ready reconciliation
-- view. Every report, dashboard, KPI card, and CSV export should
-- read from `public.platform_revenue_view` going forward — never
-- recompute the formula in application code.

-- ─── view ──────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.platform_revenue_view AS
SELECT
  o.id                         AS order_id,
  o.code                       AS order_code,
  o.created_at                 AS order_created_at,
  o.order_status,
  o.payment_status,
  o.transfer_status,
  o.clinic_id,
  o.pharmacy_id,
  o.total_price                AS gross_paid,
  -- Pharmacy share — frozen cost summed across items. Invariant to
  -- coupons: a R$ 5 coupon does NOT cut what the pharmacy receives.
  COALESCE(items.pharmacy_total, 0)                                  AS pharmacy_share,
  -- Consultant commission, when the buying clinic has one. Pulled
  -- from the dedicated table (NOT order_items) because it is
  -- computed off the order total at confirmation time and is opaque
  -- to per-item snapshots.
  COALESCE(cc.commission_amount, 0)                                  AS consultant_share,
  -- Platform net revenue — what we actually keep. The reconciliation
  -- invariant is enforced in code at confirm-payment time, but we
  -- also compute it here so legacy / mis-recorded rows surface as a
  -- non-zero `recon_gap` instead of silently lying.
  o.total_price
    - COALESCE(items.pharmacy_total, 0)
    - COALESCE(cc.commission_amount, 0)                              AS platform_net,
  -- Recorded values from the ledger tables. Useful for catching
  -- drift between "what the formula says" and "what the ledger
  -- says" (e.g. CP-2026-000015 pre-2026-04-29 had a R$ 9,50 gap).
  c.commission_total_amount                                          AS recorded_platform_commission,
  t.commission_amount                                                AS recorded_transfer_commission,
  t.net_amount                                                       AS recorded_pharmacy_transfer,
  -- Per-row reconciliation gap. Should be 0 for every paid order.
  -- Audit cron `reconcile-platform-revenue` (follow-up) will alert
  -- on |recon_gap| > 0.01.
  COALESCE(c.commission_total_amount, 0)
    - (
      o.total_price
      - COALESCE(items.pharmacy_total, 0)
      - COALESCE(cc.commission_amount, 0)
    )                                                                AS recon_gap
FROM public.orders o
LEFT JOIN LATERAL (
  SELECT SUM(oi.pharmacy_cost_per_unit * oi.quantity) AS pharmacy_total
  FROM public.order_items oi
  WHERE oi.order_id = o.id
) items ON TRUE
LEFT JOIN public.commissions c
  ON c.order_id = o.id
LEFT JOIN public.transfers t
  ON t.order_id = o.id
LEFT JOIN public.consultant_commissions cc
  ON cc.order_id = o.id
WHERE o.deleted_at IS NULL;

COMMENT ON VIEW public.platform_revenue_view IS
  'Canonical platform revenue reconciliation. gross_paid = pharmacy_share + consultant_share + platform_net by construction. recon_gap surfaces ledger drift (target 0).';

-- ─── permissions ───────────────────────────────────────────────────────
-- Only privileged roles read this view. The clinic / pharmacy never
-- need to see platform-level financial breakdown.
REVOKE ALL ON public.platform_revenue_view FROM PUBLIC;
GRANT SELECT ON public.platform_revenue_view TO service_role;

-- ─── smoke ─────────────────────────────────────────────────────────────
-- Light sanity: the view must select cleanly and return the right
-- columns. We don't assert any specific row count because the
-- migration runs against an empty test database in CI.
DO $$
DECLARE
  v_count bigint;
BEGIN
  SELECT count(*) INTO v_count FROM public.platform_revenue_view;
  RAISE NOTICE 'Migration 063 smoke OK — platform_revenue_view rows=%', v_count;
END $$;
