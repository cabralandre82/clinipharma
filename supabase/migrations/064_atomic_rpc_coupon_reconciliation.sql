-- Migration 064: reconcile atomic RPC + revenue view with coupon-funded
-- platform commission semantics.
--
-- Why
-- ---
-- Two pre-existing artifacts were silently inconsistent with the actual
-- post-coupon arithmetic the platform now uses (`services/payments.ts`,
-- post 2026-04-29):
--
--   1. `public.confirm_payment_atomic` (migration 049) summed the
--      `platform_commission_per_unit * quantity` snapshot from
--      `order_items` to derive `platform_commission`. That snapshot is
--      frozen at item creation as `unit_price - pharmacy_cost`, BEFORE
--      any coupon is applied. On a coupon order the resulting commission
--      did NOT reconcile with what the customer actually paid:
--
--        total_price (paid)   = R$ 180,50   (with R$ 9,50 coupon)
--        pharmacy_transfer    = R$ 100,00
--        platform_commission  = R$  90,00   (snapshot, pre-coupon)
--        ───────────────────────────────────
--        gap (phantom money)  = R$   9,50
--
--      The platform was implicitly absorbing the coupon discount but
--      RECORDING the pre-coupon margin. The legacy non-RPC code path
--      was patched on 2026-04-29; this migration ports the same fix to
--      the RPC so that turning `payments.atomic_confirm = true` later
--      cannot reintroduce the bug.
--
--   2. `public.platform_revenue_view` (migration 063) reported a
--      `recon_gap` defined as
--           commission_total_amount - (total - pharmacy - consultant)
--      which is the WRONG invariant. The recorded
--      `commissions.commission_total_amount` represents the platform's
--      GROSS commission (the slice between gross_paid and the pharmacy
--      transfer), BEFORE the consultant takes their cut. So the
--      "consultant" subtraction should not be in the gap — only in
--      `platform_net`. The follow-up cron `reconcile-platform-revenue`
--      was about to start firing false positives on every order with a
--      consultant the moment we shipped it.
--
-- What this migration does
-- ------------------------
--   A. CREATE OR REPLACE FUNCTION public.confirm_payment_atomic — same
--      signature, same effects, but the platform_commission line
--      derives v_platform_commission from the reconciliation invariant
--      (total_price − pharmacy_transfer) instead of summing the
--      pre-coupon item snapshot.
--
--   B. CREATE OR REPLACE VIEW public.platform_revenue_view — same
--      columns, but `recon_gap` is now
--          commission_total_amount - (total - pharmacy)
--      i.e. zero when the gross commission line reconciles. The
--      `platform_net` column is unchanged (it remains
--      total - pharmacy - consultant, the truly-net cash to the
--      platform).
--
-- Migration 049 stays untouched (append-only rule); this migration
-- supersedes the function body. Migration 063's view is also replaced
-- in-place via CREATE OR REPLACE VIEW (additive — same column list).
--
-- LGPD: no PII in this migration. Pure ledger arithmetic.
--
-- Rollback (manual, only if a regression is detected):
--   1. Run the function body from migration 049 lines 150-300 again.
--   2. Run the view body from migration 063 lines ~50-95 again.
--   The rollback is by definition a regression to the bug; only do it
--   if the new arithmetic itself is shown to be wrong.

SET search_path TO public, extensions, pg_temp;

-- ── A. confirm_payment_atomic — coupon-reconciled commission ─────────────

CREATE OR REPLACE FUNCTION public.confirm_payment_atomic(
  p_payment_id uuid,
  p_args jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment              public.payments%ROWTYPE;
  v_order                public.orders%ROWTYPE;
  v_expected_lock        int;
  v_pharmacy_transfer    numeric(10,2);
  v_platform_commission  numeric(10,2);
  v_consultant_id        uuid;
  v_consultant_rate      numeric;
  v_consultant_commission numeric(10,2);
BEGIN
  IF p_payment_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payment' USING ERRCODE = 'P0001';
  END IF;
  IF p_args IS NULL OR (p_args ? 'confirmed_by_user_id') = false THEN
    RAISE EXCEPTION 'invalid_args' USING ERRCODE = 'P0001';
  END IF;

  v_expected_lock := COALESCE((p_args ->> 'expected_lock_version')::int, 0);

  -- Atomic status transition. If another confirmer already moved the
  -- payment to CONFIRMED, `lock_version` will no longer match the expected
  -- value (which defaults to the row's current one in the TS wrapper) and
  -- the UPDATE will match 0 rows.
  UPDATE public.payments
     SET status              = 'CONFIRMED',
         payment_method      = COALESCE(p_args ->> 'payment_method', payment_method),
         reference_code      = NULLIF(p_args ->> 'reference_code', ''),
         notes               = NULLIF(p_args ->> 'notes', ''),
         confirmed_by_user_id= (p_args ->> 'confirmed_by_user_id')::uuid,
         confirmed_at        = now(),
         updated_at          = now(),
         lock_version        = lock_version + 1
   WHERE id = p_payment_id
     AND status = 'PENDING'
     AND (v_expected_lock = 0 OR lock_version = v_expected_lock)
  RETURNING * INTO v_payment;

  IF NOT FOUND THEN
    -- Distinguish "already confirmed" from "stale version" so the caller
    -- can retry on stale but abort on already-confirmed.
    IF EXISTS (SELECT 1 FROM public.payments WHERE id = p_payment_id AND status <> 'PENDING') THEN
      RAISE EXCEPTION 'already_processed' USING ERRCODE = 'P0001';
    END IF;
    IF v_expected_lock > 0 AND EXISTS (SELECT 1 FROM public.payments WHERE id = p_payment_id) THEN
      RAISE EXCEPTION 'stale_version' USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Load the companion order once; subsequent updates reuse it.
  SELECT * INTO v_order FROM public.orders WHERE id = v_payment.order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Pharmacy transfer = sum of frozen pharmacy_cost columns. INVARIANT
  -- to coupons: a R$ 9,50 coupon does NOT cut what the pharmacy gets;
  -- the platform absorbs the discount. (This is current product policy
  -- as of 2026-04-29. If the policy ever shifts to "coupons reduce the
  -- pharmacy share", that becomes a per-coupon `funded_by` column with
  -- the calculation forking on it. There is currently no such column.)
  SELECT round(coalesce(sum(pharmacy_cost_per_unit * quantity), 0)::numeric, 2)
    INTO v_pharmacy_transfer
    FROM public.order_items
   WHERE order_id = v_payment.order_id;

  -- Platform commission DERIVED from the reconciliation invariant, not
  -- summed from the pre-coupon `platform_commission_per_unit` snapshot.
  -- Pre-2026-04-29 the RPC summed that snapshot, which over-stated the
  -- platform share by the coupon discount on coupon orders, and the
  -- ledger lost the reconciliation between gross_paid and
  -- (pharmacy_transfer + platform_commission).
  --
  --   pharmacy_transfer + platform_commission == gross_paid
  --
  -- is now an exact arithmetic identity, written by this RPC for every
  -- atomically-confirmed payment.
  v_platform_commission := GREATEST(0, round((v_order.total_price - v_pharmacy_transfer)::numeric, 2));

  INSERT INTO public.commissions (
    order_id, commission_type, commission_fixed_amount,
    commission_total_amount, calculated_by_user_id
  ) VALUES (
    v_payment.order_id, 'FIXED', v_platform_commission,
    v_platform_commission, (p_args ->> 'confirmed_by_user_id')::uuid
  );

  INSERT INTO public.transfers (
    order_id, pharmacy_id, gross_amount, commission_amount, net_amount, status
  ) VALUES (
    v_payment.order_id, v_order.pharmacy_id,
    v_order.total_price, v_platform_commission, v_pharmacy_transfer,
    'PENDING'
  );

  -- Consultant commission is optional — only if the clinic has one.
  -- Computed from the post-coupon total_price (the actual cash the
  -- platform took in), not from the pre-coupon estimated total. The
  -- consultant is paid as a percentage of REAL revenue.
  IF v_order.clinic_id IS NOT NULL THEN
    SELECT consultant_id INTO v_consultant_id
      FROM public.clinics WHERE id = v_order.clinic_id;

    IF v_consultant_id IS NOT NULL THEN
      SELECT COALESCE((value_json::text)::numeric, 5)
        INTO v_consultant_rate
        FROM public.app_settings
       WHERE key = 'consultant_commission_rate'
       LIMIT 1;
      v_consultant_rate := COALESCE(v_consultant_rate, 5);
      v_consultant_commission := round(v_order.total_price * v_consultant_rate / 100, 2);

      INSERT INTO public.consultant_commissions (
        order_id, consultant_id, order_total,
        commission_rate, commission_amount, status
      ) VALUES (
        v_payment.order_id, v_consultant_id, v_order.total_price,
        v_consultant_rate, v_consultant_commission, 'PENDING'
      );
    END IF;
  END IF;

  -- Order status transition — also lock-versioned so a concurrent admin
  -- edit cannot silently clobber the new status.
  UPDATE public.orders
     SET payment_status  = 'CONFIRMED',
         order_status    = 'COMMISSION_CALCULATED',
         transfer_status = 'PENDING',
         updated_at      = now(),
         lock_version    = lock_version + 1
   WHERE id = v_payment.order_id;

  -- Append the status-history row in the same transaction. The TS layer
  -- still writes the audit log / notifications outside — those are
  -- idempotent by design and do not need transactional coupling.
  INSERT INTO public.order_status_history (
    order_id, old_status, new_status, changed_by_user_id, reason
  ) VALUES (
    v_payment.order_id,
    v_order.order_status,
    'COMMISSION_CALCULATED',
    (p_args ->> 'confirmed_by_user_id')::uuid,
    COALESCE(
      'Pagamento confirmado (' || COALESCE(p_args ->> 'payment_method', 'MANUAL') ||
      CASE WHEN NULLIF(p_args ->> 'reference_code', '') IS NOT NULL
           THEN ' · ref: ' || (p_args ->> 'reference_code')
           ELSE '' END
      || ')',
      'Pagamento confirmado'
    )
  );

  RETURN jsonb_build_object(
    'payment_id', v_payment.id,
    'order_id', v_payment.order_id,
    'pharmacy_transfer', v_pharmacy_transfer,
    'platform_commission', v_platform_commission,
    'consultant_commission', v_consultant_commission,
    'new_lock_version', v_payment.lock_version
  );
END;
$$;

COMMENT ON FUNCTION public.confirm_payment_atomic(uuid, jsonb) IS
  'Wave 7 + 064 — atomic payment confirmation with coupon-reconciled commission. Replaces 049 body. platform_commission is derived from (total_price - pharmacy_transfer), not from the pre-coupon item snapshot, so pharmacy_transfer + platform_commission == total_price by construction.';

GRANT EXECUTE ON FUNCTION public.confirm_payment_atomic(uuid, jsonb) TO service_role;

-- ── B. platform_revenue_view — corrected recon_gap ───────────────────────
--
-- Conceptual model for the columns:
--
--   gross_paid         = the customer paid this much (post-coupon)
--   pharmacy_share     = what the pharmacy is owed (frozen cost)
--   consultant_share   = what the consultant is owed (% of gross_paid)
--   platform_net       = what the platform actually keeps =
--                        gross_paid - pharmacy_share - consultant_share
--   recorded_platform_commission = `commissions.commission_total_amount`
--                        from the ledger. This is the PLATFORM GROSS
--                        commission, i.e. (gross_paid - pharmacy_share),
--                        BEFORE the consultant cut. The platform pays
--                        the consultant out of this slice.
--   recon_gap          = recorded - (gross - pharmacy_share). Zero by
--                        construction when the platform booked the
--                        commission correctly. The pre-064 view was
--                        subtracting consultant_share too, which
--                        produced a non-zero gap on every consultant
--                        order.

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
  COALESCE(items.pharmacy_total, 0)                                  AS pharmacy_share,
  COALESCE(cc.commission_amount, 0)                                  AS consultant_share,
  o.total_price
    - COALESCE(items.pharmacy_total, 0)
    - COALESCE(cc.commission_amount, 0)                              AS platform_net,
  c.commission_total_amount                                          AS recorded_platform_commission,
  t.commission_amount                                                AS recorded_transfer_commission,
  t.net_amount                                                       AS recorded_pharmacy_transfer,
  -- Reconciliation gap = ledger commission MINUS the gross-commission
  -- formula (gross_paid - pharmacy_share). Zero when correct, non-zero
  -- when the platform_commission row is stale or wrong (e.g. a coupon
  -- order written before the 2026-04-29 fix). The follow-up cron
  -- `reconcile-platform-revenue` alerts on |recon_gap| > 0,01 ONLY on
  -- orders whose payment_status = CONFIRMED.
  COALESCE(c.commission_total_amount, 0)
    - (o.total_price - COALESCE(items.pharmacy_total, 0))            AS recon_gap
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
  'Migration 063 + 064 — canonical platform revenue ledger. recon_gap = recorded_platform_commission - (gross_paid - pharmacy_share). Zero when reconciliation holds.';

GRANT SELECT ON public.platform_revenue_view TO service_role;

-- ── Smoke ─────────────────────────────────────────────────────────────────
DO $smoke$
DECLARE
  v_count int;
  v_proargs text;
BEGIN
  -- 064 functions still present
  SELECT count(*) INTO v_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'confirm_payment_atomic';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Migration 064 smoke: confirm_payment_atomic missing or duplicated (% rows)', v_count;
  END IF;

  -- View columns unchanged (callers depend on stable shape)
  PERFORM 1
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'platform_revenue_view'
     AND column_name = 'recon_gap';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Migration 064 smoke: platform_revenue_view.recon_gap missing';
  END IF;

  RAISE NOTICE 'Migration 064 smoke passed';
END
$smoke$;
