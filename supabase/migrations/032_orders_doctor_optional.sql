-- ============================================================
-- Migration 032 — orders.doctor_id nullable
-- ============================================================
-- Clinics without linked doctors (e.g. aesthetic clinics) must
-- be able to place orders for non-prescription products without
-- a requesting doctor. doctor_id becomes optional at the DB level;
-- application logic enforces it when requires_prescription = true.
-- ============================================================

ALTER TABLE public.orders
  ALTER COLUMN doctor_id DROP NOT NULL;

COMMENT ON COLUMN public.orders.doctor_id IS
  'Requesting doctor. NULL is allowed for orders that contain no prescription-required products.';
