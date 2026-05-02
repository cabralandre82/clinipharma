-- Migration 082 — sincronizar campos legados ao publicar pricing_profile.
--
-- Bug observado em produção
-- -------------------------
-- Após o usuário publicar uma nova versão de pricing_profile via
-- `set_pricing_profile_atomic` (mig-076), a página `/products` (e a
-- página de detalhe `/products/[id]`, catálogo, busca global, dashboard,
-- relatórios, etc.) continuava mostrando os valores antigos. Causa raiz:
-- a RPC só escreve em `pricing_profiles` + `pricing_profile_tiers`,
-- nunca toca em `products.price_current` nem `products.pharmacy_cost` —
-- esses dois campos legados são lidos por DEZENAS de páginas/componentes
-- (catalog, orders, reports, my-pharmacy, dashboard, global-search…) e
-- só são atualizados pelos forms `PriceUpdateForm` / `PharmacyCostUpdateForm`,
-- não pelo profile.
--
-- Drift real (Progesterona 200mg, prod, 2026-05-01):
--   legacy_price_brl   R$    190,00   (campo `price_current`)
--   legacy_cost_brl    R$    100,00   (campo `pharmacy_cost`)
--   profile_cost_brl   R$  1.000,00   (`pharmacy_cost_unit_cents`)
--   profile_tier1_brl  R$  1.900,00   (preço do tier de menor quantidade)
--
-- Diferença de 10× — confunde a farmácia (vê repasse errado) e o
-- super-admin (vê preço errado na listagem).
--
-- Correção
-- --------
-- Duas mudanças, ambas idempotentes e seguras de re-rodar:
--
-- 1) `set_pricing_profile_atomic` ganha um UPDATE final em `products`
--    sincronizando `price_current` (= preço do tier de menor quantidade,
--    em REAIS) e `pharmacy_cost` (= `pharmacy_cost_unit_cents/100`).
--    Também marca `needs_price_review = false` — o operador acabou de
--    revisar; se ainda precisa de revisão, vai marcar manualmente. E
--    bumpa `updated_at` para que webhooks/observers detectem a mudança.
--
-- 2) Backfill ONE-TIME: para cada produto com pricing_profile vivo,
--    aplica o mesmo UPDATE com base no profile atual. Idempotente —
--    rodar 2× produz o mesmo estado.
--
-- Por que NÃO derivar `price_current` de uma view/coluna gerada
-- ----------------------------------------------------------------
-- - Coluna gerada (`GENERATED ALWAYS AS … STORED`) precisaria de uma
--   subquery → não permitido pelo Postgres.
-- - View materializada quebra escritas por código legado que ainda
--   atualiza `price_current` diretamente (PriceUpdateForm).
-- - Trigger AFTER INSERT em `pricing_profile_tiers` resolveria, MAS o
--   trigger não sabe quando o profile inteiro foi finalizado (insere
--   tiers em loop). Atualizar APÓS o último insert da RPC é mais
--   correto e mais simples.
--
-- Compatibilidade: RPC mantém assinatura idêntica e mesmo retorno;
-- consumidores existentes (services/pricing.ts) não notam diferença,
-- só ganham o efeito colateral de sincronizar.
--
-- Rollback: re-criar 076's função sem o bloco de sync. Os campos
-- `price_current`/`pharmacy_cost` voltariam a divergir mas nada quebra.

SET search_path TO public, pg_temp;

-- ── 1) Função sincronizadora ──────────────────────────────────────────

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
  v_pharmacy_cost_cents  bigint;
  v_tier1_cents          bigint;
BEGIN
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'invalid_args' USING ERRCODE = 'P0001';
  END IF;

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

    v_now := v_existing_until + interval '1 millisecond';
  END IF;

  v_pharmacy_cost_cents := (p_profile->>'pharmacy_cost_unit_cents')::bigint;

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
      v_pharmacy_cost_cents,
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

  -- Inserir tiers, capturando o preço do tier base (menor min_quantity)
  -- para sincronizar com `products.price_current` ao final. O loop já
  -- garante ordem de inserção mas não ordem ASC; portanto resolvemos
  -- via SELECT após o LOOP.
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

  -- ── Sync legado ──────────────────────────────────────────────────
  -- Tier base = o tier de menor `min_quantity` (geralmente 1u). Esse
  -- é o "preço de catálogo" que aparece em listagens / busca / cards.
  -- Conversão cents → REAIS (numeric) porque os campos legados ainda
  -- são `numeric` e não foram migrados para `_cents` (mig-050 cobriu
  -- transfers e order_items, mas `products.price_current` e
  -- `products.pharmacy_cost` ficaram em REAIS por compatibilidade
  -- com formulários antigos).
  SELECT unit_price_cents INTO v_tier1_cents
    FROM public.pricing_profile_tiers
   WHERE pricing_profile_id = v_new_profile_id
   ORDER BY min_quantity ASC
   LIMIT 1;

  UPDATE public.products
     SET price_current      = (v_tier1_cents::numeric) / 100.0,
         pharmacy_cost      = (v_pharmacy_cost_cents::numeric) / 100.0,
         needs_price_review = false,
         updated_at         = clock_timestamp()
   WHERE id = p_product_id;

  RETURN jsonb_build_object(
    'profile_id', v_new_profile_id,
    'tier_ids',   to_jsonb(v_tier_ids),
    'expired_previous', v_existing.id,
    'synced_price_brl',         (v_tier1_cents::numeric)/100.0,
    'synced_pharmacy_cost_brl', (v_pharmacy_cost_cents::numeric)/100.0
  );
END;
$$;

COMMENT ON FUNCTION public.set_pricing_profile_atomic(uuid, jsonb, jsonb, uuid) IS
  'Encerra o profile vivo (se houver) e cria novo + tiers atomicamente, e SINCRONIZA products.price_current/pharmacy_cost (mig-082). Falha com P0001 em violations.';

-- ── 2) Backfill ONE-TIME ──────────────────────────────────────────────
--
-- Aplica o mesmo UPDATE para todos os produtos que JÁ TÊM pricing_profile
-- vivo no momento da migration. Idempotente: re-rodar produz o mesmo
-- resultado (campos viram o mesmo valor).
--
-- NÃO mexe em produtos sem profile vivo — esses continuam no fluxo FIXED
-- e podem ter sido editados via PriceUpdateForm/PharmacyCostUpdateForm.
DO $backfill$
DECLARE
  v_row record;
  v_updated int := 0;
BEGIN
  FOR v_row IN
    SELECT
      pp.product_id,
      pp.pharmacy_cost_unit_cents,
      (
        SELECT t.unit_price_cents
          FROM public.pricing_profile_tiers t
         WHERE t.pricing_profile_id = pp.id
         ORDER BY t.min_quantity ASC
         LIMIT 1
      ) AS tier1_cents,
      p.price_current AS old_price,
      p.pharmacy_cost AS old_cost
    FROM public.pricing_profiles pp
    JOIN public.products p ON p.id = pp.product_id
    WHERE pp.effective_until IS NULL
  LOOP
    IF v_row.tier1_cents IS NULL THEN
      RAISE NOTICE 'mig082 backfill: product % has profile but zero tiers, skipping',
        v_row.product_id;
      CONTINUE;
    END IF;

    UPDATE public.products
       SET price_current      = (v_row.tier1_cents::numeric) / 100.0,
           pharmacy_cost      = (v_row.pharmacy_cost_unit_cents::numeric) / 100.0,
           needs_price_review = false,
           updated_at         = clock_timestamp()
     WHERE id = v_row.product_id;

    v_updated := v_updated + 1;
    RAISE NOTICE 'mig082 backfill: product %  price % → %  cost % → %',
      v_row.product_id,
      v_row.old_price, (v_row.tier1_cents::numeric)/100.0,
      v_row.old_cost,  (v_row.pharmacy_cost_unit_cents::numeric)/100.0;
  END LOOP;

  RAISE NOTICE 'mig082 backfill: % product(s) sincronizado(s) com seu profile vivo', v_updated;
END
$backfill$;

-- ── 3) Smoke ──────────────────────────────────────────────────────────
DO $smoke$
DECLARE
  v_pharmacy_id uuid;
  v_category_id uuid;
  v_admin_user  uuid;
  v_product_id  uuid;
  v_result      jsonb;
  v_price_after numeric;
  v_cost_after  numeric;
BEGIN
  SELECT id INTO v_pharmacy_id FROM public.pharmacies LIMIT 1;
  SELECT id INTO v_category_id FROM public.product_categories LIMIT 1;
  SELECT id INTO v_admin_user
    FROM public.profiles
   WHERE EXISTS (SELECT 1 FROM public.user_roles ur
                 WHERE ur.user_id = profiles.id AND ur.role = 'SUPER_ADMIN')
   LIMIT 1;

  IF v_pharmacy_id IS NULL OR v_category_id IS NULL OR v_admin_user IS NULL THEN
    RAISE NOTICE 'mig082 smoke: prerequisites missing — skipping live exercise';
    RETURN;
  END IF;

  -- Cria produto temporário
  INSERT INTO public.products (
    category_id, pharmacy_id, sku, name, slug, concentration, presentation,
    short_description, characteristics_json, price_current, currency,
    estimated_deadline_days, active, featured, pharmacy_cost,
    status, requires_prescription, needs_price_review, is_manipulated
  )
  VALUES (
    v_category_id, v_pharmacy_id,
    'SMOKE082-' || gen_random_uuid()::text,
    'Smoke 082', 'smoke082-' || gen_random_uuid()::text,
    '60mg', '5 unid', 'desc', '{}'::jsonb,
    1.00, 'BRL', 7, false, false, 0.50,
    'inactive', true, true, true
  )
  RETURNING id INTO v_product_id;

  BEGIN
    -- Publica profile com tier1=1500.00 (150000 cents) e cost=500.00 (50000 cents)
    v_result := public.set_pricing_profile_atomic(
      v_product_id,
      jsonb_build_object(
        'pharmacy_cost_unit_cents', 50000,
        'platform_min_unit_cents', 12000,
        'consultant_commission_basis', 'TOTAL_PRICE',
        'change_reason', 'mig082 smoke'
      ),
      jsonb_build_array(
        jsonb_build_object('min_quantity', 1, 'max_quantity', 1,  'unit_price_cents', 150000),
        jsonb_build_object('min_quantity', 2, 'max_quantity', 5,  'unit_price_cents', 140000),
        jsonb_build_object('min_quantity', 6, 'max_quantity', 10, 'unit_price_cents', 130000)
      ),
      v_admin_user
    );

    -- Verifica retorno enriquecido
    IF (v_result->>'synced_price_brl')::numeric <> 1500.00 THEN
      RAISE EXCEPTION 'mig082 smoke: synced_price_brl expected 1500, got %', v_result;
    END IF;
    IF (v_result->>'synced_pharmacy_cost_brl')::numeric <> 500.00 THEN
      RAISE EXCEPTION 'mig082 smoke: synced_pharmacy_cost_brl expected 500, got %', v_result;
    END IF;

    -- Verifica products realmente sincronizou
    SELECT price_current, pharmacy_cost
      INTO v_price_after, v_cost_after
      FROM public.products WHERE id = v_product_id;

    IF v_price_after <> 1500.00 THEN
      RAISE EXCEPTION 'mig082 smoke: products.price_current expected 1500, got %', v_price_after;
    END IF;
    IF v_cost_after <> 500.00 THEN
      RAISE EXCEPTION 'mig082 smoke: products.pharmacy_cost expected 500, got %', v_cost_after;
    END IF;
    IF (SELECT needs_price_review FROM public.products WHERE id = v_product_id) <> false THEN
      RAISE EXCEPTION 'mig082 smoke: needs_price_review should be false after publish';
    END IF;

    -- Re-publica com valores diferentes — deve sincronizar de novo
    v_result := public.set_pricing_profile_atomic(
      v_product_id,
      jsonb_build_object(
        'pharmacy_cost_unit_cents', 60000,
        'platform_min_unit_cents', 12000,
        'consultant_commission_basis', 'TOTAL_PRICE',
        'change_reason', 'mig082 smoke v2'
      ),
      jsonb_build_array(
        jsonb_build_object('min_quantity', 1, 'max_quantity', 100, 'unit_price_cents', 200000)
      ),
      v_admin_user
    );

    SELECT price_current, pharmacy_cost
      INTO v_price_after, v_cost_after
      FROM public.products WHERE id = v_product_id;
    IF v_price_after <> 2000.00 THEN
      RAISE EXCEPTION 'mig082 smoke v2: price_current expected 2000, got %', v_price_after;
    END IF;
    IF v_cost_after <> 600.00 THEN
      RAISE EXCEPTION 'mig082 smoke v2: pharmacy_cost expected 600, got %', v_cost_after;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    DELETE FROM public.pricing_profile_tiers
      WHERE pricing_profile_id IN (
        SELECT id FROM public.pricing_profiles WHERE product_id = v_product_id
      );
    DELETE FROM public.pricing_profiles WHERE product_id = v_product_id;
    DELETE FROM public.products WHERE id = v_product_id;
    RAISE;
  END;

  -- Cleanup happy path
  DELETE FROM public.pricing_profile_tiers
    WHERE pricing_profile_id IN (
      SELECT id FROM public.pricing_profiles WHERE product_id = v_product_id
    );
  DELETE FROM public.pricing_profiles WHERE product_id = v_product_id;
  DELETE FROM public.products WHERE id = v_product_id;

  RAISE NOTICE 'Migration 082 smoke passed (sync on insert + sync on republish)';
END
$smoke$;
