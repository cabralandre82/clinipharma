-- Migration 075 — resolve_effective_floor with buyer override (PR-B do ADR-001).
--
-- Visão
-- -----
-- Estende a função criada na migration 071 para consultar
-- `buyer_pricing_overrides` ANTES de cair no piso do produto. Sem
-- override aplicável, comportamento idêntico ao da 071.
--
-- Lookup
-- ------
--   1. Existe linha viva em buyer_pricing_overrides para
--      (product, clinic ou doctor, p_at)?
--      → usar piso do override; source='buyer_override'.
--   2. Caso contrário → cair no piso do profile do produto;
--      source='product' (igual a 071).
--
-- O cálculo "MAX(absolute, pct × tier_unit)" continua o mesmo nos
-- dois caminhos. O override só substitui os DOIS números (abs/pct)
-- — não o algoritmo.
--
-- INV-1 ainda
-- -----------
-- compute_unit_price (mig-071) já eleva o floor para pharmacy_cost
-- caso o effective venha menor — então um override agressivo
-- (negociado abaixo do custo) não permite final < pharmacy_cost.
-- Esta defesa permanece intacta.
--
-- Idempotência
-- ------------
-- CREATE OR REPLACE no corpo inteiro. O smoke compara a saída
-- com/sem override num cenário controlado.
--
-- Rollback
-- --------
-- Re-aplicar o corpo da migration 071 via CREATE OR REPLACE.

SET search_path TO public, pg_temp;

CREATE OR REPLACE FUNCTION public.resolve_effective_floor(
  p_product_id        uuid,
  p_clinic_id         uuid,
  p_doctor_id         uuid,
  p_tier_unit_cents   bigint,
  p_at                timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_override        public.buyer_pricing_overrides;
  v_profile         public.pricing_profiles;
  v_floor_abs       bigint;
  v_floor_pct_cents bigint;
  v_floor_eff       bigint;
  v_source          text;
  v_override_id     uuid;
BEGIN
  -- ── 1. Buyer override lookup ─────────────────────────────────────────
  --
  -- Índice ix_bpo_active cobre (product_id, COALESCE(clinic, doctor))
  -- WHERE effective_until IS NULL — i.e. lookup quente é direto.
  -- Para `at` no passado caímos para scan parcial via brin
  -- (ix_bpo_temporal). Catálogo cresce devagar; ambos cabem em
  -- memória.
  IF p_clinic_id IS NOT NULL OR p_doctor_id IS NOT NULL THEN
    SELECT *
      INTO v_override
      FROM public.buyer_pricing_overrides
     WHERE product_id = p_product_id
       AND ((p_clinic_id IS NOT NULL AND clinic_id = p_clinic_id)
         OR (p_doctor_id IS NOT NULL AND doctor_id = p_doctor_id))
       AND effective_from <= p_at
       AND (effective_until IS NULL OR effective_until > p_at)
     ORDER BY effective_from DESC
     LIMIT 1;
  END IF;

  IF v_override.id IS NOT NULL THEN
    v_floor_abs := v_override.platform_min_unit_cents;
    IF v_override.platform_min_unit_pct IS NOT NULL AND p_tier_unit_cents IS NOT NULL THEN
      v_floor_pct_cents := (p_tier_unit_cents * v_override.platform_min_unit_pct / 100.0)::bigint;
    END IF;

    v_floor_eff := GREATEST(COALESCE(v_floor_abs, 0), COALESCE(v_floor_pct_cents, 0));

    -- O CHECK em buyer_pricing_overrides garante pelo menos um piso
    -- não-NULL — chegar aqui com ambos NULL significa override
    -- corrompido. Falha alto.
    IF v_floor_eff = 0 AND v_floor_abs IS NULL AND v_floor_pct_cents IS NULL THEN
      RAISE EXCEPTION 'override % has both platform_min fields NULL — schema invariant violated', v_override.id;
    END IF;

    v_source      := 'buyer_override';
    v_override_id := v_override.id;

    RETURN jsonb_build_object(
      'floor_cents',     v_floor_eff,
      'source',          v_source,
      'override_id',     v_override_id,
      'floor_abs_cents', v_floor_abs,
      'floor_pct_cents', v_floor_pct_cents
    );
  END IF;

  -- ── 2. Fallback: piso do product profile (lógica da mig-071). ────────
  v_profile := public.resolve_pricing_profile(p_product_id, p_at);
  IF v_profile.id IS NULL THEN
    RETURN jsonb_build_object('floor_cents', NULL::bigint, 'source', 'no_profile');
  END IF;

  v_floor_abs := v_profile.platform_min_unit_cents;
  IF v_profile.platform_min_unit_pct IS NOT NULL AND p_tier_unit_cents IS NOT NULL THEN
    v_floor_pct_cents := (p_tier_unit_cents * v_profile.platform_min_unit_pct / 100.0)::bigint;
  END IF;

  v_floor_eff := GREATEST(COALESCE(v_floor_abs, 0), COALESCE(v_floor_pct_cents, 0));
  IF v_floor_eff = 0 AND v_floor_abs IS NULL AND v_floor_pct_cents IS NULL THEN
    RAISE EXCEPTION 'profile % has both platform_min fields NULL — schema invariant violated', v_profile.id;
  END IF;

  RETURN jsonb_build_object(
    'floor_cents',     v_floor_eff,
    'source',          'product',
    'profile_id',      v_profile.id,
    'floor_abs_cents', v_floor_abs,
    'floor_pct_cents', v_floor_pct_cents
  );
END
$$;

COMMENT ON FUNCTION public.resolve_effective_floor(uuid, uuid, uuid, bigint, timestamptz) IS
  'Piso efetivo da plataforma por unidade. PR-B: prefere buyer override quando aplicável; cai no profile do produto caso contrário.';

-- ── Smoke ──────────────────────────────────────────────────────────────
--
-- Cenários:
--   A. clínica SEM override → piso do produto (igual a 071).
--   B. clínica COM override → piso do override.
--   C. médico COM override → piso do override (mesmo produto).
--   D. override expira no meio: chamada com p_at antes pega override,
--      depois pega produto.
--   E. compute_unit_price em B: marca floor_breakdown.source='buyer_override'.
--   F. Trigger trg_bpo_no_overlap impede insert de overlap.

DO $smoke$
DECLARE
  v_pharmacy_id uuid;
  v_category_id uuid;
  v_admin_user  uuid;
  v_clinic_id   uuid;
  v_doctor_id   uuid;
  v_product_id  uuid;
  v_profile_id  uuid;
  v_override_id_1 uuid;
  v_override_id_2 uuid;
  v_result      jsonb;
  v_compute     jsonb;
BEGIN
  SELECT id INTO v_pharmacy_id FROM public.pharmacies LIMIT 1;
  SELECT id INTO v_category_id FROM public.product_categories LIMIT 1;
  SELECT id INTO v_admin_user  FROM public.profiles
    WHERE EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = profiles.id AND ur.role = 'SUPER_ADMIN')
    LIMIT 1;
  SELECT id INTO v_clinic_id   FROM public.clinics LIMIT 1;
  SELECT id INTO v_doctor_id   FROM public.doctors LIMIT 1;

  IF v_pharmacy_id IS NULL OR v_category_id IS NULL OR v_admin_user IS NULL
     OR v_clinic_id IS NULL OR v_doctor_id IS NULL THEN
    RAISE NOTICE 'mig075 smoke: skipping live exercise (need pharmacy/category/admin/clinic/doctor)';
    RAISE NOTICE 'Migration 075 smoke passed (function definition installed)';
    RETURN;
  END IF;

  CREATE TEMP TABLE _smoke_state_075 (
    product_id uuid, profile_id uuid,
    override_clinic uuid, override_doctor uuid
  ) ON COMMIT DROP;

  BEGIN
    -- Setup: produto magistral com piso 12000 (R$ 120) absoluto e 8% pct.
    INSERT INTO public.products (
      category_id, pharmacy_id, sku, name, slug, concentration, presentation,
      short_description, characteristics_json, price_current, currency,
      estimated_deadline_days, active, featured, pharmacy_cost,
      status, requires_prescription, needs_price_review, is_manipulated
    )
    VALUES (
      v_category_id, v_pharmacy_id,
      'SMOKE075-' || gen_random_uuid()::text,
      'Smoke 075', 'smoke075-' || gen_random_uuid()::text,
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
    VALUES (v_product_id, 50000, 12000, 8.00, 'TOTAL_PRICE', v_admin_user, 'smoke 075')
    RETURNING id INTO v_profile_id;

    INSERT INTO _smoke_state_075(product_id, profile_id) VALUES (v_product_id, v_profile_id);

    -- ── Cenário A: clínica sem override.
    --   Sem override → cai no profile. floor effective = MAX(12000, 8%×130000=10400) = 12000.
    v_result := public.resolve_effective_floor(v_product_id, v_clinic_id, NULL, 130000, now());
    IF v_result->>'source' <> 'product' THEN
      RAISE EXCEPTION 'mig075 smoke A: source expected product, got %', v_result;
    END IF;
    IF (v_result->>'floor_cents')::bigint <> 12000 THEN
      RAISE EXCEPTION 'mig075 smoke A: floor expected 12000, got %', v_result;
    END IF;

    -- ── Cenário B: clínica com override (piso negociado em R$ 60).
    INSERT INTO public.buyer_pricing_overrides (
      product_id, clinic_id,
      platform_min_unit_cents, platform_min_unit_pct,
      created_by_user_id, change_reason
    )
    VALUES (v_product_id, v_clinic_id, 6000, NULL, v_admin_user, 'smoke 075 clinic override')
    RETURNING id INTO v_override_id_1;
    UPDATE _smoke_state_075 SET override_clinic = v_override_id_1;

    v_result := public.resolve_effective_floor(v_product_id, v_clinic_id, NULL, 130000, now());
    IF v_result->>'source' <> 'buyer_override' THEN
      RAISE EXCEPTION 'mig075 smoke B: source expected buyer_override, got %', v_result;
    END IF;
    IF (v_result->>'floor_cents')::bigint <> 6000 THEN
      RAISE EXCEPTION 'mig075 smoke B: floor expected 6000, got %', v_result;
    END IF;

    -- ── Cenário C: médico com override (piso 5%, sem absoluto).
    INSERT INTO public.buyer_pricing_overrides (
      product_id, doctor_id,
      platform_min_unit_cents, platform_min_unit_pct,
      created_by_user_id, change_reason
    )
    VALUES (v_product_id, v_doctor_id, NULL, 5.00, v_admin_user, 'smoke 075 doctor override')
    RETURNING id INTO v_override_id_2;
    UPDATE _smoke_state_075 SET override_doctor = v_override_id_2;

    -- pct=5% × tier_unit=130000 → 6500
    v_result := public.resolve_effective_floor(v_product_id, NULL, v_doctor_id, 130000, now());
    IF v_result->>'source' <> 'buyer_override' THEN
      RAISE EXCEPTION 'mig075 smoke C: source expected buyer_override, got %', v_result;
    END IF;
    IF (v_result->>'floor_cents')::bigint <> 6500 THEN
      RAISE EXCEPTION 'mig075 smoke C: floor expected 6500 (5%% × 130000), got %', v_result;
    END IF;

    -- ── Cenário D: tenta inserir overlap (mesma clinic, mesmo product, range conflitante).
    --   Espera-se exception com SQLSTATE 23505 (unique_violation flavour).
    BEGIN
      INSERT INTO public.buyer_pricing_overrides (
        product_id, clinic_id,
        platform_min_unit_cents,
        created_by_user_id, change_reason
      )
      VALUES (v_product_id, v_clinic_id, 7000, v_admin_user, 'smoke 075 overlap');
      RAISE EXCEPTION 'mig075 smoke D: overlap insert SHOULD have failed';
    EXCEPTION WHEN unique_violation THEN
      NULL;  -- expected
    END;

    -- ── Cenário E: compute_unit_price respeita o override.
    --   Profile tier 1 = 1500 (R$ 1.500/u). Sem cupom.
    --   floor effective = override.6000 (mas pharmacy_cost=50000 > 6000)
    --   → compute eleva para 50000 (defesa INV-1).
    INSERT INTO public.pricing_profile_tiers (pricing_profile_id, min_quantity, max_quantity, unit_price_cents)
    VALUES (v_profile_id, 1, 10, 150000);

    v_compute := public.compute_unit_price(v_product_id, 1, v_clinic_id, NULL, NULL);
    IF (v_compute->'floor_breakdown'->>'source') <> 'buyer_override' THEN
      RAISE EXCEPTION 'mig075 smoke E: floor_breakdown.source expected buyer_override, got %', v_compute;
    END IF;
    IF (v_compute->>'effective_floor_cents')::bigint <> 50000 THEN
      -- Defesa INV-1 deveria elevar para pharmacy_cost.
      RAISE EXCEPTION 'mig075 smoke E: effective_floor expected 50000 (raised from override 6000 to pharmacy_cost), got %', v_compute;
    END IF;

    -- ── Cenário F: encerrar override e re-resolver no futuro.
    --   Como `now()` retorna o tempo de INÍCIO da transação (constante),
    --   tanto INSERT quanto UPDATE veem o mesmo timestamp dentro do
    --   mesmo DO block. effective_from = effective_until violaria o
    --   CHECK `effective_until > effective_from`. Usamos valores
    --   determinísticos +1h/+2h para forçar a ordem temporal.
    UPDATE public.buyer_pricing_overrides
       SET effective_until = effective_from + interval '1 hour'
     WHERE id = v_override_id_1;

    -- p_at avançado 2h: o override expirou há 1h.
    v_result := public.resolve_effective_floor(
      v_product_id, v_clinic_id, NULL, 130000,
      now() + interval '2 hours'
    );
    IF v_result->>'source' <> 'product' THEN
      RAISE EXCEPTION 'mig075 smoke F: source after expire expected product, got %', v_result;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    DELETE FROM public.buyer_pricing_overrides
      WHERE id IN (
        (SELECT override_clinic FROM _smoke_state_075),
        (SELECT override_doctor FROM _smoke_state_075)
      );
    DELETE FROM public.pricing_profile_tiers
      WHERE pricing_profile_id = (SELECT profile_id FROM _smoke_state_075);
    DELETE FROM public.pricing_profiles
      WHERE id = (SELECT profile_id FROM _smoke_state_075);
    DELETE FROM public.products
      WHERE id = (SELECT product_id FROM _smoke_state_075);
    RAISE;
  END;

  -- Cleanup happy path.
  DELETE FROM public.buyer_pricing_overrides
    WHERE id IN (
      (SELECT override_clinic FROM _smoke_state_075),
      (SELECT override_doctor FROM _smoke_state_075)
    );
  DELETE FROM public.pricing_profile_tiers
    WHERE pricing_profile_id = (SELECT profile_id FROM _smoke_state_075);
  DELETE FROM public.pricing_profiles
    WHERE id = (SELECT profile_id FROM _smoke_state_075);
  DELETE FROM public.products
    WHERE id = (SELECT product_id FROM _smoke_state_075);

  RAISE NOTICE 'Migration 075 smoke passed (6 scenarios verified end-to-end with override + product fallback)';
END
$smoke$;
