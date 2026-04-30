-- Migration 072 — Tiered branch in freeze_order_item_price (PR-A do ADR-001).
--
-- Visão
-- -----
-- Adiciona um IF/ELSE no trigger BEFORE INSERT em order_items.
-- Comportamento:
--
--   products.pricing_mode = 'FIXED' (default)         → caminho legado intacto.
--   products.pricing_mode = 'TIERED_PROFILE'          → motor compute_unit_price.
--
-- O ramo legado é literalmente o corpo da migration 067 (cents-sync
-- fix), copiado sem alterações. O ramo novo:
--
--   1. Carrega clinic_id/doctor_id do order pai (compute_unit_price
--      precisa para preparar PR-B com buyer overrides).
--   2. Chama compute_unit_price.
--   3. Se a função retorna {error: ...}, falha o INSERT com mensagem
--      legível — pricing_mode = TIERED_PROFILE sem profile vivo é
--      configuração inconsistente, não pode escalar até order_status.
--   4. Materializa as 8 colunas (4 numeric + 4 _cents) + pricing_profile_id +
--      coupon_id (NULL se compute determinou cupom inválido).
--   5. Incrementa coupons.used_count APENAS se compute aceitou o cupom.
--
-- INV-1 (pharmacy_transfer >= sum(pharmacy_cost × qty)) — preservada por
-- construção: pharmacy_cost_per_unit_cents = profile.pharmacy_cost_unit_cents.
--
-- INV-2 (final >= floor) — preservada por compute_unit_price (cap silencioso
-- aplicado no desconto).
--
-- INV-3 (total = pharmacy + platform [+ consultant]) — preservada porque
-- platform_commission_per_unit_cents = final - pharmacy, e final*qty = total.
--
-- INV-4 — runtime cap está em compute_unit_price; defesa adicional em
-- confirm_payment_atomic (mig-073).
--
-- Rollback
-- --------
-- Re-aplicar o corpo da migration 067 via CREATE OR REPLACE. O ramo
-- TIERED_PROFILE simplesmente desaparece (produtos com pricing_mode =
-- TIERED_PROFILE precisam ser revertidos para FIXED antes; alternativa:
-- bloquear novos pedidos via app_settings.kill_switch).

SET search_path TO public, pg_temp;

CREATE OR REPLACE FUNCTION public.freeze_order_item_price()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_pricing_mode  text;

  -- Legacy (FIXED) locals
  v_price          numeric(12, 2);
  v_pharmacy_cost  numeric(12, 2);
  v_disc_type      text;
  v_disc_value     numeric(10, 4);
  v_max_disc       numeric(10, 2);
  v_discount       numeric(12, 2) := 0;

  -- Tiered locals
  v_clinic_id     uuid;
  v_doctor_id     uuid;
  v_breakdown     jsonb;
  v_final_cents   bigint;
  v_tier_cents    bigint;
  v_pharm_cents   bigint;
  v_plat_cents    bigint;
  v_profile_id    uuid;
  v_resolved_coupon_id uuid;
  v_quantity      int;
BEGIN
  SELECT pricing_mode INTO v_pricing_mode
    FROM public.products
   WHERE id = NEW.product_id;

  IF v_pricing_mode = 'TIERED_PROFILE' THEN
    SELECT clinic_id, doctor_id INTO v_clinic_id, v_doctor_id
      FROM public.orders WHERE id = NEW.order_id;

    v_quantity := NEW.quantity;

    v_breakdown := public.compute_unit_price(
      NEW.product_id, v_quantity, v_clinic_id, v_doctor_id,
      NEW.coupon_id, now()
    );

    IF v_breakdown ? 'error' THEN
      -- Pricing mode = TIERED_PROFILE mas algo está fora: sem profile
      -- vivo, sem tier para a quantidade, etc. Falhar agora, alto e
      -- claro, em vez de freezar valores potencialmente errados.
      RAISE EXCEPTION 'freeze_order_item_price: tiered pricing failed for product % qty %: %',
        NEW.product_id, v_quantity, v_breakdown
        USING ERRCODE = 'P0001';
    END IF;

    v_final_cents := (v_breakdown ->> 'final_unit_price_cents')::bigint;
    v_tier_cents  := (v_breakdown ->> 'tier_unit_cents')::bigint;
    v_pharm_cents := (v_breakdown ->> 'pharmacy_cost_unit_cents')::bigint;
    v_plat_cents  := (v_breakdown ->> 'platform_commission_per_unit_cents')::bigint;
    v_profile_id  := (v_breakdown ->> 'pricing_profile_id')::uuid;
    v_resolved_coupon_id := NULLIF(v_breakdown ->> 'coupon_id', '')::uuid;

    -- Materialização da ficha — mantém numeric e cents em sincronia
    -- desde o nascimento da linha. money_drift_view nunca deve flagar
    -- estas linhas.
    NEW.unit_price                         := (v_final_cents::numeric / 100)::numeric(12, 2);
    NEW.original_total_price               := (v_tier_cents::numeric * v_quantity / 100)::numeric(12, 2);
    NEW.total_price                        := (v_final_cents::numeric * v_quantity / 100)::numeric(12, 2);
    NEW.discount_amount                    := NEW.original_total_price - NEW.total_price;
    NEW.pharmacy_cost_per_unit             := (v_pharm_cents::numeric / 100)::numeric(12, 2);
    NEW.platform_commission_per_unit       := (v_plat_cents::numeric / 100)::numeric(12, 2);

    NEW.unit_price_cents                   := v_final_cents;
    NEW.total_price_cents                  := v_final_cents * v_quantity;
    NEW.pharmacy_cost_per_unit_cents       := v_pharm_cents;
    NEW.platform_commission_per_unit_cents := v_plat_cents;

    NEW.pricing_profile_id := v_profile_id;
    NEW.coupon_id := v_resolved_coupon_id;

    -- Increment coupon counter only if the engine accepted the coupon
    -- (it may have been silently rejected: expired/inactive/wrong product).
    IF v_resolved_coupon_id IS NOT NULL THEN
      UPDATE public.coupons
         SET used_count = used_count + 1
       WHERE id = v_resolved_coupon_id;
    END IF;

    RETURN NEW;
  END IF;

  -- ── Legacy FIXED branch — corpo original (mig-067) ────────────────────
  --
  -- Trocar QUALQUER linha aqui é regressão pra todos os produtos
  -- legados; manter unchanged é a regra de ouro do PR-A.
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

      UPDATE public.coupons
      SET used_count = used_count + 1
      WHERE id = NEW.coupon_id;
    ELSE
      NEW.coupon_id := NULL;
    END IF;
  END IF;

  NEW.discount_amount := v_discount;
  NEW.total_price     := NEW.original_total_price - v_discount;

  -- Migration 067 — write the matching cents columns in the SAME
  -- trigger so the row leaves BEFORE INSERT with both representations
  -- in agreement.
  NEW.unit_price_cents                   := public._money_to_cents(NEW.unit_price);
  NEW.total_price_cents                  := public._money_to_cents(NEW.total_price);
  NEW.pharmacy_cost_per_unit_cents       := public._money_to_cents(NEW.pharmacy_cost_per_unit);
  NEW.platform_commission_per_unit_cents := public._money_to_cents(NEW.platform_commission_per_unit);

  RETURN NEW;
END;
$function$;

-- ── Smoke ──────────────────────────────────────────────────────────────
DO $smoke$
DECLARE
  v_proname text;
  v_body    text;
BEGIN
  SELECT p.proname, pg_get_functiondef(p.oid)
    INTO v_proname, v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'freeze_order_item_price';
  IF v_proname IS NULL THEN
    RAISE EXCEPTION 'mig072 smoke: freeze_order_item_price missing';
  END IF;
  IF v_body NOT LIKE '%TIERED_PROFILE%' THEN
    RAISE EXCEPTION 'mig072 smoke: TIERED_PROFILE branch missing in freeze function';
  END IF;
  IF v_body NOT LIKE '%compute_unit_price%' THEN
    RAISE EXCEPTION 'mig072 smoke: compute_unit_price call missing in freeze function';
  END IF;
  IF v_body NOT LIKE '%pharmacy_cost_per_unit_cents%'
     OR v_body NOT LIKE '%price_current%' THEN
    RAISE EXCEPTION 'mig072 smoke: legacy FIXED branch appears truncated';
  END IF;

  RAISE NOTICE 'Migration 072 smoke passed (tiered branch installed, FIXED branch preserved)';
END
$smoke$;
