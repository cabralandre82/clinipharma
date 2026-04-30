-- Migration 077 — preview_unit_price com cupom hipotético (PR-C3 do ADR-001).
--
-- Visão
-- -----
-- A matriz de impacto de cupons (`/products/[id]/pricing/coupon-matrix`)
-- precisa responder a "se eu desse 30% de desconto pra clínica X em 3
-- unidades de Tirzepatida 60mg, qual o impacto na minha receita?"
--
-- compute_unit_price (mig-071) só aceita coupon_id existente. Para cupom
-- HIPOTÉTICO (ainda não criado, super-admin avaliando), precisamos
-- aceitar (disc_type, disc_value, max_disc_cents) diretamente.
--
-- Decisão: NÃO refatorar compute_unit_price.
-- ---------------------------------------------------------------
-- compute_unit_price é chamada pelo trigger freeze_order_item_price em
-- todo INSERT em order_items (mig-072). Mexer nele é alto risco — se
-- quebrarmos, todos os pedidos novos param. preview_unit_price é uma
-- adição lateral: existe SEM o lookup de coupon_id, copy-paste do
-- corpo central. Drift é mitigado por:
--   1. Smoke embedded compara saídas para os mesmos inputs.
--   2. Tests de paridade no Vitest (PR-C3).
--   3. (Futuro) extrair função privada compartilhada se as duas
--      divergirem em manutenção. Hoje é prematuro.
--
-- Contrato
-- --------
-- IN:
--   p_product_id      uuid
--   p_quantity        int
--   p_clinic_id       uuid (nullable; pra resolver buyer_pricing_overrides)
--   p_doctor_id       uuid (nullable)
--   p_disc_type       text NULL ('PERCENT' | 'FIXED'); NULL = sem cupom
--   p_disc_value      numeric NULL (% se PERCENT, R$/unid se FIXED)
--   p_max_disc_cents  bigint NULL (cap total da ordem; ignorado se NULL)
--   p_at              timestamptz DEFAULT now()
--
-- OUT: jsonb com a mesma forma que compute_unit_price (campos
-- coupon_* preenchidos a partir dos parâmetros, sem coupon_id).
--
-- Diferenças de saída
-- -------------------
-- - `coupon_id` é sempre NULL (cupom hipotético não tem id).
-- - `is_preview` = true (flag exclusivo desta função).
--
-- SECURITY DEFINER + STABLE — mesmas garantias que compute_unit_price
-- (read-only, só lê tabelas de pricing/products/profile).

SET search_path TO public, pg_temp;

CREATE OR REPLACE FUNCTION public.preview_unit_price(
  p_product_id      uuid,
  p_quantity        int,
  p_clinic_id       uuid,
  p_doctor_id       uuid,
  p_disc_type       text,
  p_disc_value      numeric,
  p_max_disc_cents  bigint,
  p_at              timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile               public.pricing_profiles;
  v_tier_unit_cents       bigint;
  v_tier_id               uuid;
  v_pharmacy_cost_cents   bigint;
  v_floor_jsonb           jsonb;
  v_floor_cents           bigint;

  v_raw_disc_per_unit     bigint  := 0;
  v_capped_disc_per_unit  bigint  := 0;
  v_coupon_active         boolean := false;
  v_coupon_capped         boolean := false;

  v_final_unit_cents      bigint;
  v_platform_commission_per_unit_cents bigint;
  v_consultant_rate       numeric;
  v_consultant_raw_cents  bigint  := 0;
  v_consultant_cents      bigint  := 0;
  v_consultant_capped     boolean := false;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'preview_unit_price: quantity must be > 0, got %', p_quantity;
  END IF;

  -- Validação leve do cupom hipotético — falha fora do core para
  -- mensagem clara.
  IF p_disc_type IS NOT NULL AND p_disc_type NOT IN ('PERCENT', 'FIXED') THEN
    RAISE EXCEPTION 'preview_unit_price: invalid disc_type % (expected PERCENT or FIXED)', p_disc_type;
  END IF;
  IF p_disc_type IS NOT NULL AND (p_disc_value IS NULL OR p_disc_value <= 0) THEN
    RAISE EXCEPTION 'preview_unit_price: disc_value required and > 0 when disc_type is set';
  END IF;
  IF p_disc_type = 'PERCENT' AND p_disc_value > 100 THEN
    RAISE EXCEPTION 'preview_unit_price: PERCENT disc_value must be <= 100, got %', p_disc_value;
  END IF;

  v_profile := public.resolve_pricing_profile(p_product_id, p_at);
  IF v_profile.id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_active_profile', 'is_preview', true);
  END IF;

  SELECT id, unit_price_cents
    INTO v_tier_id, v_tier_unit_cents
    FROM public.pricing_profile_tiers
   WHERE pricing_profile_id = v_profile.id
     AND p_quantity BETWEEN min_quantity AND max_quantity
   ORDER BY min_quantity DESC
   LIMIT 1;

  IF v_tier_unit_cents IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'no_tier_for_quantity',
      'profile_id', v_profile.id,
      'quantity', p_quantity,
      'is_preview', true
    );
  END IF;

  v_pharmacy_cost_cents := v_profile.pharmacy_cost_unit_cents;

  v_floor_jsonb := public.resolve_effective_floor(
    p_product_id, p_clinic_id, p_doctor_id, v_tier_unit_cents, p_at
  );
  v_floor_cents := (v_floor_jsonb->>'floor_cents')::bigint;

  -- INV-1 dominância (igual a compute_unit_price).
  IF v_floor_cents IS NULL OR v_floor_cents < v_pharmacy_cost_cents THEN
    v_floor_cents := v_pharmacy_cost_cents;
  END IF;

  -- ── Cupom hipotético (sem lookup): aplica direto.
  IF p_disc_type IS NOT NULL THEN
    v_coupon_active := true;
    IF p_disc_type = 'PERCENT' THEN
      v_raw_disc_per_unit := (v_tier_unit_cents * p_disc_value / 100.0)::bigint;
      IF p_max_disc_cents IS NOT NULL THEN
        v_raw_disc_per_unit := LEAST(
          v_raw_disc_per_unit,
          (p_max_disc_cents / GREATEST(p_quantity, 1))::bigint
        );
      END IF;
    ELSE
      -- FIXED — disc_value é R$ por unidade.
      v_raw_disc_per_unit := public._money_to_cents(p_disc_value);
      v_raw_disc_per_unit := LEAST(v_raw_disc_per_unit, v_tier_unit_cents);
    END IF;
  END IF;

  -- INV-2 cap (igual).
  v_capped_disc_per_unit := LEAST(v_raw_disc_per_unit, v_tier_unit_cents - v_floor_cents);
  IF v_capped_disc_per_unit < 0 THEN
    v_capped_disc_per_unit := 0;
  END IF;
  IF v_capped_disc_per_unit < v_raw_disc_per_unit THEN
    v_coupon_capped := true;
  END IF;

  v_final_unit_cents := v_tier_unit_cents - v_capped_disc_per_unit;
  v_platform_commission_per_unit_cents := v_final_unit_cents - v_pharmacy_cost_cents;

  IF v_platform_commission_per_unit_cents < 0 THEN
    RAISE EXCEPTION 'preview_unit_price: platform commission would be negative (final=% pharmacy=%)',
      v_final_unit_cents, v_pharmacy_cost_cents;
  END IF;

  -- Comissão consultor (igual).
  IF v_profile.consultant_commission_basis = 'FIXED_PER_UNIT' THEN
    v_consultant_raw_cents := COALESCE(v_profile.consultant_commission_fixed_per_unit_cents, 0);
  ELSIF v_profile.consultant_commission_basis = 'PHARMACY_TRANSFER' THEN
    SELECT COALESCE((value_json::text)::numeric, 5)
      INTO v_consultant_rate
      FROM public.app_settings WHERE key = 'consultant_commission_rate' LIMIT 1;
    v_consultant_rate := COALESCE(v_consultant_rate, 5);
    v_consultant_raw_cents := (v_pharmacy_cost_cents * v_consultant_rate / 100.0)::bigint;
  ELSE
    SELECT COALESCE((value_json::text)::numeric, 5)
      INTO v_consultant_rate
      FROM public.app_settings WHERE key = 'consultant_commission_rate' LIMIT 1;
    v_consultant_rate := COALESCE(v_consultant_rate, 5);
    v_consultant_raw_cents := (v_final_unit_cents * v_consultant_rate / 100.0)::bigint;
  END IF;

  -- INV-4 cap (igual).
  v_consultant_cents := LEAST(v_consultant_raw_cents, v_platform_commission_per_unit_cents);
  IF v_consultant_cents < v_consultant_raw_cents THEN
    v_consultant_capped := true;
  END IF;

  RETURN jsonb_build_object(
    'pricing_profile_id',                     v_profile.id,
    'tier_id',                                v_tier_id,
    'tier_unit_cents',                        v_tier_unit_cents,
    'pharmacy_cost_unit_cents',               v_pharmacy_cost_cents,
    'effective_floor_cents',                  v_floor_cents,
    'floor_breakdown',                        v_floor_jsonb,
    'coupon_id',                              NULL,
    'coupon_disc_per_unit_raw_cents',         v_raw_disc_per_unit,
    'coupon_disc_per_unit_capped_cents',      v_capped_disc_per_unit,
    'coupon_capped',                          v_coupon_capped,
    'final_unit_price_cents',                 v_final_unit_cents,
    'platform_commission_per_unit_cents',     v_platform_commission_per_unit_cents,
    'consultant_basis',                       v_profile.consultant_commission_basis,
    'consultant_per_unit_raw_cents',          v_consultant_raw_cents,
    'consultant_per_unit_cents',              v_consultant_cents,
    'consultant_capped',                      v_consultant_capped,
    'quantity',                               p_quantity,
    'final_total_cents',                      v_final_unit_cents * p_quantity,
    'pharmacy_transfer_cents',                v_pharmacy_cost_cents * p_quantity,
    'platform_commission_total_cents',        v_platform_commission_per_unit_cents * p_quantity,
    'consultant_commission_total_cents',      v_consultant_cents * p_quantity,
    'is_preview',                             true,
    'coupon_active',                          v_coupon_active
  );
END
$$;

COMMENT ON FUNCTION public.preview_unit_price(uuid, int, uuid, uuid, text, numeric, bigint, timestamptz) IS
  'Cousin de compute_unit_price para cupom HIPOTÉTICO (sem coupon_id). Usado pela coupon impact matrix do super-admin.';

-- ── Smoke ──────────────────────────────────────────────────────────────
--
-- Verificações:
--   A) sem cupom → resultado idêntico a compute_unit_price(coupon_id=NULL)
--   B) cupom 30% PERCENT → bate com compute_unit_price(real coupon 30%)
--   C) cupom 99% PERCENT → INV-2 cap dispara igual
--   D) FIXED R$ 200/unid → bate
--   E) hypothetical PERCENT > 100 → exception clara

DO $smoke$
DECLARE
  v_pharmacy_id uuid;
  v_category_id uuid;
  v_admin_user  uuid;
  v_clinic_id   uuid;
  v_product_id  uuid;
  v_profile_id  uuid;
  v_coupon_id   uuid;
  v_real        jsonb;
  v_preview     jsonb;
  v_field       text;
  v_real_val    bigint;
  v_preview_val bigint;
BEGIN
  SELECT id INTO v_pharmacy_id FROM public.pharmacies LIMIT 1;
  SELECT id INTO v_category_id FROM public.product_categories LIMIT 1;
  SELECT id INTO v_admin_user  FROM public.profiles
    WHERE EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = profiles.id AND ur.role = 'SUPER_ADMIN')
    LIMIT 1;
  SELECT id INTO v_clinic_id   FROM public.clinics LIMIT 1;

  IF v_pharmacy_id IS NULL OR v_category_id IS NULL OR v_admin_user IS NULL THEN
    RAISE NOTICE 'mig077 smoke: skipping live exercise';
    RAISE NOTICE 'Migration 077 smoke passed (function definition installed)';
    RETURN;
  END IF;

  CREATE TEMP TABLE _smoke_state_077 (
    product_id uuid, profile_id uuid, coupon_id uuid
  ) ON COMMIT DROP;

  BEGIN
    INSERT INTO public.products (
      category_id, pharmacy_id, sku, name, slug, concentration, presentation,
      short_description, characteristics_json, price_current, currency,
      estimated_deadline_days, active, featured, pharmacy_cost,
      status, requires_prescription, needs_price_review, is_manipulated
    )
    VALUES (
      v_category_id, v_pharmacy_id,
      'SMOKE077-' || gen_random_uuid()::text,
      'Smoke 077', 'smoke077-' || gen_random_uuid()::text,
      '60mg', '5 unid', 'desc', '{}'::jsonb,
      1500.00, 'BRL', 7, false, false, 500.00,
      'inactive', true, false, true
    )
    RETURNING id INTO v_product_id;

    INSERT INTO public.pricing_profiles (
      product_id, pharmacy_cost_unit_cents,
      platform_min_unit_cents, platform_min_unit_pct,
      consultant_commission_basis,
      created_by_user_id, change_reason
    )
    VALUES (
      v_product_id, 50000,
      12000, 8.00,
      'TOTAL_PRICE',
      v_admin_user, 'smoke 077'
    )
    RETURNING id INTO v_profile_id;

    INSERT INTO public.pricing_profile_tiers (pricing_profile_id, min_quantity, max_quantity, unit_price_cents)
    VALUES
      (v_profile_id, 1, 1,  150000),
      (v_profile_id, 2, 3,  140000),
      (v_profile_id, 4, 10, 130000);

    INSERT INTO _smoke_state_077(product_id, profile_id) VALUES (v_product_id, v_profile_id);

    -- A) Sem cupom — paridade absoluta entre as duas funções.
    v_real := public.compute_unit_price(v_product_id, 4, v_clinic_id, NULL, NULL);
    v_preview := public.preview_unit_price(v_product_id, 4, v_clinic_id, NULL, NULL, NULL, NULL);
    FOREACH v_field IN ARRAY ARRAY[
      'final_unit_price_cents',
      'platform_commission_per_unit_cents',
      'consultant_per_unit_cents',
      'pharmacy_transfer_cents',
      'final_total_cents'
    ] LOOP
      v_real_val := (v_real->>v_field)::bigint;
      v_preview_val := (v_preview->>v_field)::bigint;
      IF v_real_val IS DISTINCT FROM v_preview_val THEN
        RAISE EXCEPTION 'mig077 smoke A: divergence on % (real=% preview=%)', v_field, v_real_val, v_preview_val;
      END IF;
    END LOOP;

    -- B) Cupom 30% PERCENT — paridade.
    INSERT INTO public.coupons (
      code, product_id, clinic_id, discount_type, discount_value,
      valid_from, active, activated_at, created_by_user_id
    )
    VALUES (
      'SMOKE077-' || substr(md5(random()::text), 1, 8),
      v_product_id, v_clinic_id, 'PERCENT', 30.00,
      now() - interval '1 day', true, now(), v_admin_user
    )
    RETURNING id INTO v_coupon_id;
    UPDATE _smoke_state_077 SET coupon_id = v_coupon_id;

    v_real := public.compute_unit_price(v_product_id, 4, v_clinic_id, NULL, v_coupon_id);
    v_preview := public.preview_unit_price(v_product_id, 4, v_clinic_id, NULL, 'PERCENT', 30.00, NULL);
    FOREACH v_field IN ARRAY ARRAY[
      'final_unit_price_cents',
      'platform_commission_per_unit_cents',
      'consultant_per_unit_cents'
    ] LOOP
      v_real_val := (v_real->>v_field)::bigint;
      v_preview_val := (v_preview->>v_field)::bigint;
      IF v_real_val IS DISTINCT FROM v_preview_val THEN
        RAISE EXCEPTION 'mig077 smoke B: divergence on % (real=% preview=%) full real=% preview=%',
          v_field, v_real_val, v_preview_val, v_real, v_preview;
      END IF;
    END LOOP;

    -- C) Cupom 99% PERCENT — INV-2 cap dispara nas duas; final + flag bate.
    UPDATE public.coupons SET discount_value = 99.00 WHERE id = v_coupon_id;
    v_real := public.compute_unit_price(v_product_id, 4, v_clinic_id, NULL, v_coupon_id);
    v_preview := public.preview_unit_price(v_product_id, 4, v_clinic_id, NULL, 'PERCENT', 99.00, NULL);
    IF (v_real->>'final_unit_price_cents')::bigint <> (v_preview->>'final_unit_price_cents')::bigint THEN
      RAISE EXCEPTION 'mig077 smoke C: final divergence';
    END IF;
    IF (v_real->>'coupon_capped')::boolean <> (v_preview->>'coupon_capped')::boolean THEN
      RAISE EXCEPTION 'mig077 smoke C: coupon_capped flag divergence';
    END IF;

    -- D) FIXED R$ 200/unid — paridade.
    UPDATE public.coupons SET discount_type='FIXED', discount_value=200.00 WHERE id = v_coupon_id;
    v_real := public.compute_unit_price(v_product_id, 4, v_clinic_id, NULL, v_coupon_id);
    v_preview := public.preview_unit_price(v_product_id, 4, v_clinic_id, NULL, 'FIXED', 200.00, NULL);
    IF (v_real->>'final_unit_price_cents')::bigint <> (v_preview->>'final_unit_price_cents')::bigint THEN
      RAISE EXCEPTION 'mig077 smoke D: FIXED divergence (real=% preview=%)',
        v_real->>'final_unit_price_cents', v_preview->>'final_unit_price_cents';
    END IF;

    -- E) hypothetical com PERCENT > 100 → exception.
    BEGIN
      PERFORM public.preview_unit_price(v_product_id, 4, v_clinic_id, NULL, 'PERCENT', 150.00, NULL);
      RAISE EXCEPTION 'mig077 smoke E: should have failed with disc_value > 100';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM NOT LIKE '%PERCENT disc_value must be <= 100%' THEN
        RAISE EXCEPTION 'mig077 smoke E: wrong error %', SQLERRM;
      END IF;
    END;

    -- F) is_preview flag presente.
    v_preview := public.preview_unit_price(v_product_id, 1, v_clinic_id, NULL, NULL, NULL, NULL);
    IF NOT (v_preview->>'is_preview')::boolean THEN
      RAISE EXCEPTION 'mig077 smoke F: is_preview flag missing';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    DELETE FROM public.coupons WHERE id = (SELECT coupon_id FROM _smoke_state_077);
    DELETE FROM public.pricing_profile_tiers WHERE pricing_profile_id = (SELECT profile_id FROM _smoke_state_077);
    DELETE FROM public.pricing_profiles WHERE id = (SELECT profile_id FROM _smoke_state_077);
    DELETE FROM public.products WHERE id = (SELECT product_id FROM _smoke_state_077);
    RAISE;
  END;

  DELETE FROM public.coupons WHERE id = (SELECT coupon_id FROM _smoke_state_077);
  DELETE FROM public.pricing_profile_tiers WHERE pricing_profile_id = (SELECT profile_id FROM _smoke_state_077);
  DELETE FROM public.pricing_profiles WHERE id = (SELECT profile_id FROM _smoke_state_077);
  DELETE FROM public.products WHERE id = (SELECT product_id FROM _smoke_state_077);

  RAISE NOTICE 'Migration 077 smoke passed (6 paridade + edge scenarios)';
END
$smoke$;
