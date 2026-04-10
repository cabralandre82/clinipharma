-- ── Audit 5: DB constraints ───────────────────────────────────────────────────
-- Applied: 2026-04-08

-- ── 1. pharmacy_cost must not exceed the client-facing price ─────────────────
--    Both columns live in public.products (added in migration 005)
ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS chk_products_pharmacy_cost_lte_price;

ALTER TABLE public.products
  ADD CONSTRAINT chk_products_pharmacy_cost_lte_price
    CHECK (pharmacy_cost <= price_current);

-- ── 2. price_current must be strictly positive (extends existing >= 0 check) ──
--    price_current >= 0 already exists from migration 001; add a stricter check
--    only if the existing constraint is different.
--    We add a named constraint so it can be dropped cleanly in the future.
ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS chk_products_price_positive;

ALTER TABLE public.products
  ADD CONSTRAINT chk_products_price_positive
    CHECK (price_current > 0);

-- ── 3. Prevent negative amounts in financial tables ───────────────────────────
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS chk_payments_gross_amount_positive;
ALTER TABLE public.payments
  ADD CONSTRAINT chk_payments_gross_amount_positive
    CHECK (gross_amount > 0);

ALTER TABLE public.transfers
  DROP CONSTRAINT IF EXISTS chk_transfers_net_amount_positive;
ALTER TABLE public.transfers
  ADD CONSTRAINT chk_transfers_net_amount_positive
    CHECK (net_amount >= 0);

ALTER TABLE public.transfers
  DROP CONSTRAINT IF EXISTS chk_transfers_gross_amount_positive;
ALTER TABLE public.transfers
  ADD CONSTRAINT chk_transfers_gross_amount_positive
    CHECK (gross_amount > 0);

-- ── 4. consultant_transfers: gross_amount must be positive ────────────────────
ALTER TABLE public.consultant_transfers
  DROP CONSTRAINT IF EXISTS chk_consultant_transfers_gross_positive;
ALTER TABLE public.consultant_transfers
  ADD CONSTRAINT chk_consultant_transfers_gross_positive
    CHECK (gross_amount > 0);

-- ── 5. consultant_commissions: commission_amount must be non-negative ─────────
ALTER TABLE public.consultant_commissions
  DROP CONSTRAINT IF EXISTS chk_commission_amount_non_negative;
ALTER TABLE public.consultant_commissions
  ADD CONSTRAINT chk_commission_amount_non_negative
    CHECK (commission_amount >= 0);

-- ── 6. order_items: quantity and unit_price must be sane ─────────────────────
ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS chk_order_items_quantity_positive;
ALTER TABLE public.order_items
  ADD CONSTRAINT chk_order_items_quantity_positive
    CHECK (quantity > 0);

ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS chk_order_items_unit_price_non_negative;
ALTER TABLE public.order_items
  ADD CONSTRAINT chk_order_items_unit_price_non_negative
    CHECK (unit_price >= 0);

-- ── 7. PROCESSING status for consultant_commissions (needed for atomic guard) ─
ALTER TABLE public.consultant_commissions
  DROP CONSTRAINT IF EXISTS chk_commission_status;

ALTER TABLE public.consultant_commissions
  ADD CONSTRAINT chk_commission_status
    CHECK (status IN ('PENDING', 'PROCESSING', 'PAID', 'CANCELLED'));

-- ── 8. Expand consultant_commissions status to include PROCESSING ─────────────
--    Required by the atomic double-payment guard in services/consultants.ts
ALTER TABLE public.consultant_commissions
  DROP CONSTRAINT IF EXISTS consultant_commissions_status_check;

ALTER TABLE public.consultant_commissions
  ADD CONSTRAINT consultant_commissions_status_check
    CHECK (status IN ('PENDING', 'PROCESSING', 'TRANSFER_PENDING', 'PAID', 'CANCELLED'));
