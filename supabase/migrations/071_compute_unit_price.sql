-- Migration 071 — Pricing engine functions (PR-A do ADR-001).
--
-- Visão
-- -----
-- Three pure functions that, juntas, são o cérebro do tiered pricing:
--
--   resolve_pricing_profile(product, at)
--     → 1 linha pricing_profiles, ou NULL.
--
--   resolve_effective_floor(product, clinic, doctor, at)
--     → jsonb { floor_cents, source }
--     (PR-A: source sempre 'product'. PR-B: 'buyer_override' quando aplicável.)
--
--   compute_unit_price(product, qty, clinic, doctor, coupon, at)
--     → jsonb com a "ficha" inteira do item: tier price, floor, cupom
--       cap (INV-2), pharmacy cost, comissão de plataforma e de
--       consultor (com INV-4 cap), flags de capping.
--
-- Pure no sentido relevante: nenhuma escreve em ledger / order /
-- coupon counters. Quem escreve é o trigger de freeze (mig-072).
-- Permite chamar do app a qualquer momento (preview, simulator,
-- coupon impact matrix) sem efeitos colaterais.
--
-- INV-2 (final_price >= floor): aplicado dentro de compute_unit_price
-- via cap silencioso do desconto do cupom. Se o cupom levaria o
-- preço abaixo do piso, o desconto é truncado para exatamente
-- (tier_unit - floor). flag `coupon_capped` na saída.
--
-- INV-4 (consultant <= platform): consultor é capeado para no máximo
-- platform_commission_per_unit. flag `consultant_capped` na saída.
--
-- IMMUTABLE/STABLE
-- ----------------
-- compute_unit_price e os helpers leem `pricing_profiles`,
-- `pricing_profile_tiers`, `coupons`, `products`. Tabelas mudam, então
-- as funções são marcadas STABLE (read-only no escopo da statement,
-- mas não imutáveis no sentido de Postgres). Marcar IMMUTABLE seria
-- bug — planner faria caching inseguro.

SET search_path TO public, pg_temp;

-- ── resolve_pricing_profile ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.resolve_pricing_profile(
  p_product_id uuid,
  p_at         timestamptz DEFAULT now()
) RETURNS public.pricing_profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT *
    FROM public.pricing_profiles
   WHERE product_id      = p_product_id
     AND effective_from <= p_at
     AND (effective_until IS NULL OR effective_until > p_at)
   ORDER BY effective_from DESC
   LIMIT 1;
$$;

COMMENT ON FUNCTION public.resolve_pricing_profile(uuid, timestamptz) IS
  'Retorna o pricing_profile vivo de um produto no tempo p_at; NULL se nenhum.';

-- ── resolve_effective_floor ────────────────────────────────────────────
--
-- Retorna o piso efetivo POR UNIDADE em centavos. Usa o profile vivo
-- e calcula MAX(absolute, pct × tier_unit_price). Quando o cliente
-- não passa quantity (uso "ficha do produto"), assumimos o tier
-- pivô (min_quantity menor) como referência para o pct — mas o
-- caller que importa de verdade (compute_unit_price) já passa o tier
-- correto da quantidade pedida.
--
-- PR-A: fonte é sempre 'product' (não há override de buyer ainda).
-- PR-B vai estender esta função para checar `buyer_pricing_overrides`
-- antes de cair no profile do produto.

CREATE OR REPLACE FUNCTION public.resolve_effective_floor(
  p_product_id        uuid,
  p_clinic_id         uuid,           -- reservado pra PR-B
  p_doctor_id         uuid,           -- reservado pra PR-B
  p_tier_unit_cents   bigint,
  p_at                timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile         public.pricing_profiles;
  v_floor_abs       bigint;
  v_floor_pct_cents bigint;
  v_floor_eff       bigint;
  v_source          text := 'product';
BEGIN
  -- Reserved for PR-B: buyer override resolution. Aceitamos os
  -- argumentos hoje para que a assinatura da função não mude depois
  -- (callers já chegam preparados).
  PERFORM 1 WHERE p_clinic_id IS NOT NULL OR p_doctor_id IS NOT NULL;

  v_profile := public.resolve_pricing_profile(p_product_id, p_at);
  IF v_profile.id IS NULL THEN
    RETURN jsonb_build_object('floor_cents', NULL::bigint, 'source', 'no_profile');
  END IF;

  v_floor_abs := v_profile.platform_min_unit_cents;
  IF v_profile.platform_min_unit_pct IS NOT NULL AND p_tier_unit_cents IS NOT NULL THEN
    v_floor_pct_cents := (p_tier_unit_cents * v_profile.platform_min_unit_pct / 100.0)::bigint;
  END IF;

  -- Política do usuário: "absolute OR pct, o que for maior". Se um
  -- dos dois for NULL, GREATEST com NULL retorna NULL — usamos
  -- COALESCE para o caso de só um dos dois estar definido.
  v_floor_eff := GREATEST(COALESCE(v_floor_abs, 0), COALESCE(v_floor_pct_cents, 0));
  IF v_floor_eff = 0 AND v_floor_abs IS NULL AND v_floor_pct_cents IS NULL THEN
    -- O CHECK em pricing_profiles garante pelo menos um dos dois
    -- não-NULL; cair aqui significa profile corrupto — deixa
    -- claro em vez de retornar 0 silenciosamente.
    RAISE EXCEPTION 'profile % has both platform_min fields NULL — schema invariant violated', v_profile.id;
  END IF;

  RETURN jsonb_build_object(
    'floor_cents', v_floor_eff,
    'source',      v_source,
    'profile_id',  v_profile.id,
    'floor_abs_cents', v_floor_abs,
    'floor_pct_cents', v_floor_pct_cents
  );
END
$$;

COMMENT ON FUNCTION public.resolve_effective_floor(uuid, uuid, uuid, bigint, timestamptz) IS
  'Piso efetivo da plataforma por unidade. PR-A usa produto; PR-B estenderá com override por buyer.';

-- ── compute_unit_price ─────────────────────────────────────────────────
--
-- A função-chave. Determina TUDO sobre o item antes de freezar:
--
--   1. Encontra o tier que cobre `quantity`.
--   2. Aplica desconto de cupom (PERCENT ou FIXED).
--   3. Aplica INV-2 cap (final_price >= floor) — corta o desconto
--      do cupom até o piso.
--   4. Calcula platform_commission = final_price - pharmacy_cost.
--   5. Calcula consultant_commission por basis (TOTAL_PRICE,
--      PHARMACY_TRANSFER, FIXED_PER_UNIT).
--   6. Aplica INV-4 cap (consultant <= platform). flag.
--
-- Output JSONB tem TODOS os campos derivados e flags de capping —
-- consumido por:
--   - freeze_order_item_price (072) → grava no order_items.
--   - app TS preview / simulator (PR-C/D) → renderiza UI.
--
-- Custo: 1 lookup pricing_profiles + 1 lookup tiers + 1 lookup
-- coupons (se coupon_id setado) + chamada a resolve_effective_floor.
-- Tudo hot path, indexado.

CREATE OR REPLACE FUNCTION public.compute_unit_price(
  p_product_id  uuid,
  p_quantity    int,
  p_clinic_id   uuid,
  p_doctor_id   uuid,
  p_coupon_id   uuid,
  p_at          timestamptz DEFAULT now()
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

  v_disc_type             text;
  v_disc_value            numeric(10,4);
  v_max_disc_cents        bigint;
  v_coupon_active         boolean := false;

  v_raw_disc_per_unit     bigint  := 0;
  v_capped_disc_per_unit  bigint  := 0;
  v_coupon_capped         boolean := false;

  v_final_unit_cents      bigint;
  v_platform_commission_per_unit_cents bigint;
  v_consultant_rate       numeric;
  v_consultant_raw_cents  bigint  := 0;
  v_consultant_cents      bigint  := 0;
  v_consultant_capped     boolean := false;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'compute_unit_price: quantity must be > 0, got %', p_quantity;
  END IF;

  v_profile := public.resolve_pricing_profile(p_product_id, p_at);
  IF v_profile.id IS NULL THEN
    -- Caller deve cair de volta para o caminho FIXED — sinalizamos
    -- claramente em vez de fingir um valor.
    RETURN jsonb_build_object('error', 'no_active_profile');
  END IF;

  -- Encontra o tier que cobre `quantity`.
  SELECT id, unit_price_cents
    INTO v_tier_id, v_tier_unit_cents
    FROM public.pricing_profile_tiers
   WHERE pricing_profile_id = v_profile.id
     AND p_quantity BETWEEN min_quantity AND max_quantity
   ORDER BY min_quantity DESC
   LIMIT 1;

  IF v_tier_unit_cents IS NULL THEN
    -- Nenhum tier cobre esta quantidade. Retornamos erro estruturado;
    -- chamador (UI) pode mostrar "fora de faixa, fale com o suporte".
    RETURN jsonb_build_object(
      'error', 'no_tier_for_quantity',
      'profile_id', v_profile.id,
      'quantity', p_quantity
    );
  END IF;

  v_pharmacy_cost_cents := v_profile.pharmacy_cost_unit_cents;

  v_floor_jsonb := public.resolve_effective_floor(
    p_product_id, p_clinic_id, p_doctor_id, v_tier_unit_cents, p_at
  );
  v_floor_cents := (v_floor_jsonb->>'floor_cents')::bigint;

  -- Garante que o piso é >= pharmacy_cost. Se config admin permitiu
  -- floor < cost, isto seria INV-1 violado em runtime — protege.
  IF v_floor_cents < v_pharmacy_cost_cents THEN
    v_floor_cents := v_pharmacy_cost_cents;
  END IF;

  -- ── Coupon, se houver. Ignora silenciosamente cupom inativo ou
  -- expirado para que freeze_order_item_price possa simplesmente
  -- escolher entre {coupon_id, NULL} a partir do flag retornado.
  IF p_coupon_id IS NOT NULL THEN
    SELECT discount_type, discount_value, public._money_to_cents(max_discount_amount)
      INTO v_disc_type, v_disc_value, v_max_disc_cents
      FROM public.coupons
     WHERE id           = p_coupon_id
       AND active       = true
       AND activated_at IS NOT NULL
       AND (valid_until IS NULL OR valid_until >= p_at)
       AND product_id   = p_product_id;
    IF FOUND THEN
      v_coupon_active := true;
      IF v_disc_type = 'PERCENT' THEN
        -- desconto por unidade: pct × tier_unit
        v_raw_disc_per_unit := (v_tier_unit_cents * v_disc_value / 100.0)::bigint;
        IF v_max_disc_cents IS NOT NULL THEN
          -- max_disc_amount é total da ordem nos legados; convertemos
          -- para por-unidade dividindo pela quantidade. Se isso
          -- resultar em zero (cap < quantity), o cupom é desligado.
          v_raw_disc_per_unit := LEAST(
            v_raw_disc_per_unit,
            (v_max_disc_cents / GREATEST(p_quantity, 1))::bigint
          );
        END IF;
      ELSIF v_disc_type = 'FIXED' THEN
        -- discount_value é R$ por unidade no FIXED.
        v_raw_disc_per_unit := public._money_to_cents(v_disc_value);
        v_raw_disc_per_unit := LEAST(v_raw_disc_per_unit, v_tier_unit_cents);
      END IF;
    END IF;
  END IF;

  -- ── INV-2 cap: final_unit_price >= floor.
  v_capped_disc_per_unit := LEAST(v_raw_disc_per_unit, v_tier_unit_cents - v_floor_cents);
  IF v_capped_disc_per_unit < 0 THEN
    v_capped_disc_per_unit := 0;
  END IF;
  IF v_capped_disc_per_unit < v_raw_disc_per_unit THEN
    v_coupon_capped := true;
  END IF;

  v_final_unit_cents := v_tier_unit_cents - v_capped_disc_per_unit;

  -- Platform commission por unidade derivada.
  v_platform_commission_per_unit_cents := v_final_unit_cents - v_pharmacy_cost_cents;
  IF v_platform_commission_per_unit_cents < 0 THEN
    -- Não deveria acontecer (floor >= pharmacy_cost garantido acima),
    -- mas se acontecer queremos saber gritando.
    RAISE EXCEPTION 'compute_unit_price: platform commission would be negative (final=% pharmacy=%)',
      v_final_unit_cents, v_pharmacy_cost_cents;
  END IF;

  -- ── Consultant commission por unidade — depende do basis.
  IF v_profile.consultant_commission_basis = 'FIXED_PER_UNIT' THEN
    v_consultant_raw_cents := COALESCE(v_profile.consultant_commission_fixed_per_unit_cents, 0);
  ELSIF v_profile.consultant_commission_basis = 'PHARMACY_TRANSFER' THEN
    SELECT COALESCE((value_json::text)::numeric, 5)
      INTO v_consultant_rate
      FROM public.app_settings WHERE key = 'consultant_commission_rate' LIMIT 1;
    v_consultant_rate := COALESCE(v_consultant_rate, 5);
    v_consultant_raw_cents := (v_pharmacy_cost_cents * v_consultant_rate / 100.0)::bigint;
  ELSE  -- 'TOTAL_PRICE' (default)
    SELECT COALESCE((value_json::text)::numeric, 5)
      INTO v_consultant_rate
      FROM public.app_settings WHERE key = 'consultant_commission_rate' LIMIT 1;
    v_consultant_rate := COALESCE(v_consultant_rate, 5);
    v_consultant_raw_cents := (v_final_unit_cents * v_consultant_rate / 100.0)::bigint;
  END IF;

  -- ── INV-4 cap: consultant <= platform commission.
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
    'coupon_id',                              CASE WHEN v_coupon_active THEN p_coupon_id ELSE NULL END,
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
    'consultant_commission_total_cents',      v_consultant_cents * p_quantity
  );
END
$$;

COMMENT ON FUNCTION public.compute_unit_price(uuid, int, uuid, uuid, uuid, timestamptz) IS
  'Pricing engine: aplica tier, cupom (com INV-2 cap), comissões (com INV-4 cap). Retorna a "ficha" jsonb usada por freeze e por preview.';

-- ── Smoke ──────────────────────────────────────────────────────────────
--
-- Smoke real: cria um produto + profile + tiers + cupom dentro de um
-- DO block, exercita os 4 cenários cabralheiros (happy, INV-2 cap,
-- INV-4 cap, sem cupom), revertendo tudo no final via SAVEPOINT.

DO $smoke$
DECLARE
  v_product_id   uuid;
  v_profile_id   uuid;
  v_pharmacy_id  uuid;
  v_category_id  uuid;
  v_admin_user   uuid;
  v_coupon_id    uuid;
  v_clinic_id    uuid;
  v_result       jsonb;
BEGIN
  -- Pega referências válidas existentes (não criamos pharmacy/clinic;
  -- só queremos exercitar pricing_profiles + tiers + cupom).
  SELECT id INTO v_pharmacy_id FROM public.pharmacies LIMIT 1;
  SELECT id INTO v_category_id FROM public.product_categories LIMIT 1;
  SELECT id INTO v_admin_user  FROM public.profiles
    WHERE EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = profiles.id AND ur.role = 'SUPER_ADMIN')
    LIMIT 1;
  SELECT id INTO v_clinic_id   FROM public.clinics LIMIT 1;

  IF v_pharmacy_id IS NULL OR v_category_id IS NULL OR v_admin_user IS NULL THEN
    RAISE NOTICE 'mig071 smoke: skipping live exercise (no pharmacy/category/admin in this DB)';
    RAISE NOTICE 'Migration 071 smoke passed (function definitions installed)';
    RETURN;
  END IF;

  -- ── Setup ephemeral product + profile + tiers + cupom inside a savepoint.
  -- Reverteremos no final, garantido.
  CREATE TEMP TABLE _smoke_state (created_product_id uuid, created_profile_id uuid, created_coupon_id uuid)
    ON COMMIT DROP;

  BEGIN
    INSERT INTO public.products (
      category_id, pharmacy_id, sku, name, slug, concentration, presentation,
      short_description, characteristics_json, price_current, currency,
      estimated_deadline_days, active, featured, pharmacy_cost,
      status, requires_prescription, needs_price_review, is_manipulated
    )
    VALUES (
      v_category_id, v_pharmacy_id,
      'SMOKE-' || gen_random_uuid()::text,
      'Smoke Test Product', 'smoke-' || gen_random_uuid()::text,
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
      v_product_id, 50000,             -- R$ 500,00 / u
      12000, 8.00,                     -- R$ 120 OR 8% — política do usuário
      'TOTAL_PRICE',
      v_admin_user, 'smoke test'
    )
    RETURNING id INTO v_profile_id;

    -- Tiers: 1 → R$ 1.500, 2-3 → R$ 1.400, 4+ → R$ 1.300
    INSERT INTO public.pricing_profile_tiers (pricing_profile_id, min_quantity, max_quantity, unit_price_cents)
    VALUES
      (v_profile_id, 1, 1,  150000),
      (v_profile_id, 2, 3,  140000),
      (v_profile_id, 4, 10, 130000);

    INSERT INTO _smoke_state(created_product_id, created_profile_id) VALUES (v_product_id, v_profile_id);

    -- ── Cenário 1: qty=1, sem cupom. Tier 1 = 150000c.
    --   floor = MAX(12000, 8%×150000=12000, pharmacy_cost=50000) = 50000c
    --   final = 150000, platform_per_unit = 100000. Sem caps.
    v_result := public.compute_unit_price(v_product_id, 1, v_clinic_id, NULL, NULL);
    IF (v_result->>'final_unit_price_cents')::bigint <> 150000 THEN
      RAISE EXCEPTION 'mig071 smoke C1: final unexpected: %', v_result;
    END IF;
    IF (v_result->>'platform_commission_per_unit_cents')::bigint <> 100000 THEN
      RAISE EXCEPTION 'mig071 smoke C1: platform per unit %, expected 100000. Full: %',
        v_result->>'platform_commission_per_unit_cents', v_result;
    END IF;
    IF (v_result->>'consultant_capped')::boolean THEN
      RAISE EXCEPTION 'mig071 smoke C1: consultant should NOT have been capped: %', v_result;
    END IF;

    -- ── Cenário 2: qty=3 (cai no tier 140000c).
    v_result := public.compute_unit_price(v_product_id, 3, v_clinic_id, NULL, NULL);
    IF (v_result->>'final_unit_price_cents')::bigint <> 140000 THEN
      RAISE EXCEPTION 'mig071 smoke C2: final unexpected: %', v_result;
    END IF;
    IF (v_result->>'tier_unit_cents')::bigint <> 140000 THEN
      RAISE EXCEPTION 'mig071 smoke C2: tier_unit unexpected: %', v_result;
    END IF;

    -- ── Cenário 3: qty=4, cupom 30% (raw disc 39000c por unit).
    --   floor effective = pharmacy_cost = 50000 (INV-1 dominante)
    --   tier = 130000, max disc allowed = 130000-50000 = 80000.
    --   raw disc 39000 < 80000, então NÃO capeia. final = 91000.
    INSERT INTO public.coupons (
      code, product_id, clinic_id, discount_type, discount_value,
      valid_from, active, activated_at, created_by_user_id
    )
    VALUES (
      'SMOKE-' || substr(md5(random()::text), 1, 8),
      v_product_id, v_clinic_id, 'PERCENT', 30.00,
      now() - interval '1 day', true, now(), v_admin_user
    )
    RETURNING id INTO v_coupon_id;
    UPDATE _smoke_state SET created_coupon_id = v_coupon_id;

    v_result := public.compute_unit_price(v_product_id, 4, v_clinic_id, NULL, v_coupon_id);
    IF (v_result->>'final_unit_price_cents')::bigint <> 91000 THEN
      RAISE EXCEPTION 'mig071 smoke C3: final %, expected 91000. Full: %',
        v_result->>'final_unit_price_cents', v_result;
    END IF;
    IF (v_result->>'coupon_capped')::boolean THEN
      RAISE EXCEPTION 'mig071 smoke C3: coupon should NOT be capped here: %', v_result;
    END IF;

    -- ── Cenário 4: same setup, cupom 99% (cap deve disparar INV-2).
    --   raw disc 99%×130000 = 128700, max permitido = 80000.
    --   Capped disc = 80000. final = 130000-80000 = 50000 (= pharmacy_cost = floor).
    --   platform_per_unit = 0.
    UPDATE public.coupons SET discount_value = 99.00 WHERE id = v_coupon_id;
    v_result := public.compute_unit_price(v_product_id, 4, v_clinic_id, NULL, v_coupon_id);
    IF (v_result->>'final_unit_price_cents')::bigint <> 50000 THEN
      RAISE EXCEPTION 'mig071 smoke C4: final %, expected 50000 (=pharmacy_cost). Full: %',
        v_result->>'final_unit_price_cents', v_result;
    END IF;
    IF NOT (v_result->>'coupon_capped')::boolean THEN
      RAISE EXCEPTION 'mig071 smoke C4: coupon SHOULD have been capped: %', v_result;
    END IF;
    IF (v_result->>'platform_commission_per_unit_cents')::bigint <> 0 THEN
      RAISE EXCEPTION 'mig071 smoke C4: platform per unit %, expected 0. Full: %',
        v_result->>'platform_commission_per_unit_cents', v_result;
    END IF;

    -- ── Cenário 5: INV-4 cap. Profile fixed_per_unit consultant=10000c (R$ 100).
    --   Setup do C4 deixa platform_per_unit = 0 → consultor capa em 0.
    UPDATE public.pricing_profiles
       SET consultant_commission_basis = 'FIXED_PER_UNIT',
           consultant_commission_fixed_per_unit_cents = 10000
     WHERE id = v_profile_id;
    v_result := public.compute_unit_price(v_product_id, 4, v_clinic_id, NULL, v_coupon_id);
    IF (v_result->>'consultant_per_unit_raw_cents')::bigint <> 10000 THEN
      RAISE EXCEPTION 'mig071 smoke C5: consultant_raw %, expected 10000', v_result;
    END IF;
    IF (v_result->>'consultant_per_unit_cents')::bigint <> 0 THEN
      RAISE EXCEPTION 'mig071 smoke C5: consultant_capped value %, expected 0 (platform=0)', v_result;
    END IF;
    IF NOT (v_result->>'consultant_capped')::boolean THEN
      RAISE EXCEPTION 'mig071 smoke C5: consultant SHOULD have been capped: %', v_result;
    END IF;

    -- ── Cenário 6: FIXED_PER_UNIT consultant, qty=1 sem cupom.
    --   tier=150000, pharmacy=50000 → platform_per_unit=100000.
    --   consultor fixed = 10000 < 100000 → NÃO capa.
    v_result := public.compute_unit_price(v_product_id, 1, v_clinic_id, NULL, NULL);
    IF (v_result->>'consultant_per_unit_cents')::bigint <> 10000 THEN
      RAISE EXCEPTION 'mig071 smoke C6: consultant should be 10000 (no cap), got %', v_result;
    END IF;
    IF (v_result->>'consultant_capped')::boolean THEN
      RAISE EXCEPTION 'mig071 smoke C6: consultant should NOT have been capped here: %', v_result;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Cleanup do que conseguimos criar antes de re-raise.
    DELETE FROM public.coupons              WHERE id = (SELECT created_coupon_id  FROM _smoke_state);
    DELETE FROM public.pricing_profile_tiers WHERE pricing_profile_id = (SELECT created_profile_id FROM _smoke_state);
    DELETE FROM public.pricing_profiles     WHERE id = (SELECT created_profile_id FROM _smoke_state);
    DELETE FROM public.products             WHERE id = (SELECT created_product_id FROM _smoke_state);
    RAISE;
  END;

  -- Cleanup happy path.
  DELETE FROM public.coupons              WHERE id = (SELECT created_coupon_id  FROM _smoke_state);
  DELETE FROM public.pricing_profile_tiers WHERE pricing_profile_id = (SELECT created_profile_id FROM _smoke_state);
  DELETE FROM public.pricing_profiles     WHERE id = (SELECT created_profile_id FROM _smoke_state);
  DELETE FROM public.products             WHERE id = (SELECT created_product_id FROM _smoke_state);

  RAISE NOTICE 'Migration 071 smoke passed (6 scenarios verified end-to-end)';
END
$smoke$;
