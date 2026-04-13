-- Migration 036: Add needs_price_review flag to products
--
-- Set to TRUE  when pharmacy updates pharmacy_cost (any tier).
-- Set to FALSE when platform admin updates price_current via updateProductPrice.
-- Dashboard card counts products WHERE needs_price_review = TRUE.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS needs_price_review boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_products_needs_price_review
  ON public.products (needs_price_review)
  WHERE needs_price_review = true;
