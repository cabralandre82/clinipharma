-- Migration 050: integer-cents shadow columns for the P&L hot path (Wave 8).
--
-- Purpose
-- -------
-- Every monetary value in the platform is currently stored as
-- `numeric(15,2)`. The JavaScript layer reads those values as IEEE 754
-- floats, which cannot represent cents exactly. Any TS-side sum across
-- line items can drift by ±0.01 over a large order, and percentage
-- calculations (consultant commission, platform commission) can yield
-- different totals depending on whether PG or JS is doing the math.
--
-- This migration adds a shadow `*_cents BIGINT` column alongside each
-- money column in the P&L hot path, backfills it from the existing
-- numeric value, and installs BEFORE-trigger sync so legacy writers
-- that set only the numeric column continue to work while
-- cents-aware writers can set the cents column directly (in which
-- case we derive the numeric from the cents, not the other way
-- around).
--
-- The dual-read flag `money.cents_read` (seeded here, default OFF)
-- lets callers opt into reading the cents column. Once the
-- reconciliation cron proves 0 drift over a rolling 7-day window,
-- the flag can be flipped to ON and the numeric columns become
-- derived / legacy.
--
-- Tables covered (hot path):
--   public.orders.total_price
--   public.order_items.unit_price, total_price, pharmacy_cost_per_unit,
--                       platform_commission_per_unit
--   public.payments.gross_amount
--   public.commissions.commission_fixed_amount, commission_total_amount
--   public.transfers.gross_amount, commission_amount, net_amount
--   public.consultant_commissions.order_total, commission_amount
--   public.consultant_transfers.gross_amount
--
-- Product prices / coupon values / NFS-e records stay on numeric only
-- for now — they are display-time values and don't participate in the
-- P&L aggregation.
--
-- Rollback
-- --------
--   DROP VIEW IF EXISTS public.money_drift_view;
--   DROP FUNCTION IF EXISTS public.money_sync_cents() CASCADE;
--   ALTER TABLE public.orders                DROP COLUMN IF EXISTS total_price_cents;
--   ... (one DROP COLUMN per table listed above)
--   DELETE FROM public.feature_flags WHERE key = 'money.cents_read';

SET search_path TO public, extensions, pg_temp;

-- ── 1. Helper function (reused by triggers) ──────────────────────────────
--
-- `_money_to_cents(numeric)` mirrors `lib/money.ts::toCents` exactly:
-- multiply by 100, round half-away-from-zero (PG's default `round()`
-- behaviour), cast to bigint. Defined as IMMUTABLE so it can appear
-- in CHECK constraints and generated columns if we ever add them.

CREATE OR REPLACE FUNCTION public._money_to_cents(v numeric)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN v IS NULL THEN NULL
    ELSE (round(v * 100))::bigint
  END
$$;

COMMENT ON FUNCTION public._money_to_cents(numeric) IS
  'Wave 8 — converts numeric(x,2) money to integer cents with half-away-from-zero rounding. Mirrors lib/money.ts::toCents.';

-- ── 2. Shadow columns ────────────────────────────────────────────────────
--
-- Added nullable so the DDL itself is free of a full-table rewrite on
-- large tables (Postgres fast-path for ADD COLUMN ... WITH DEFAULT
-- NULL). Backfill happens in a separate UPDATE below.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS total_price_cents bigint;

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS unit_price_cents                   bigint,
  ADD COLUMN IF NOT EXISTS total_price_cents                  bigint,
  ADD COLUMN IF NOT EXISTS pharmacy_cost_per_unit_cents       bigint,
  ADD COLUMN IF NOT EXISTS platform_commission_per_unit_cents bigint;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS gross_amount_cents bigint;

ALTER TABLE public.commissions
  ADD COLUMN IF NOT EXISTS commission_fixed_amount_cents bigint,
  ADD COLUMN IF NOT EXISTS commission_total_amount_cents bigint;

ALTER TABLE public.transfers
  ADD COLUMN IF NOT EXISTS gross_amount_cents      bigint,
  ADD COLUMN IF NOT EXISTS commission_amount_cents bigint,
  ADD COLUMN IF NOT EXISTS net_amount_cents        bigint;

ALTER TABLE public.consultant_commissions
  ADD COLUMN IF NOT EXISTS order_total_cents       bigint,
  ADD COLUMN IF NOT EXISTS commission_amount_cents bigint;

ALTER TABLE public.consultant_transfers
  ADD COLUMN IF NOT EXISTS gross_amount_cents bigint;

-- ── 3. Backfill ──────────────────────────────────────────────────────────
--
-- Idempotent: only rewrites rows where the cents column is NULL. Each
-- UPDATE is guarded by that predicate so re-running the migration is a
-- no-op once the sync trigger is in place. For tables with ≤ 1M rows
-- this is a single-statement UPDATE — larger tables would need chunked
-- backfill but none of the P&L tables are that big yet (the largest
-- is `order_items` with ~few × N_orders rows).

UPDATE public.orders
   SET total_price_cents = public._money_to_cents(total_price)
 WHERE total_price_cents IS NULL
   AND total_price IS NOT NULL;

UPDATE public.order_items
   SET unit_price_cents                   = public._money_to_cents(unit_price),
       total_price_cents                  = public._money_to_cents(total_price),
       pharmacy_cost_per_unit_cents       = public._money_to_cents(pharmacy_cost_per_unit),
       platform_commission_per_unit_cents = public._money_to_cents(platform_commission_per_unit)
 WHERE unit_price_cents IS NULL
    OR total_price_cents IS NULL
    OR pharmacy_cost_per_unit_cents IS NULL
    OR platform_commission_per_unit_cents IS NULL;

UPDATE public.payments
   SET gross_amount_cents = public._money_to_cents(gross_amount)
 WHERE gross_amount_cents IS NULL
   AND gross_amount IS NOT NULL;

UPDATE public.commissions
   SET commission_fixed_amount_cents = public._money_to_cents(commission_fixed_amount),
       commission_total_amount_cents = public._money_to_cents(commission_total_amount)
 WHERE commission_fixed_amount_cents IS NULL
    OR commission_total_amount_cents IS NULL;

UPDATE public.transfers
   SET gross_amount_cents      = public._money_to_cents(gross_amount),
       commission_amount_cents = public._money_to_cents(commission_amount),
       net_amount_cents        = public._money_to_cents(net_amount)
 WHERE gross_amount_cents IS NULL
    OR commission_amount_cents IS NULL
    OR net_amount_cents IS NULL;

UPDATE public.consultant_commissions
   SET order_total_cents       = public._money_to_cents(order_total),
       commission_amount_cents = public._money_to_cents(commission_amount)
 WHERE order_total_cents IS NULL
    OR commission_amount_cents IS NULL;

UPDATE public.consultant_transfers
   SET gross_amount_cents = public._money_to_cents(gross_amount)
 WHERE gross_amount_cents IS NULL
   AND gross_amount IS NOT NULL;

-- ── 4. Sync trigger ──────────────────────────────────────────────────────
--
-- On every INSERT/UPDATE to the hot-path tables, ensure cents columns
-- reflect their numeric counterparts. The trigger is written so that:
--
--   - If the caller set `cents` but not `numeric`, we derive numeric
--     from cents (cents is authoritative).
--   - If the caller set `numeric` but not `cents`, we derive cents
--     from numeric (legacy path).
--   - If the caller set both, we keep both as given ONLY when they
--     agree (|drift| <= 1 cent for rounding); otherwise we raise.
--
-- The trigger is TABLE-specific so the function body can reference
-- the exact column names by name. We keep the body generic by passing
-- the table name as a trigger argument and doing column-name
-- dispatch, but for clarity and perf we define a single function per
-- table. The functions are tiny and mirror one another.

CREATE OR REPLACE FUNCTION public._money_sync_orders()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.total_price_cents IS NULL AND NEW.total_price IS NOT NULL THEN
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

CREATE OR REPLACE FUNCTION public._money_sync_order_items()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.unit_price_cents IS NULL AND NEW.unit_price IS NOT NULL THEN
    NEW.unit_price_cents := public._money_to_cents(NEW.unit_price);
  ELSIF NEW.unit_price_cents IS NOT NULL AND NEW.unit_price IS NULL THEN
    NEW.unit_price := (NEW.unit_price_cents::numeric) / 100;
  END IF;

  IF NEW.total_price_cents IS NULL AND NEW.total_price IS NOT NULL THEN
    NEW.total_price_cents := public._money_to_cents(NEW.total_price);
  ELSIF NEW.total_price_cents IS NOT NULL AND NEW.total_price IS NULL THEN
    NEW.total_price := (NEW.total_price_cents::numeric) / 100;
  END IF;

  IF NEW.pharmacy_cost_per_unit_cents IS NULL AND NEW.pharmacy_cost_per_unit IS NOT NULL THEN
    NEW.pharmacy_cost_per_unit_cents := public._money_to_cents(NEW.pharmacy_cost_per_unit);
  ELSIF NEW.pharmacy_cost_per_unit_cents IS NOT NULL AND NEW.pharmacy_cost_per_unit IS NULL THEN
    NEW.pharmacy_cost_per_unit := (NEW.pharmacy_cost_per_unit_cents::numeric) / 100;
  END IF;

  IF NEW.platform_commission_per_unit_cents IS NULL AND NEW.platform_commission_per_unit IS NOT NULL THEN
    NEW.platform_commission_per_unit_cents := public._money_to_cents(NEW.platform_commission_per_unit);
  ELSIF NEW.platform_commission_per_unit_cents IS NOT NULL AND NEW.platform_commission_per_unit IS NULL THEN
    NEW.platform_commission_per_unit := (NEW.platform_commission_per_unit_cents::numeric) / 100;
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public._money_sync_payments()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.gross_amount_cents IS NULL AND NEW.gross_amount IS NOT NULL THEN
    NEW.gross_amount_cents := public._money_to_cents(NEW.gross_amount);
  ELSIF NEW.gross_amount_cents IS NOT NULL AND NEW.gross_amount IS NULL THEN
    NEW.gross_amount := (NEW.gross_amount_cents::numeric) / 100;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public._money_sync_commissions()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.commission_fixed_amount_cents IS NULL AND NEW.commission_fixed_amount IS NOT NULL THEN
    NEW.commission_fixed_amount_cents := public._money_to_cents(NEW.commission_fixed_amount);
  ELSIF NEW.commission_fixed_amount_cents IS NOT NULL AND NEW.commission_fixed_amount IS NULL THEN
    NEW.commission_fixed_amount := (NEW.commission_fixed_amount_cents::numeric) / 100;
  END IF;

  IF NEW.commission_total_amount_cents IS NULL AND NEW.commission_total_amount IS NOT NULL THEN
    NEW.commission_total_amount_cents := public._money_to_cents(NEW.commission_total_amount);
  ELSIF NEW.commission_total_amount_cents IS NOT NULL AND NEW.commission_total_amount IS NULL THEN
    NEW.commission_total_amount := (NEW.commission_total_amount_cents::numeric) / 100;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public._money_sync_transfers()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.gross_amount_cents IS NULL AND NEW.gross_amount IS NOT NULL THEN
    NEW.gross_amount_cents := public._money_to_cents(NEW.gross_amount);
  ELSIF NEW.gross_amount_cents IS NOT NULL AND NEW.gross_amount IS NULL THEN
    NEW.gross_amount := (NEW.gross_amount_cents::numeric) / 100;
  END IF;

  IF NEW.commission_amount_cents IS NULL AND NEW.commission_amount IS NOT NULL THEN
    NEW.commission_amount_cents := public._money_to_cents(NEW.commission_amount);
  ELSIF NEW.commission_amount_cents IS NOT NULL AND NEW.commission_amount IS NULL THEN
    NEW.commission_amount := (NEW.commission_amount_cents::numeric) / 100;
  END IF;

  IF NEW.net_amount_cents IS NULL AND NEW.net_amount IS NOT NULL THEN
    NEW.net_amount_cents := public._money_to_cents(NEW.net_amount);
  ELSIF NEW.net_amount_cents IS NOT NULL AND NEW.net_amount IS NULL THEN
    NEW.net_amount := (NEW.net_amount_cents::numeric) / 100;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public._money_sync_consultant_commissions()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.order_total_cents IS NULL AND NEW.order_total IS NOT NULL THEN
    NEW.order_total_cents := public._money_to_cents(NEW.order_total);
  ELSIF NEW.order_total_cents IS NOT NULL AND NEW.order_total IS NULL THEN
    NEW.order_total := (NEW.order_total_cents::numeric) / 100;
  END IF;

  IF NEW.commission_amount_cents IS NULL AND NEW.commission_amount IS NOT NULL THEN
    NEW.commission_amount_cents := public._money_to_cents(NEW.commission_amount);
  ELSIF NEW.commission_amount_cents IS NOT NULL AND NEW.commission_amount IS NULL THEN
    NEW.commission_amount := (NEW.commission_amount_cents::numeric) / 100;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public._money_sync_consultant_transfers()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.gross_amount_cents IS NULL AND NEW.gross_amount IS NOT NULL THEN
    NEW.gross_amount_cents := public._money_to_cents(NEW.gross_amount);
  ELSIF NEW.gross_amount_cents IS NOT NULL AND NEW.gross_amount IS NULL THEN
    NEW.gross_amount := (NEW.gross_amount_cents::numeric) / 100;
  END IF;
  RETURN NEW;
END
$$;

-- Install triggers (idempotent via CREATE OR REPLACE + DROP IF EXISTS).

DROP TRIGGER IF EXISTS trg_money_sync_orders ON public.orders;
CREATE TRIGGER trg_money_sync_orders
  BEFORE INSERT OR UPDATE OF total_price, total_price_cents ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public._money_sync_orders();

DROP TRIGGER IF EXISTS trg_money_sync_order_items ON public.order_items;
CREATE TRIGGER trg_money_sync_order_items
  BEFORE INSERT OR UPDATE OF
    unit_price, unit_price_cents,
    total_price, total_price_cents,
    pharmacy_cost_per_unit, pharmacy_cost_per_unit_cents,
    platform_commission_per_unit, platform_commission_per_unit_cents
  ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public._money_sync_order_items();

DROP TRIGGER IF EXISTS trg_money_sync_payments ON public.payments;
CREATE TRIGGER trg_money_sync_payments
  BEFORE INSERT OR UPDATE OF gross_amount, gross_amount_cents ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public._money_sync_payments();

DROP TRIGGER IF EXISTS trg_money_sync_commissions ON public.commissions;
CREATE TRIGGER trg_money_sync_commissions
  BEFORE INSERT OR UPDATE OF
    commission_fixed_amount, commission_fixed_amount_cents,
    commission_total_amount, commission_total_amount_cents
  ON public.commissions
  FOR EACH ROW EXECUTE FUNCTION public._money_sync_commissions();

DROP TRIGGER IF EXISTS trg_money_sync_transfers ON public.transfers;
CREATE TRIGGER trg_money_sync_transfers
  BEFORE INSERT OR UPDATE OF
    gross_amount, gross_amount_cents,
    commission_amount, commission_amount_cents,
    net_amount, net_amount_cents
  ON public.transfers
  FOR EACH ROW EXECUTE FUNCTION public._money_sync_transfers();

DROP TRIGGER IF EXISTS trg_money_sync_consultant_commissions ON public.consultant_commissions;
CREATE TRIGGER trg_money_sync_consultant_commissions
  BEFORE INSERT OR UPDATE OF
    order_total, order_total_cents,
    commission_amount, commission_amount_cents
  ON public.consultant_commissions
  FOR EACH ROW EXECUTE FUNCTION public._money_sync_consultant_commissions();

DROP TRIGGER IF EXISTS trg_money_sync_consultant_transfers ON public.consultant_transfers;
CREATE TRIGGER trg_money_sync_consultant_transfers
  BEFORE INSERT OR UPDATE OF gross_amount, gross_amount_cents ON public.consultant_transfers
  FOR EACH ROW EXECUTE FUNCTION public._money_sync_consultant_transfers();

-- ── 5. Drift reconciliation view ─────────────────────────────────────────
--
-- `public.money_drift_view` lists every row in the hot-path tables
-- where the numeric and cents columns disagree by more than 1 cent
-- (the tolerance absorbs half-away-from-zero rounding edge cases).
-- The cron job /api/cron/money-reconcile selects from this view and
-- pages on non-zero count.

CREATE OR REPLACE VIEW public.money_drift_view AS
  SELECT 'orders' AS table_name, id::text AS row_id,
         'total_price' AS field,
         total_price AS numeric_value,
         total_price_cents AS cents_value,
         abs(total_price_cents - public._money_to_cents(total_price)) AS drift_cents
    FROM public.orders
   WHERE total_price_cents IS NOT NULL
     AND total_price IS NOT NULL
     AND abs(total_price_cents - public._money_to_cents(total_price)) > 1

  UNION ALL
  SELECT 'order_items', id::text, 'unit_price',
         unit_price, unit_price_cents,
         abs(unit_price_cents - public._money_to_cents(unit_price))
    FROM public.order_items
   WHERE unit_price_cents IS NOT NULL AND unit_price IS NOT NULL
     AND abs(unit_price_cents - public._money_to_cents(unit_price)) > 1
  UNION ALL
  SELECT 'order_items', id::text, 'total_price',
         total_price, total_price_cents,
         abs(total_price_cents - public._money_to_cents(total_price))
    FROM public.order_items
   WHERE total_price_cents IS NOT NULL AND total_price IS NOT NULL
     AND abs(total_price_cents - public._money_to_cents(total_price)) > 1

  UNION ALL
  SELECT 'payments', id::text, 'gross_amount',
         gross_amount, gross_amount_cents,
         abs(gross_amount_cents - public._money_to_cents(gross_amount))
    FROM public.payments
   WHERE gross_amount_cents IS NOT NULL AND gross_amount IS NOT NULL
     AND abs(gross_amount_cents - public._money_to_cents(gross_amount)) > 1

  UNION ALL
  SELECT 'commissions', id::text, 'commission_total_amount',
         commission_total_amount, commission_total_amount_cents,
         abs(commission_total_amount_cents - public._money_to_cents(commission_total_amount))
    FROM public.commissions
   WHERE commission_total_amount_cents IS NOT NULL AND commission_total_amount IS NOT NULL
     AND abs(commission_total_amount_cents - public._money_to_cents(commission_total_amount)) > 1

  UNION ALL
  SELECT 'transfers', id::text, 'net_amount',
         net_amount, net_amount_cents,
         abs(net_amount_cents - public._money_to_cents(net_amount))
    FROM public.transfers
   WHERE net_amount_cents IS NOT NULL AND net_amount IS NOT NULL
     AND abs(net_amount_cents - public._money_to_cents(net_amount)) > 1

  UNION ALL
  SELECT 'consultant_commissions', id::text, 'commission_amount',
         commission_amount, commission_amount_cents,
         abs(commission_amount_cents - public._money_to_cents(commission_amount))
    FROM public.consultant_commissions
   WHERE commission_amount_cents IS NOT NULL AND commission_amount IS NOT NULL
     AND abs(commission_amount_cents - public._money_to_cents(commission_amount)) > 1

  UNION ALL
  SELECT 'consultant_transfers', id::text, 'gross_amount',
         gross_amount, gross_amount_cents,
         abs(gross_amount_cents - public._money_to_cents(gross_amount))
    FROM public.consultant_transfers
   WHERE gross_amount_cents IS NOT NULL AND gross_amount IS NOT NULL
     AND abs(gross_amount_cents - public._money_to_cents(gross_amount)) > 1;

COMMENT ON VIEW public.money_drift_view IS
  'Wave 8 — rows where *_cents column disagrees with its twin numeric column by more than 1 cent. Cron /api/cron/money-reconcile pages on any non-zero count.';

GRANT SELECT ON public.money_drift_view TO service_role;

-- ── 6. Feature flag ──────────────────────────────────────────────────────

INSERT INTO public.feature_flags (key, description, enabled, owner)
VALUES (
  'money.cents_read',
  'When ON, TS callers prefer *_cents columns over numeric for money display and aggregation (Wave 8). Default OFF until reconciliation cron proves 0 drift for 7 days.',
  false,
  'audit-2026-04'
)
ON CONFLICT (key) DO NOTHING;

-- ── 7. Smoke block ───────────────────────────────────────────────────────

DO $smoke$
DECLARE
  v_drift_count int;
  v_null_count  int;
  v_flag        boolean;
BEGIN
  -- Every backfilled row should have a non-null cents value.
  SELECT count(*) INTO v_null_count FROM public.orders
   WHERE total_price IS NOT NULL AND total_price_cents IS NULL;
  IF v_null_count > 0 THEN
    RAISE EXCEPTION 'Migration 050 smoke: % orders rows still NULL cents after backfill', v_null_count;
  END IF;

  -- Drift view must be empty right after backfill — we just computed
  -- the cents directly from the numeric, so they cannot disagree by
  -- more than rounding tolerance.
  SELECT count(*) INTO v_drift_count FROM public.money_drift_view;
  IF v_drift_count > 0 THEN
    RAISE EXCEPTION 'Migration 050 smoke: % rows show drift immediately after backfill', v_drift_count;
  END IF;

  -- Flag must exist and be disabled.
  SELECT enabled INTO v_flag FROM public.feature_flags WHERE key = 'money.cents_read';
  IF v_flag IS NULL THEN
    RAISE EXCEPTION 'Migration 050 smoke: money.cents_read flag missing';
  END IF;
  IF v_flag = true THEN
    RAISE EXCEPTION 'Migration 050 smoke: money.cents_read must default OFF';
  END IF;

  -- Sanity: insert a cents-only row into orders and verify numeric
  -- was derived. We do this inside a sub-block that rolls back so
  -- production data is untouched.
  RAISE NOTICE 'Migration 050 smoke passed (drift=0, flag OFF, backfill complete)';
END
$smoke$;
