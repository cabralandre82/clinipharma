-- Migration 083 — relaxar coupons_discount_value_check para acomodar TIER_UPGRADE
--
-- Contexto / por quê
-- ------------------
-- A migração 027 (criação da tabela `coupons`) declarou:
--
--   discount_value numeric(10,4) NOT NULL CHECK (discount_value > 0)
--
-- Esse CHECK inline foi nomeado pelo PostgreSQL como
-- `coupons_discount_value_check`. Na época só existiam 2 tipos de cupom
-- (PERCENT, FIXED), e ambos exigiam valor estritamente positivo.
--
-- A migração 079 (ADR-002) adicionou 3 tipos novos:
--   - FIRST_UNIT_DISCOUNT  → usa discount_value (R$/un na 1ª unidade)
--   - TIER_UPGRADE         → NÃO usa discount_value (usa tier_promotion_steps)
--   - MIN_QTY_PERCENT      → usa discount_value (% com gate de quantidade)
--
-- Para `TIER_UPGRADE` o discount_value é semanticamente irrelevante — o
-- desconto vem da diferença entre o tier base e o tier-alvo (calculada
-- pelo helper `_pricing_tier_n_steps_up`). O Zod do app aceita `0` para
-- esse tipo (ver `services/coupons.ts` linha 46-48), e o `compute_unit_price`
-- da 079 sabe ignorar discount_value para TIER_UPGRADE. Mas a 079 esqueceu
-- de relaxar o CHECK legacy de 027 — então qualquer tentativa de criar
-- um TIER_UPGRADE com discount_value=0 quebra com:
--
--   SQLSTATE 23514: new row for relation "coupons" violates check
--   constraint "coupons_discount_value_check"
--
-- Bug observado em produção em 2026-05-02 17:13 UTC quando o operador
-- tentou substituir um cupom por um novo TIER_UPGRADE via UI de admin.
-- O RPC `replace_active_coupon` (migração 081) propagou o erro pra cima
-- como `[coupons/create] replace rpc failed` no `server_logs`.
--
-- Solução
-- -------
-- 1. DROP do CHECK auto-gerado `coupons_discount_value_check`.
-- 2. ADD CONSTRAINT nomeado `coupons_discount_value_by_type` que
--    permite discount_value=0 SOMENTE para TIER_UPGRADE (que é o único
--    que legitimamente não usa o campo). Para qualquer outro tipo
--    mantém `> 0` — qualquer valor inválido pra PERCENT/FIXED/
--    FIRST_UNIT_DISCOUNT/MIN_QTY_PERCENT continua sendo rejeitado.
--
-- Compatibilidade / regressão
-- ---------------------------
-- - Coupons já existentes têm discount_value > 0 (PERCENT/FIXED). O novo
--   constraint é estritamente MAIS permissivo: tudo que passava antes
--   continua passando. Sem necessidade de backfill ou validação prévia.
-- - O Zod do app já aceitava `min(0)` — só o banco rejeitava. Após esta
--   migração, fluxo client→banco fica coerente.
-- - O `coupons_type_consistency` (já existente em 079) continua exigindo
--   `tier_promotion_steps > 0` para TIER_UPGRADE — então não dá pra
--   criar um TIER_UPGRADE inerte (com discount_value=0 E
--   tier_promotion_steps=0). As duas defesas se complementam.
--
-- Idempotência: usa IF EXISTS / NOT EXISTS na manipulação de constraint.
--
-- Rollback (se realmente precisar restaurar o CHECK estrito):
--   ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_discount_value_by_type;
--   ALTER TABLE public.coupons ADD CONSTRAINT coupons_discount_value_check
--     CHECK (discount_value > 0);
--   (Antes do rollback, deletar/converter linhas TIER_UPGRADE com discount_value=0.)

BEGIN;

-- 1) Drop do CHECK legacy auto-gerado.
ALTER TABLE public.coupons
  DROP CONSTRAINT IF EXISTS coupons_discount_value_check;

-- 2) Add constraint nomeado, type-aware.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'coupons_discount_value_by_type'
       AND conrelid = 'public.coupons'::regclass
  ) THEN
    ALTER TABLE public.coupons
      ADD CONSTRAINT coupons_discount_value_by_type
      CHECK (
        CASE discount_type
          -- TIER_UPGRADE não usa discount_value; aceita 0 ou positivo.
          -- (negativo nunca é válido em nenhum cenário.)
          WHEN 'TIER_UPGRADE' THEN discount_value >= 0
          -- Todos os outros tipos exigem valor estritamente positivo.
          ELSE discount_value > 0
        END
      );
  END IF;
END
$$;

COMMENT ON CONSTRAINT coupons_discount_value_by_type ON public.coupons IS
  'ADR-002: TIER_UPGRADE aceita discount_value=0 (efeito vem de tier_promotion_steps); demais tipos exigem > 0. Substitui o coupons_discount_value_check da migração 027 que era inflexível por tipo.';

-- ─── Smoke test inline ─────────────────────────────────────────────────
-- Verifica:
--   (a) Constraint legacy foi removido.
--   (b) Novo constraint existe e está válido.
--   (c) TIER_UPGRADE com discount_value=0 é aceito (caso que reproduzia o bug).
--   (d) PERCENT com discount_value=0 ainda é rejeitado (regressão guard).
--   (e) discount_value negativo é rejeitado em qualquer tipo.

DO $$
DECLARE
  v_clinic_id uuid;
  v_product_id uuid;
  v_inserted_id uuid;
  v_legacy_exists boolean;
  v_new_exists boolean;
BEGIN
  -- (a) + (b) introspecção
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'coupons_discount_value_check'
       AND conrelid = 'public.coupons'::regclass
  ) INTO v_legacy_exists;
  IF v_legacy_exists THEN
    RAISE EXCEPTION 'mig083 smoke FAIL: coupons_discount_value_check ainda existe (deveria ter sido dropado)';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'coupons_discount_value_by_type'
       AND conrelid = 'public.coupons'::regclass
       AND convalidated = true
  ) INTO v_new_exists;
  IF NOT v_new_exists THEN
    RAISE EXCEPTION 'mig083 smoke FAIL: coupons_discount_value_by_type não existe ou não está validado';
  END IF;

  -- Encontrar uma clínica e um produto reais para o teste (em vez de
  -- inventar UUIDs que vão violar FK). Se não houver, pula a parte de
  -- INSERT — a introspecção (a)+(b) já cobre o essencial.
  SELECT id INTO v_clinic_id FROM public.clinics LIMIT 1;
  SELECT id INTO v_product_id FROM public.products LIMIT 1;

  IF v_clinic_id IS NULL OR v_product_id IS NULL THEN
    RAISE NOTICE 'mig083 smoke: pulando (c)/(d)/(e) — sem clínicas/produtos no banco';
    RETURN;
  END IF;

  -- Precisamos de um created_by_user_id válido (FK pra auth.users).
  -- Pegamos qualquer admin existente — se não houver, pulamos os INSERTs.
  DECLARE v_user_id uuid;
  BEGIN
    SELECT id INTO v_user_id FROM auth.users LIMIT 1;
    IF v_user_id IS NULL THEN
      RAISE NOTICE 'mig083 smoke: pulando (c)/(d)/(e) — sem usuários no banco';
      RETURN;
    END IF;

    -- (c) TIER_UPGRADE com discount_value=0 deve ser ACEITO agora.
    BEGIN
      INSERT INTO public.coupons (
        code, clinic_id, product_id, discount_type, discount_value,
        tier_promotion_steps, valid_from, active, created_by_user_id
      ) VALUES (
        'MIG083-SMOKE-OK-' || extract(epoch from now())::text,
        v_clinic_id, v_product_id, 'TIER_UPGRADE', 0,
        1, now(), true, v_user_id
      ) RETURNING id INTO v_inserted_id;
      -- Cleanup imediato — este cupom é só para smoke.
      DELETE FROM public.coupons WHERE id = v_inserted_id;
    EXCEPTION WHEN check_violation THEN
      RAISE EXCEPTION 'mig083 smoke FAIL (c): TIER_UPGRADE com discount_value=0 foi REJEITADO (esperado: aceito) — sqlstate=%, message=%', SQLSTATE, SQLERRM;
    END;

    -- (d) PERCENT com discount_value=0 deve continuar REJEITADO.
    BEGIN
      INSERT INTO public.coupons (
        code, clinic_id, product_id, discount_type, discount_value,
        valid_from, active, created_by_user_id
      ) VALUES (
        'MIG083-SMOKE-FAIL-PCT-' || extract(epoch from now())::text,
        v_clinic_id, v_product_id, 'PERCENT', 0,
        now(), true, v_user_id
      );
      -- Se chegou aqui, o constraint não está protegendo PERCENT.
      DELETE FROM public.coupons WHERE code LIKE 'MIG083-SMOKE-FAIL-PCT%';
      RAISE EXCEPTION 'mig083 smoke FAIL (d): PERCENT com discount_value=0 foi ACEITO (esperado: rejeitado)';
    EXCEPTION WHEN check_violation THEN
      -- Esperado.
      NULL;
    END;

    -- (e) discount_value negativo é rejeitado mesmo em TIER_UPGRADE.
    BEGIN
      INSERT INTO public.coupons (
        code, clinic_id, product_id, discount_type, discount_value,
        tier_promotion_steps, valid_from, active, created_by_user_id
      ) VALUES (
        'MIG083-SMOKE-FAIL-NEG-' || extract(epoch from now())::text,
        v_clinic_id, v_product_id, 'TIER_UPGRADE', -1,
        1, now(), true, v_user_id
      );
      DELETE FROM public.coupons WHERE code LIKE 'MIG083-SMOKE-FAIL-NEG%';
      RAISE EXCEPTION 'mig083 smoke FAIL (e): discount_value=-1 em TIER_UPGRADE foi ACEITO (esperado: rejeitado)';
    EXCEPTION WHEN check_violation THEN
      -- Esperado.
      NULL;
    END;
  END;

  RAISE NOTICE 'mig083 smoke OK — constraint type-aware funcionando';
END
$$;

COMMIT;
