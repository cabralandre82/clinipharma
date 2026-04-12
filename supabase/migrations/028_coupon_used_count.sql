-- ============================================================
-- 028 — Melhorias nos cupons de desconto
-- ============================================================
-- 1. Contador de usos por cupom
-- 2. Trigger atualizado para incrementar o contador atomicamente
-- ============================================================

-- 1. Coluna de contador de usos
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS used_count integer NOT NULL DEFAULT 0;

-- 2. Recria a função do trigger com incremento atômico de used_count
CREATE OR REPLACE FUNCTION public.freeze_order_item_price()
RETURNS TRIGGER AS $$
DECLARE
  v_price          numeric(12, 2);
  v_pharmacy_cost  numeric(12, 2);
  v_disc_type      text;
  v_disc_value     numeric(10, 4);
  v_max_disc       numeric(10, 2);
  v_discount       numeric(12, 2) := 0;
BEGIN
  SELECT price_current, pharmacy_cost
  INTO   v_price, v_pharmacy_cost
  FROM   public.products
  WHERE  id = NEW.product_id;

  NEW.unit_price                   := v_price;
  NEW.original_total_price         := v_price * NEW.quantity;
  NEW.pharmacy_cost_per_unit       := v_pharmacy_cost;
  NEW.platform_commission_per_unit := v_price - v_pharmacy_cost;

  IF NEW.coupon_id IS NOT NULL THEN
    SELECT discount_type, discount_value, max_discount_amount
    INTO   v_disc_type, v_disc_value, v_max_disc
    FROM   public.coupons
    WHERE  id           = NEW.coupon_id
      AND  active       = true
      AND  activated_at IS NOT NULL
      AND  (valid_until IS NULL OR valid_until >= now());

    IF FOUND THEN
      IF v_disc_type = 'PERCENT' THEN
        v_discount := ROUND((v_price * v_disc_value / 100.0) * NEW.quantity, 2);
        IF v_max_disc IS NOT NULL THEN
          v_discount := LEAST(v_discount, v_max_disc);
        END IF;
      ELSE
        v_discount := ROUND(LEAST(v_disc_value, v_price) * NEW.quantity, 2);
      END IF;

      -- Incrementa contador de usos atomicamente
      UPDATE public.coupons
      SET used_count = used_count + 1
      WHERE id = NEW.coupon_id;
    ELSE
      NEW.coupon_id := NULL;
    END IF;
  END IF;

  NEW.discount_amount := v_discount;
  NEW.total_price     := NEW.original_total_price - v_discount;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
