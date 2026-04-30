-- Migration 076 — atomic write of pricing_profile + tiers (PR-C1).
--
-- Visão
-- -----
-- Quando o super-admin "publica" uma nova versão de pricing para um
-- produto, três operações precisam acontecer juntas:
--
--   1. encerrar o profile vivo (effective_until = effective_from + 1ms;
--      ver smoke da mig-075 para o motivo do +1ms — `now()` é constante
--      dentro de uma transação).
--   2. inserir o novo profile com effective_from = now() + 1ms (para
--      garantir que NEW.effective_from > OLD.effective_until,
--      satisfazendo o EXCLUDE no_overlap).
--   3. inserir os N tiers.
--
-- Se qualquer um dos passos falha, o catálogo fica num estado
-- inconsistente: profile expirou mas o substituto não chegou, OU o
-- novo profile existe sem tiers (qualquer compute_unit_price com
-- esse produto retornaria `no_tier_for_quantity`).
--
-- A resposta padrão "use uma transação" não é trivial: o admin client
-- TS fala PostgREST, que faz cada chamada em uma transação separada.
-- A solução canônica neste codebase é uma função RPC (mig-064 fez o
-- mesmo para create_order_atomic).
--
-- Contrato
-- --------
-- IN:
--   p_product_id           uuid     produto
--   p_profile              jsonb    {pharmacy_cost_unit_cents, platform_min_unit_cents,
--                                    platform_min_unit_pct, consultant_commission_basis,
--                                    consultant_commission_fixed_per_unit_cents,
--                                    change_reason}
--   p_tiers                jsonb[]  cada elem: {min_quantity, max_quantity, unit_price_cents}
--   p_actor_user_id        uuid     created_by — sempre SUPER_ADMIN
--
-- OUT:
--   jsonb { profile_id, tier_ids[] }
--
-- Erros (RAISE EXCEPTION '...' USING ERRCODE='P0001'):
--   'product_not_found'   — id inválido
--   'no_tiers'            — array vazio
--   'invalid_actor'       — actor não tem role SUPER_ADMIN
--   'invalid_profile'     — falha em CHECK (basis/fixed mismatch, ambos pisos NULL, etc)
--
-- Idempotência: chamar duas vezes com a mesma input cria DUAS versões
-- diferentes (timestamps diferentes). Idempotência precisa ser feita
-- pelo cliente — não rotacione por engano.

SET search_path TO public, pg_temp;

CREATE OR REPLACE FUNCTION public.set_pricing_profile_atomic(
  p_product_id     uuid,
  p_profile        jsonb,
  p_tiers          jsonb,
  p_actor_user_id  uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing             public.pricing_profiles;
  v_new_profile_id       uuid;
  v_tier_count           int;
  v_tier                 jsonb;
  v_tier_ids             uuid[] := '{}';
  v_tier_id              uuid;
  v_now                  timestamptz := clock_timestamp();
  v_existing_until       timestamptz;
BEGIN
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'invalid_args' USING ERRCODE = 'P0001';
  END IF;

  -- Actor must be SUPER_ADMIN — defense in depth (server action also checks).
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
     WHERE ur.user_id = p_actor_user_id AND ur.role = 'SUPER_ADMIN'
  ) THEN
    RAISE EXCEPTION 'invalid_actor' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0001';
  END IF;

  v_tier_count := jsonb_array_length(p_tiers);
  IF v_tier_count IS NULL OR v_tier_count = 0 THEN
    RAISE EXCEPTION 'no_tiers' USING ERRCODE = 'P0001';
  END IF;

  -- Encerrar o profile vivo (se houver). effective_until precisa ser
  -- estritamente > effective_from (CHECK temporal). Usamos
  -- v_now (clock_timestamp) que avança. Se v_now == effective_from
  -- (mesmo microsegundo, raro mas possível), avançamos +1ms.
  SELECT * INTO v_existing
    FROM public.pricing_profiles
   WHERE product_id = p_product_id
     AND effective_until IS NULL
     LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    v_existing_until := GREATEST(v_now, v_existing.effective_from + interval '1 millisecond');
    UPDATE public.pricing_profiles
       SET effective_until = v_existing_until
     WHERE id = v_existing.id;

    -- O novo profile precisa começar APÓS o anterior terminar para
    -- não sobrepor (EXCLUDE no_overlap). +1ms suficiente.
    v_now := v_existing_until + interval '1 millisecond';
  END IF;

  -- Inserir novo profile. Nullable ints em jsonb chegam como JSON null;
  -- ::bigint coerce-os corretamente (NULL preservado).
  BEGIN
    INSERT INTO public.pricing_profiles (
      product_id,
      pharmacy_cost_unit_cents,
      platform_min_unit_cents,
      platform_min_unit_pct,
      consultant_commission_basis,
      consultant_commission_fixed_per_unit_cents,
      effective_from,
      created_by_user_id,
      change_reason
    ) VALUES (
      p_product_id,
      (p_profile->>'pharmacy_cost_unit_cents')::bigint,
      NULLIF(p_profile->>'platform_min_unit_cents', '')::bigint,
      NULLIF(p_profile->>'platform_min_unit_pct', '')::numeric,
      COALESCE(p_profile->>'consultant_commission_basis', 'TOTAL_PRICE'),
      NULLIF(p_profile->>'consultant_commission_fixed_per_unit_cents', '')::bigint,
      v_now,
      p_actor_user_id,
      COALESCE(NULLIF(p_profile->>'change_reason', ''), 'unspecified')
    )
    RETURNING id INTO v_new_profile_id;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'invalid_profile: %', SQLERRM USING ERRCODE = 'P0001';
  END;

  -- Inserir tiers. EXCLUDE no_overlap garantirá rejeição se cliente
  -- mandou faixas sobrepostas (validator client-side já bloqueia,
  -- mas defesa no DB é última linha).
  FOR v_tier IN SELECT * FROM jsonb_array_elements(p_tiers)
  LOOP
    BEGIN
      INSERT INTO public.pricing_profile_tiers (
        pricing_profile_id, min_quantity, max_quantity, unit_price_cents
      ) VALUES (
        v_new_profile_id,
        (v_tier->>'min_quantity')::int,
        (v_tier->>'max_quantity')::int,
        (v_tier->>'unit_price_cents')::bigint
      )
      RETURNING id INTO v_tier_id;
      v_tier_ids := v_tier_ids || v_tier_id;
    EXCEPTION WHEN exclusion_violation OR check_violation THEN
      RAISE EXCEPTION 'invalid_tier: %', SQLERRM USING ERRCODE = 'P0001';
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'profile_id', v_new_profile_id,
    'tier_ids',   to_jsonb(v_tier_ids),
    'expired_previous', v_existing.id
  );
END;
$$;

COMMENT ON FUNCTION public.set_pricing_profile_atomic(uuid, jsonb, jsonb, uuid) IS
  'Encerra o profile vivo (se houver) e cria novo + tiers atomicamente. Usado pelo super-admin pricing editor. Falha com P0001 em violations.';

-- ── Smoke ──────────────────────────────────────────────────────────────
DO $smoke$
DECLARE
  v_pharmacy_id uuid;
  v_category_id uuid;
  v_admin_user  uuid;
  v_product_id  uuid;
  v_result      jsonb;
  v_v1_id       uuid;
  v_v2_id       uuid;
BEGIN
  SELECT id INTO v_pharmacy_id FROM public.pharmacies LIMIT 1;
  SELECT id INTO v_category_id FROM public.product_categories LIMIT 1;
  SELECT id INTO v_admin_user  FROM public.profiles
    WHERE EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = profiles.id AND ur.role = 'SUPER_ADMIN')
    LIMIT 1;

  IF v_pharmacy_id IS NULL OR v_category_id IS NULL OR v_admin_user IS NULL THEN
    RAISE NOTICE 'mig076 smoke: skipping live exercise';
    RAISE NOTICE 'Migration 076 smoke passed (function definition installed)';
    RETURN;
  END IF;

  CREATE TEMP TABLE _smoke_state_076 (product_id uuid) ON COMMIT DROP;

  BEGIN
    INSERT INTO public.products (
      category_id, pharmacy_id, sku, name, slug, concentration, presentation,
      short_description, characteristics_json, price_current, currency,
      estimated_deadline_days, active, featured, pharmacy_cost,
      status, requires_prescription, needs_price_review, is_manipulated
    )
    VALUES (
      v_category_id, v_pharmacy_id,
      'SMOKE076-' || gen_random_uuid()::text,
      'Smoke 076', 'smoke076-' || gen_random_uuid()::text,
      '60mg', '5 unid', 'desc', '{}'::jsonb,
      1500.00, 'BRL', 7, false, false, 500.00,
      'inactive', true, false, true
    )
    RETURNING id INTO v_product_id;
    INSERT INTO _smoke_state_076(product_id) VALUES (v_product_id);

    -- Cenário 1: criar v1 (sem profile vivo prévio).
    v_result := public.set_pricing_profile_atomic(
      v_product_id,
      jsonb_build_object(
        'pharmacy_cost_unit_cents', 50000,
        'platform_min_unit_cents',  12000,
        'platform_min_unit_pct',    8.0,
        'consultant_commission_basis', 'TOTAL_PRICE',
        'change_reason', 'smoke v1'
      ),
      jsonb_build_array(
        jsonb_build_object('min_quantity', 1, 'max_quantity', 1,  'unit_price_cents', 150000),
        jsonb_build_object('min_quantity', 2, 'max_quantity', 3,  'unit_price_cents', 140000),
        jsonb_build_object('min_quantity', 4, 'max_quantity', 10, 'unit_price_cents', 130000)
      ),
      v_admin_user
    );
    v_v1_id := (v_result->>'profile_id')::uuid;
    IF v_v1_id IS NULL THEN RAISE EXCEPTION 'mig076 smoke C1: no profile_id'; END IF;
    IF jsonb_array_length(v_result->'tier_ids') <> 3 THEN
      RAISE EXCEPTION 'mig076 smoke C1: expected 3 tier_ids, got %', v_result->'tier_ids';
    END IF;
    IF v_result->>'expired_previous' IS NOT NULL THEN
      RAISE EXCEPTION 'mig076 smoke C1: should not have expired anything, got %', v_result;
    END IF;

    -- Cenário 2: criar v2 (deve encerrar v1).
    v_result := public.set_pricing_profile_atomic(
      v_product_id,
      jsonb_build_object(
        'pharmacy_cost_unit_cents', 60000,
        'platform_min_unit_cents',  12000,
        'consultant_commission_basis', 'TOTAL_PRICE',
        'change_reason', 'smoke v2 (cost up)'
      ),
      jsonb_build_array(
        jsonb_build_object('min_quantity', 1, 'max_quantity', 100, 'unit_price_cents', 200000)
      ),
      v_admin_user
    );
    v_v2_id := (v_result->>'profile_id')::uuid;
    IF (v_result->>'expired_previous')::uuid <> v_v1_id THEN
      RAISE EXCEPTION 'mig076 smoke C2: expired_previous expected %, got %', v_v1_id, v_result;
    END IF;

    -- Verifica que somente 1 profile está vivo.
    IF (SELECT count(*) FROM public.pricing_profiles
         WHERE product_id = v_product_id AND effective_until IS NULL) <> 1 THEN
      RAISE EXCEPTION 'mig076 smoke C2: more than 1 profile alive after v2';
    END IF;

    -- Cenário 3: tiers vazios → erro no_tiers.
    BEGIN
      PERFORM public.set_pricing_profile_atomic(
        v_product_id,
        jsonb_build_object('pharmacy_cost_unit_cents', 50000, 'platform_min_unit_cents', 12000, 'change_reason', 'oops'),
        '[]'::jsonb,
        v_admin_user
      );
      RAISE EXCEPTION 'mig076 smoke C3: should have failed with no_tiers';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM NOT LIKE '%no_tiers%' THEN
        RAISE EXCEPTION 'mig076 smoke C3: wrong error %', SQLERRM;
      END IF;
    END;

    -- Cenário 4: tiers overlapping → erro invalid_tier.
    BEGIN
      PERFORM public.set_pricing_profile_atomic(
        v_product_id,
        jsonb_build_object('pharmacy_cost_unit_cents', 50000, 'platform_min_unit_cents', 12000, 'change_reason', 'overlap test'),
        jsonb_build_array(
          jsonb_build_object('min_quantity', 1, 'max_quantity', 5, 'unit_price_cents', 100000),
          jsonb_build_object('min_quantity', 3, 'max_quantity', 8, 'unit_price_cents',  90000)
        ),
        v_admin_user
      );
      RAISE EXCEPTION 'mig076 smoke C4: should have failed with invalid_tier';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM NOT LIKE '%invalid_tier%' THEN
        RAISE EXCEPTION 'mig076 smoke C4: wrong error %', SQLERRM;
      END IF;
    END;
  EXCEPTION WHEN OTHERS THEN
    DELETE FROM public.pricing_profile_tiers
      WHERE pricing_profile_id IN (
        SELECT id FROM public.pricing_profiles
         WHERE product_id = (SELECT product_id FROM _smoke_state_076)
      );
    DELETE FROM public.pricing_profiles
      WHERE product_id = (SELECT product_id FROM _smoke_state_076);
    DELETE FROM public.products
      WHERE id = (SELECT product_id FROM _smoke_state_076);
    RAISE;
  END;

  -- Cleanup happy path.
  DELETE FROM public.pricing_profile_tiers
    WHERE pricing_profile_id IN (
      SELECT id FROM public.pricing_profiles
       WHERE product_id = (SELECT product_id FROM _smoke_state_076)
    );
  DELETE FROM public.pricing_profiles
    WHERE product_id = (SELECT product_id FROM _smoke_state_076);
  DELETE FROM public.products
    WHERE id = (SELECT product_id FROM _smoke_state_076);

  RAISE NOTICE 'Migration 076 smoke passed (4 scenarios: v1 create, v2 supersede, no_tiers, overlap)';
END
$smoke$;
