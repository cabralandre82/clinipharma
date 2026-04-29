-- Migration 061 — money_sync_* triggers must tolerate partial UPDATEs.
--
-- Bug
-- ---
-- 2026-04-29 hot-incident: every order_items insert against a product
-- with an active coupon failed with
--
--   ERROR  P0001  money_sync_orders: total_price 180.50 disagrees with
--                  total_price_cents 19000 (drift > 1 cent)
--
-- Root cause
-- ----------
-- Trigger ordering on a coupon-discounted order:
--
--   1. services/orders.ts inserts the orders header with
--      total_price = 190.00 (gross, pre-coupon).
--      `_money_sync_orders` derives total_price_cents = 19000. Header OK.
--
--   2. services/orders.ts inserts an order_items row with coupon_id set.
--      `freeze_order_item_price` (BEFORE INSERT, from migration 027)
--      applies the coupon and writes total_price = 180.50,
--      discount_amount = 9.50.
--
--   3. `recalc_order_total` (AFTER INSERT, from migration 008) fires:
--
--        UPDATE public.orders
--           SET total_price = (SELECT SUM(total_price) FROM order_items
--                              WHERE order_id = ...)
--         WHERE id = v_order_id;
--
--      That SQL only assigns total_price. The cents column is unchanged,
--      so PostgreSQL hands `_money_sync_orders` a NEW row where
--        NEW.total_price       = 180.50  (just changed)
--        NEW.total_price_cents = 19000   (carried over from step 1)
--
--   4. The validator branch — "both columns provided, must agree" — sees
--      a 950-cent drift and raises P0001. The whole order_items insert is
--      aborted, services/orders.ts rolls back the order header, the user
--      sees a stuck spinner.
--
-- Fix
-- ---
-- Treat single-column UPDATEs as a derive-the-other-one operation, not a
-- validation. Concretely:
--
--   * On UPDATE, if only the numeric column changed (cents column is
--     IS NOT DISTINCT FROM OLD.<cents>), recompute cents from numeric.
--   * On UPDATE, if only the cents column changed, recompute numeric.
--   * Fall back to the original derive/validate logic for INSERTs and
--     for UPDATEs that touch both columns.
--
-- Same shape applied to all seven `_money_sync_*` functions for
-- consistency — even where no caller hits the bug today, having the
-- triggers behave the same way under partial updates is the simpler
-- mental model.
--
-- This is a behaviour-preserving change: any path that previously
-- succeeded continues to succeed (we only add cases that used to RAISE
-- but should not have).
--
-- Verification (run after applying):
--   SELECT 1; -- placeholder, see tests/unit/db/money-sync-partial-update.test.ts
--
-- Rollback
-- --------
-- Re-apply the function bodies from migration 050 verbatim. The trigger
-- ATTACH points are unchanged.

SET search_path TO public, extensions, pg_temp;

-- ── orders ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._money_sync_orders()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.total_price IS DISTINCT FROM OLD.total_price
     AND NEW.total_price_cents IS NOT DISTINCT FROM OLD.total_price_cents THEN
    -- Only the numeric column changed (typical: recalc_order_total).
    NEW.total_price_cents := public._money_to_cents(NEW.total_price);
  ELSIF TG_OP = 'UPDATE'
     AND NEW.total_price_cents IS DISTINCT FROM OLD.total_price_cents
     AND NEW.total_price IS NOT DISTINCT FROM OLD.total_price THEN
    -- Only the cents column changed.
    NEW.total_price := (NEW.total_price_cents::numeric) / 100;
  ELSIF NEW.total_price_cents IS NULL AND NEW.total_price IS NOT NULL THEN
    NEW.total_price_cents := public._money_to_cents(NEW.total_price);
  ELSIF NEW.total_price_cents IS NOT NULL AND NEW.total_price IS NULL THEN
    NEW.total_price := (NEW.total_price_cents::numeric) / 100;
  ELSIF NEW.total_price_cents IS NOT NULL AND NEW.total_price IS NOT NULL THEN
    IF abs(NEW.total_price_cents - public._money_to_cents(NEW.total_price)) > 1 THEN
      RAISE EXCEPTION 'money_sync_orders: total_price % disagrees with total_price_cents % (drift > 1 cent)',
        NEW.total_price, NEW.total_price_cents
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- ── order_items ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._money_sync_order_items()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- unit_price ↔ unit_price_cents
  IF TG_OP = 'UPDATE'
     AND NEW.unit_price IS DISTINCT FROM OLD.unit_price
     AND NEW.unit_price_cents IS NOT DISTINCT FROM OLD.unit_price_cents THEN
    NEW.unit_price_cents := public._money_to_cents(NEW.unit_price);
  ELSIF TG_OP = 'UPDATE'
     AND NEW.unit_price_cents IS DISTINCT FROM OLD.unit_price_cents
     AND NEW.unit_price IS NOT DISTINCT FROM OLD.unit_price THEN
    NEW.unit_price := (NEW.unit_price_cents::numeric) / 100;
  ELSIF NEW.unit_price_cents IS NULL AND NEW.unit_price IS NOT NULL THEN
    NEW.unit_price_cents := public._money_to_cents(NEW.unit_price);
  ELSIF NEW.unit_price_cents IS NOT NULL AND NEW.unit_price IS NULL THEN
    NEW.unit_price := (NEW.unit_price_cents::numeric) / 100;
  END IF;

  -- total_price ↔ total_price_cents
  IF TG_OP = 'UPDATE'
     AND NEW.total_price IS DISTINCT FROM OLD.total_price
     AND NEW.total_price_cents IS NOT DISTINCT FROM OLD.total_price_cents THEN
    NEW.total_price_cents := public._money_to_cents(NEW.total_price);
  ELSIF TG_OP = 'UPDATE'
     AND NEW.total_price_cents IS DISTINCT FROM OLD.total_price_cents
     AND NEW.total_price IS NOT DISTINCT FROM OLD.total_price THEN
    NEW.total_price := (NEW.total_price_cents::numeric) / 100;
  ELSIF NEW.total_price_cents IS NULL AND NEW.total_price IS NOT NULL THEN
    NEW.total_price_cents := public._money_to_cents(NEW.total_price);
  ELSIF NEW.total_price_cents IS NOT NULL AND NEW.total_price IS NULL THEN
    NEW.total_price := (NEW.total_price_cents::numeric) / 100;
  END IF;

  -- pharmacy_cost_per_unit ↔ pharmacy_cost_per_unit_cents
  IF TG_OP = 'UPDATE'
     AND NEW.pharmacy_cost_per_unit IS DISTINCT FROM OLD.pharmacy_cost_per_unit
     AND NEW.pharmacy_cost_per_unit_cents IS NOT DISTINCT FROM OLD.pharmacy_cost_per_unit_cents THEN
    NEW.pharmacy_cost_per_unit_cents := public._money_to_cents(NEW.pharmacy_cost_per_unit);
  ELSIF TG_OP = 'UPDATE'
     AND NEW.pharmacy_cost_per_unit_cents IS DISTINCT FROM OLD.pharmacy_cost_per_unit_cents
     AND NEW.pharmacy_cost_per_unit IS NOT DISTINCT FROM OLD.pharmacy_cost_per_unit THEN
    NEW.pharmacy_cost_per_unit := (NEW.pharmacy_cost_per_unit_cents::numeric) / 100;
  ELSIF NEW.pharmacy_cost_per_unit_cents IS NULL AND NEW.pharmacy_cost_per_unit IS NOT NULL THEN
    NEW.pharmacy_cost_per_unit_cents := public._money_to_cents(NEW.pharmacy_cost_per_unit);
  ELSIF NEW.pharmacy_cost_per_unit_cents IS NOT NULL AND NEW.pharmacy_cost_per_unit IS NULL THEN
    NEW.pharmacy_cost_per_unit := (NEW.pharmacy_cost_per_unit_cents::numeric) / 100;
  END IF;

  -- platform_commission_per_unit ↔ platform_commission_per_unit_cents
  IF TG_OP = 'UPDATE'
     AND NEW.platform_commission_per_unit IS DISTINCT FROM OLD.platform_commission_per_unit
     AND NEW.platform_commission_per_unit_cents IS NOT DISTINCT FROM OLD.platform_commission_per_unit_cents THEN
    NEW.platform_commission_per_unit_cents := public._money_to_cents(NEW.platform_commission_per_unit);
  ELSIF TG_OP = 'UPDATE'
     AND NEW.platform_commission_per_unit_cents IS DISTINCT FROM OLD.platform_commission_per_unit_cents
     AND NEW.platform_commission_per_unit IS NOT DISTINCT FROM OLD.platform_commission_per_unit THEN
    NEW.platform_commission_per_unit := (NEW.platform_commission_per_unit_cents::numeric) / 100;
  ELSIF NEW.platform_commission_per_unit_cents IS NULL AND NEW.platform_commission_per_unit IS NOT NULL THEN
    NEW.platform_commission_per_unit_cents := public._money_to_cents(NEW.platform_commission_per_unit);
  ELSIF NEW.platform_commission_per_unit_cents IS NOT NULL AND NEW.platform_commission_per_unit IS NULL THEN
    NEW.platform_commission_per_unit := (NEW.platform_commission_per_unit_cents::numeric) / 100;
  END IF;

  RETURN NEW;
END
$$;

-- ── payments ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._money_sync_payments()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.gross_amount IS DISTINCT FROM OLD.gross_amount
     AND NEW.gross_amount_cents IS NOT DISTINCT FROM OLD.gross_amount_cents THEN
    NEW.gross_amount_cents := public._money_to_cents(NEW.gross_amount);
  ELSIF TG_OP = 'UPDATE'
     AND NEW.gross_amount_cents IS DISTINCT FROM OLD.gross_amount_cents
     AND NEW.gross_amount IS NOT DISTINCT FROM OLD.gross_amount THEN
    NEW.gross_amount := (NEW.gross_amount_cents::numeric) / 100;
  ELSIF NEW.gross_amount_cents IS NULL AND NEW.gross_amount IS NOT NULL THEN
    NEW.gross_amount_cents := public._money_to_cents(NEW.gross_amount);
  ELSIF NEW.gross_amount_cents IS NOT NULL AND NEW.gross_amount IS NULL THEN
    NEW.gross_amount := (NEW.gross_amount_cents::numeric) / 100;
  END IF;
  RETURN NEW;
END
$$;

-- ── commissions ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._money_sync_commissions()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.commission_fixed_amount IS DISTINCT FROM OLD.commission_fixed_amount
     AND NEW.commission_fixed_amount_cents IS NOT DISTINCT FROM OLD.commission_fixed_amount_cents THEN
    NEW.commission_fixed_amount_cents := public._money_to_cents(NEW.commission_fixed_amount);
  ELSIF TG_OP = 'UPDATE'
     AND NEW.commission_fixed_amount_cents IS DISTINCT FROM OLD.commission_fixed_amount_cents
     AND NEW.commission_fixed_amount IS NOT DISTINCT FROM OLD.commission_fixed_amount THEN
    NEW.commission_fixed_amount := (NEW.commission_fixed_amount_cents::numeric) / 100;
  ELSIF NEW.commission_fixed_amount_cents IS NULL AND NEW.commission_fixed_amount IS NOT NULL THEN
    NEW.commission_fixed_amount_cents := public._money_to_cents(NEW.commission_fixed_amount);
  ELSIF NEW.commission_fixed_amount_cents IS NOT NULL AND NEW.commission_fixed_amount IS NULL THEN
    NEW.commission_fixed_amount := (NEW.commission_fixed_amount_cents::numeric) / 100;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.commission_total_amount IS DISTINCT FROM OLD.commission_total_amount
     AND NEW.commission_total_amount_cents IS NOT DISTINCT FROM OLD.commission_total_amount_cents THEN
    NEW.commission_total_amount_cents := public._money_to_cents(NEW.commission_total_amount);
  ELSIF TG_OP = 'UPDATE'
     AND NEW.commission_total_amount_cents IS DISTINCT FROM OLD.commission_total_amount_cents
     AND NEW.commission_total_amount IS NOT DISTINCT FROM OLD.commission_total_amount THEN
    NEW.commission_total_amount := (NEW.commission_total_amount_cents::numeric) / 100;
  ELSIF NEW.commission_total_amount_cents IS NULL AND NEW.commission_total_amount IS NOT NULL THEN
    NEW.commission_total_amount_cents := public._money_to_cents(NEW.commission_total_amount);
  ELSIF NEW.commission_total_amount_cents IS NOT NULL AND NEW.commission_total_amount IS NULL THEN
    NEW.commission_total_amount := (NEW.commission_total_amount_cents::numeric) / 100;
  END IF;
  RETURN NEW;
END
$$;

-- ── transfers ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._money_sync_transfers()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.gross_amount IS DISTINCT FROM OLD.gross_amount
     AND NEW.gross_amount_cents IS NOT DISTINCT FROM OLD.gross_amount_cents THEN
    NEW.gross_amount_cents := public._money_to_cents(NEW.gross_amount);
  ELSIF TG_OP = 'UPDATE'
     AND NEW.gross_amount_cents IS DISTINCT FROM OLD.gross_amount_cents
     AND NEW.gross_amount IS NOT DISTINCT FROM OLD.gross_amount THEN
    NEW.gross_amount := (NEW.gross_amount_cents::numeric) / 100;
  ELSIF NEW.gross_amount_cents IS NULL AND NEW.gross_amount IS NOT NULL THEN
    NEW.gross_amount_cents := public._money_to_cents(NEW.gross_amount);
  ELSIF NEW.gross_amount_cents IS NOT NULL AND NEW.gross_amount IS NULL THEN
    NEW.gross_amount := (NEW.gross_amount_cents::numeric) / 100;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.commission_amount IS DISTINCT FROM OLD.commission_amount
     AND NEW.commission_amount_cents IS NOT DISTINCT FROM OLD.commission_amount_cents THEN
    NEW.commission_amount_cents := public._money_to_cents(NEW.commission_amount);
  ELSIF TG_OP = 'UPDATE'
     AND NEW.commission_amount_cents IS DISTINCT FROM OLD.commission_amount_cents
     AND NEW.commission_amount IS NOT DISTINCT FROM OLD.commission_amount THEN
    NEW.commission_amount := (NEW.commission_amount_cents::numeric) / 100;
  ELSIF NEW.commission_amount_cents IS NULL AND NEW.commission_amount IS NOT NULL THEN
    NEW.commission_amount_cents := public._money_to_cents(NEW.commission_amount);
  ELSIF NEW.commission_amount_cents IS NOT NULL AND NEW.commission_amount IS NULL THEN
    NEW.commission_amount := (NEW.commission_amount_cents::numeric) / 100;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.net_amount IS DISTINCT FROM OLD.net_amount
     AND NEW.net_amount_cents IS NOT DISTINCT FROM OLD.net_amount_cents THEN
    NEW.net_amount_cents := public._money_to_cents(NEW.net_amount);
  ELSIF TG_OP = 'UPDATE'
     AND NEW.net_amount_cents IS DISTINCT FROM OLD.net_amount_cents
     AND NEW.net_amount IS NOT DISTINCT FROM OLD.net_amount THEN
    NEW.net_amount := (NEW.net_amount_cents::numeric) / 100;
  ELSIF NEW.net_amount_cents IS NULL AND NEW.net_amount IS NOT NULL THEN
    NEW.net_amount_cents := public._money_to_cents(NEW.net_amount);
  ELSIF NEW.net_amount_cents IS NOT NULL AND NEW.net_amount IS NULL THEN
    NEW.net_amount := (NEW.net_amount_cents::numeric) / 100;
  END IF;
  RETURN NEW;
END
$$;

-- ── consultant_commissions ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._money_sync_consultant_commissions()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.order_total IS DISTINCT FROM OLD.order_total
     AND NEW.order_total_cents IS NOT DISTINCT FROM OLD.order_total_cents THEN
    NEW.order_total_cents := public._money_to_cents(NEW.order_total);
  ELSIF TG_OP = 'UPDATE'
     AND NEW.order_total_cents IS DISTINCT FROM OLD.order_total_cents
     AND NEW.order_total IS NOT DISTINCT FROM OLD.order_total THEN
    NEW.order_total := (NEW.order_total_cents::numeric) / 100;
  ELSIF NEW.order_total_cents IS NULL AND NEW.order_total IS NOT NULL THEN
    NEW.order_total_cents := public._money_to_cents(NEW.order_total);
  ELSIF NEW.order_total_cents IS NOT NULL AND NEW.order_total IS NULL THEN
    NEW.order_total := (NEW.order_total_cents::numeric) / 100;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.commission_amount IS DISTINCT FROM OLD.commission_amount
     AND NEW.commission_amount_cents IS NOT DISTINCT FROM OLD.commission_amount_cents THEN
    NEW.commission_amount_cents := public._money_to_cents(NEW.commission_amount);
  ELSIF TG_OP = 'UPDATE'
     AND NEW.commission_amount_cents IS DISTINCT FROM OLD.commission_amount_cents
     AND NEW.commission_amount IS NOT DISTINCT FROM OLD.commission_amount THEN
    NEW.commission_amount := (NEW.commission_amount_cents::numeric) / 100;
  ELSIF NEW.commission_amount_cents IS NULL AND NEW.commission_amount IS NOT NULL THEN
    NEW.commission_amount_cents := public._money_to_cents(NEW.commission_amount);
  ELSIF NEW.commission_amount_cents IS NOT NULL AND NEW.commission_amount IS NULL THEN
    NEW.commission_amount := (NEW.commission_amount_cents::numeric) / 100;
  END IF;
  RETURN NEW;
END
$$;

-- ── consultant_transfers ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._money_sync_consultant_transfers()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.gross_amount IS DISTINCT FROM OLD.gross_amount
     AND NEW.gross_amount_cents IS NOT DISTINCT FROM OLD.gross_amount_cents THEN
    NEW.gross_amount_cents := public._money_to_cents(NEW.gross_amount);
  ELSIF TG_OP = 'UPDATE'
     AND NEW.gross_amount_cents IS DISTINCT FROM OLD.gross_amount_cents
     AND NEW.gross_amount IS NOT DISTINCT FROM OLD.gross_amount THEN
    NEW.gross_amount := (NEW.gross_amount_cents::numeric) / 100;
  ELSIF NEW.gross_amount_cents IS NULL AND NEW.gross_amount IS NOT NULL THEN
    NEW.gross_amount_cents := public._money_to_cents(NEW.gross_amount);
  ELSIF NEW.gross_amount_cents IS NOT NULL AND NEW.gross_amount IS NULL THEN
    NEW.gross_amount := (NEW.gross_amount_cents::numeric) / 100;
  END IF;
  RETURN NEW;
END
$$;

-- ── Smoke test ───────────────────────────────────────────────────────────
-- Simulate the production failure path: insert order header, insert
-- coupon-discounted item, watch the AFTER-INSERT recalc trigger fire a
-- single-column UPDATE, assert the money_sync trigger now derives the
-- cents column instead of raising. Rolled back so production data is
-- untouched.
DO $smoke$
DECLARE
  v_order_id     uuid;
  v_clinic_id    uuid;
  v_pharmacy_id  uuid;
  v_product_id   uuid;
  v_user_id      uuid;
  v_coupon_id    uuid;
  v_item_id      uuid;
  v_total        numeric(15,2);
  v_total_cents  bigint;
BEGIN
  SELECT id INTO v_clinic_id   FROM public.clinics    LIMIT 1;
  SELECT id INTO v_pharmacy_id FROM public.pharmacies LIMIT 1;
  SELECT id, pharmacy_id INTO v_product_id, v_pharmacy_id FROM public.products WHERE active LIMIT 1;
  SELECT id INTO v_user_id     FROM public.profiles  LIMIT 1;

  IF v_clinic_id IS NULL OR v_product_id IS NULL OR v_user_id IS NULL THEN
    RAISE NOTICE 'Migration 061 smoke skipped (no fixture rows in clinics/products/profiles).';
    RETURN;
  END IF;

  -- Insert a synthetic active coupon scoped to this clinic+product so
  -- the freeze trigger applies a 5% discount inside the sub-transaction.
  -- Subtransaction (BEGIN/EXCEPTION/END) wraps the smoke so we always
  -- roll back regardless of outcome.
  BEGIN
    INSERT INTO public.coupons (
      code, product_id, clinic_id, discount_type, discount_value,
      activated_at, active, created_by_user_id
    ) VALUES (
      'M061-SMOKE-' || substr(gen_random_uuid()::text, 1, 8),
      v_product_id, v_clinic_id, 'PERCENT', 5,
      now(), true, v_user_id
    ) RETURNING id INTO v_coupon_id;

    INSERT INTO public.orders (
      buyer_type, clinic_id, pharmacy_id, total_price,
      order_status, payment_status, transfer_status, created_by_user_id, code
    ) VALUES (
      'CLINIC', v_clinic_id, v_pharmacy_id, 100.00,
      'AWAITING_DOCUMENTS', 'PENDING', 'NOT_READY', v_user_id, ''
    ) RETURNING id INTO v_order_id;

    -- This is the path that raised P0001 before the fix.
    INSERT INTO public.order_items (
      order_id, product_id, quantity, unit_price, total_price, coupon_id
    ) VALUES (
      v_order_id, v_product_id, 1, 100.00, 100.00, v_coupon_id
    ) RETURNING id INTO v_item_id;

    -- The recalc trigger should have synced both columns of orders.total_price.
    SELECT total_price, total_price_cents INTO v_total, v_total_cents
      FROM public.orders WHERE id = v_order_id;

    IF v_total IS NULL OR v_total_cents IS NULL THEN
      RAISE EXCEPTION 'Migration 061 smoke: orders.total_price=% / cents=% — one of them is NULL', v_total, v_total_cents;
    END IF;
    IF abs(v_total_cents - public._money_to_cents(v_total)) > 1 THEN
      RAISE EXCEPTION 'Migration 061 smoke: drift % cents after recalc (numeric=%, cents=%)',
        abs(v_total_cents - public._money_to_cents(v_total)), v_total, v_total_cents;
    END IF;

    RAISE NOTICE 'Migration 061 smoke passed (order_items+coupon insert path no longer raises; numeric=% cents=%)',
      v_total, v_total_cents;

    -- Roll back the smoke writes (deleting the order cascades to
    -- order_items via FK ON DELETE CASCADE; coupon must be deleted
    -- explicitly).
    DELETE FROM public.orders  WHERE id = v_order_id;
    DELETE FROM public.coupons WHERE id = v_coupon_id;
  EXCEPTION WHEN OTHERS THEN
    -- Best-effort cleanup before rethrowing.
    BEGIN DELETE FROM public.orders  WHERE id = v_order_id; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN DELETE FROM public.coupons WHERE id = v_coupon_id; EXCEPTION WHEN OTHERS THEN NULL; END;
    RAISE;
  END;
END
$smoke$;
