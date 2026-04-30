-- Migration 070 — Pricing Profiles + Tiers (PR-A do ADR-001).
--
-- Visão
-- -----
-- Hoje o produto tem dois preços fixos: `products.pharmacy_cost` e
-- `products.price_current`. Para magistrais (tirzepatida e companhia)
-- isso é insuficiente: a clínica negocia desconto por quantidade
-- (compra 3 = preço por unidade menor), e a plataforma exige um
-- mínimo de receita por unidade que não pode ser apagado por cupom
-- nem por degrau de tier.
--
-- Este migration instala APENAS o esqueleto de dados — não muda
-- comportamento de `freeze_order_item_price` ainda. O motor SQL
-- (`compute_unit_price`) é a migration 071. O ramo tiered no
-- freeze é a 072. A integração com confirm_payment_atomic é a 073.
--
-- A separação foi escolhida deliberadamente: cada migration é
-- aplicável e revertible isoladamente, e cada uma é coberta por
-- smoke checks que garantem o invariant que ela introduz.
--
-- Modelo
-- ------
-- pricing_profiles  → 1 produto pode ter N profiles ao longo do tempo
--                     (SCD-2). Apenas 1 vivo por instante (constraint
--                     EXCLUDE garante).
-- pricing_profile_tiers → cada profile tem N tiers (1..n). Faixas de
--                     quantidade não-overlapping (constraint EXCLUDE
--                     garante).
--
-- A coluna products.pricing_mode atua como flag opt-in: produtos
-- legados ficam em 'FIXED' (comportamento idêntico ao atual). Apenas
-- produtos marcados como 'TIERED_PROFILE' passam pelo motor novo.
-- Isso garante que o deploy desta funcionalidade é um no-op para o
-- catálogo existente até que um super-admin ative explicitamente.
--
-- Compliance
-- ----------
-- LGPD: nenhum dado pessoal aqui. Pricing é dado comercial / contratual.
-- Audit: mudanças em pricing_profiles geram audit_logs via trigger
--        em PR-C (UI). Por enquanto a coluna `change_reason` força
--        todo INSERT a deixar pegada textual mínima (não-vazia).
--
-- Rollback
-- --------
--   ALTER TABLE order_items DROP COLUMN pricing_profile_id;
--   ALTER TABLE products    DROP COLUMN pricing_mode;
--   DROP TABLE pricing_profile_tiers;
--   DROP TABLE pricing_profiles;
-- (Sem dados a preservar até PR-C; profiles novos não devem ter sido
-- criados ainda em produção quando essa migration roda.)

SET search_path TO public, extensions, pg_temp;

-- btree_gist é necessário para EXCLUDE com (uuid =, range &&). Já
-- está em uso em outra migration; IF NOT EXISTS é defensivo.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── pricing_profiles ───────────────────────────────────────────────────
--
-- SCD-2: cada mudança de preço de farmácia ou de tabela de tiers
-- materializa um NOVO profile com `effective_from = now()` e
-- congela o profile anterior preenchendo `effective_until = now()`.
-- Pedidos NOVOS pegam o vivo; pedidos antigos continuam apontando
-- para o profile que estava vivo na hora do `created_at` (via FK
-- order_items.pricing_profile_id, gravada pelo freeze trigger).
CREATE TABLE IF NOT EXISTS public.pricing_profiles (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id         uuid          NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,

  -- Custo da farmácia POR UNIDADE em centavos. Constante para um
  -- profile inteiro — se a farmácia repactuar custo, criamos um
  -- profile novo (encerra o anterior). pharmacy_cost CONST por unit
  -- é a base do INV-1 (pharmacy_transfer >= sum(pharmacy_cost × qty)).
  pharmacy_cost_unit_cents bigint   NOT NULL CHECK (pharmacy_cost_unit_cents > 0),

  -- Piso de receita da plataforma. Ao menos UM dos dois deve estar
  -- preenchido (CHECK na linha do final). Quando ambos estão, o
  -- floor efetivo = MAX(absolute, pct × tier_unit). Política do
  -- usuário: "120 reais OU 12% (o que for maior)" — primeira
  -- realização concreta da invariante INV-2.
  platform_min_unit_cents bigint    NULL CHECK (platform_min_unit_cents IS NULL OR platform_min_unit_cents > 0),
  platform_min_unit_pct   numeric(5,2) NULL CHECK (
                                            platform_min_unit_pct IS NULL OR
                                            (platform_min_unit_pct >= 0 AND platform_min_unit_pct <= 100)
                                          ),

  -- Como calcular a comissão de consultor para itens deste profile.
  -- TOTAL_PRICE: rate global × total (atual, default).
  -- PHARMACY_TRANSFER: rate global × pharmacy_transfer (= rate × pharmacy_cost × qty).
  -- FIXED_PER_UNIT: valor fixo por unidade vendida (ignora rate).
  consultant_commission_basis text NOT NULL DEFAULT 'TOTAL_PRICE'
    CHECK (consultant_commission_basis IN ('TOTAL_PRICE', 'PHARMACY_TRANSFER', 'FIXED_PER_UNIT')),
  consultant_commission_fixed_per_unit_cents bigint NULL
    CHECK (consultant_commission_fixed_per_unit_cents IS NULL OR consultant_commission_fixed_per_unit_cents >= 0),

  -- SCD-2 versioning. effective_until NULL = profile vivo.
  effective_from     timestamptz   NOT NULL DEFAULT now(),
  effective_until    timestamptz   NULL,
  CHECK (effective_until IS NULL OR effective_until > effective_from),

  -- Quem fez a mudança e por que. Ambos obrigatórios — nunca queremos
  -- discutir em retrospecto "por que o preço mudou neste dia".
  created_by_user_id uuid          NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  change_reason      text          NOT NULL CHECK (length(trim(change_reason)) > 0),
  created_at         timestamptz   NOT NULL DEFAULT now(),

  -- Pelo menos um dos dois pisos deve estar definido. Profile sem
  -- piso permitiria final_price < pharmacy_cost (INV-1 violada),
  -- ou platform_commission negativa.
  CHECK (platform_min_unit_cents IS NOT NULL OR platform_min_unit_pct IS NOT NULL),

  -- Se o consultor recebe valor fixo por unidade, esse valor não
  -- pode exceder o piso absoluto da plataforma — caso contrário o
  -- INV-4 (consultant <= platform) é matematicamente impossível em
  -- pelo menos um cenário (preço final = floor exato). Não-fixed
  -- ramos têm o cap aplicado em runtime no compute_unit_price.
  CHECK (
    consultant_commission_basis <> 'FIXED_PER_UNIT'
    OR consultant_commission_fixed_per_unit_cents IS NOT NULL
  ),
  CHECK (
    consultant_commission_basis <> 'FIXED_PER_UNIT'
    OR platform_min_unit_cents  IS NULL
    OR consultant_commission_fixed_per_unit_cents <= platform_min_unit_cents
  )
);

-- Apenas 1 profile vivo por produto a qualquer instante.
-- tstzrange é usado com `[)` (default: inclusive lower, exclusive upper).
-- effective_until NULL é tratado como +infinity por tstzrange — exatamente
-- o que queremos.
DO $excl$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pricing_profiles_no_overlap'
  ) THEN
    ALTER TABLE public.pricing_profiles
      ADD CONSTRAINT pricing_profiles_no_overlap
      EXCLUDE USING gist (
        product_id WITH =,
        tstzrange(effective_from, effective_until, '[)') WITH &&
      );
  END IF;
END
$excl$;

-- Lookup quente: "qual o profile vivo deste produto agora?".
-- Index parcial sobre apenas as linhas vivas (effective_until IS NULL)
-- — ~1 por produto. Catálogo tem dezenas, então o índice é diminuto.
CREATE INDEX IF NOT EXISTS ix_pricing_profiles_active
  ON public.pricing_profiles(product_id)
  WHERE effective_until IS NULL;

-- Lookup morno: "qual era o profile vivo neste timestamp passado?".
-- Usado por reprocessamento e auditorias (pedidos com data anterior
-- a uma virada de profile). BRIN é suficiente — efectivamente sequencial
-- em created_at, e a tabela cresce devagar.
CREATE INDEX IF NOT EXISTS ix_pricing_profiles_temporal
  ON public.pricing_profiles USING brin (effective_from, effective_until);

-- ── pricing_profile_tiers ──────────────────────────────────────────────
--
-- 1..N por profile. Faixas de quantidade contíguas e cobrindo todo
-- o intervalo razoável (do min ao max produto-permite).
CREATE TABLE IF NOT EXISTS public.pricing_profile_tiers (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  pricing_profile_id uuid          NOT NULL REFERENCES public.pricing_profiles(id) ON DELETE CASCADE,
  min_quantity       int           NOT NULL CHECK (min_quantity > 0),
  max_quantity       int           NOT NULL CHECK (max_quantity >= min_quantity),
  -- Preço por unidade que a clínica/médico paga ANTES de cupom,
  -- para qualquer quantidade dentro da faixa [min, max].
  unit_price_cents   bigint        NOT NULL CHECK (unit_price_cents > 0)
);

-- Faixas de quantidade não podem se sobrepor dentro de um mesmo
-- profile. Usar int4range '[]' (inclusive em ambos os lados): tier
-- 1..1 e tier 2..3 não conflitam; tier 1..2 e tier 2..3 conflitam.
DO $excl$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pricing_profile_tiers_no_overlap'
  ) THEN
    ALTER TABLE public.pricing_profile_tiers
      ADD CONSTRAINT pricing_profile_tiers_no_overlap
      EXCLUDE USING gist (
        pricing_profile_id WITH =,
        int4range(min_quantity, max_quantity, '[]') WITH &&
      );
  END IF;
END
$excl$;

CREATE INDEX IF NOT EXISTS ix_pricing_profile_tiers_lookup
  ON public.pricing_profile_tiers(pricing_profile_id, min_quantity);

-- ── products.pricing_mode ──────────────────────────────────────────────
--
-- Flag opt-in. Produtos antigos ficam em 'FIXED' (semantica do
-- freeze-trigger atual). Apenas produtos marcados como
-- 'TIERED_PROFILE' passam a ler de pricing_profiles na 072.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS pricing_mode text NOT NULL DEFAULT 'FIXED'
    CHECK (pricing_mode IN ('FIXED', 'TIERED_PROFILE'));

-- ── order_items.pricing_profile_id ─────────────────────────────────────
--
-- Forensics + idempotência: depois que o item foi congelado (BEFORE
-- INSERT), guardamos qual profile o motor usou. Em caso de
-- refund / análise / audit: temos identidade exata. Sem isto,
-- reconstruir o preço a partir de SCD-2 é caro (procurar profile
-- vivo no created_at do item).
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS pricing_profile_id uuid NULL
    REFERENCES public.pricing_profiles(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS ix_order_items_pricing_profile
  ON public.order_items(pricing_profile_id)
  WHERE pricing_profile_id IS NOT NULL;

-- ── RLS ────────────────────────────────────────────────────────────────
--
-- pricing_profiles e pricing_profile_tiers são CONFIGURAÇÃO da plataforma.
-- Ler: SUPER_ADMIN/PLATFORM_ADMIN. Pharmacy só vê os seus profiles
--      (filter por products.pharmacy_id).
-- Escrever: SUPER_ADMIN apenas. Toda escrita passa por server action
--           com auditoria (PR-C).
--
-- A política aqui é necessária para o safety-net da migration 057
-- (que falha CI se uma tabela nova existir sem RLS habilitada).

ALTER TABLE public.pricing_profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_profile_tiers   ENABLE ROW LEVEL SECURITY;

-- Service-role bypassa RLS por construção; declarações abaixo cobrem
-- usuários autenticados via Supabase auth.

DROP POLICY IF EXISTS pp_select_admin ON public.pricing_profiles;
CREATE POLICY pp_select_admin ON public.pricing_profiles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
       WHERE ur.user_id = auth.uid()
         AND ur.role IN ('SUPER_ADMIN', 'PLATFORM_ADMIN')
    )
  );

DROP POLICY IF EXISTS pp_select_pharmacy ON public.pricing_profiles;
CREATE POLICY pp_select_pharmacy ON public.pricing_profiles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.products p
        JOIN public.pharmacy_members pm ON pm.pharmacy_id = p.pharmacy_id
       WHERE p.id = pricing_profiles.product_id
         AND pm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS pp_write_super_admin ON public.pricing_profiles;
CREATE POLICY pp_write_super_admin ON public.pricing_profiles
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
       WHERE ur.user_id = auth.uid() AND ur.role = 'SUPER_ADMIN'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
       WHERE ur.user_id = auth.uid() AND ur.role = 'SUPER_ADMIN'
    )
  );

-- Tiers herdam permissão do profile pai. Read: quem pode ler o
-- profile pode ler os tiers. Write: SUPER_ADMIN apenas.
DROP POLICY IF EXISTS ppt_select ON public.pricing_profile_tiers;
CREATE POLICY ppt_select ON public.pricing_profile_tiers
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.pricing_profiles pp
       WHERE pp.id = pricing_profile_tiers.pricing_profile_id
    )
  );

DROP POLICY IF EXISTS ppt_write_super_admin ON public.pricing_profile_tiers;
CREATE POLICY ppt_write_super_admin ON public.pricing_profile_tiers
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
       WHERE ur.user_id = auth.uid() AND ur.role = 'SUPER_ADMIN'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
       WHERE ur.user_id = auth.uid() AND ur.role = 'SUPER_ADMIN'
    )
  );

-- ── Smoke ──────────────────────────────────────────────────────────────
DO $smoke$
DECLARE
  v_pricing_profiles_exists       boolean;
  v_tiers_exists                  boolean;
  v_pricing_mode_exists           boolean;
  v_pricing_profile_id_exists     boolean;
  v_excl_profiles                 boolean;
  v_excl_tiers                    boolean;
  v_default_pricing_mode          text;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='pricing_profiles')
    INTO v_pricing_profiles_exists;
  SELECT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='pricing_profile_tiers')
    INTO v_tiers_exists;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='products' AND column_name='pricing_mode')
    INTO v_pricing_mode_exists;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='order_items' AND column_name='pricing_profile_id')
    INTO v_pricing_profile_id_exists;
  SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pricing_profiles_no_overlap')
    INTO v_excl_profiles;
  SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pricing_profile_tiers_no_overlap')
    INTO v_excl_tiers;
  SELECT column_default FROM information_schema.columns
   WHERE table_schema='public' AND table_name='products' AND column_name='pricing_mode'
    INTO v_default_pricing_mode;

  IF NOT v_pricing_profiles_exists       THEN RAISE EXCEPTION 'mig070 smoke: pricing_profiles missing'; END IF;
  IF NOT v_tiers_exists                  THEN RAISE EXCEPTION 'mig070 smoke: pricing_profile_tiers missing'; END IF;
  IF NOT v_pricing_mode_exists           THEN RAISE EXCEPTION 'mig070 smoke: products.pricing_mode missing'; END IF;
  IF NOT v_pricing_profile_id_exists     THEN RAISE EXCEPTION 'mig070 smoke: order_items.pricing_profile_id missing'; END IF;
  IF NOT v_excl_profiles                 THEN RAISE EXCEPTION 'mig070 smoke: pricing_profiles_no_overlap missing'; END IF;
  IF NOT v_excl_tiers                    THEN RAISE EXCEPTION 'mig070 smoke: pricing_profile_tiers_no_overlap missing'; END IF;
  IF v_default_pricing_mode IS NULL OR v_default_pricing_mode NOT LIKE '%FIXED%' THEN
    RAISE EXCEPTION 'mig070 smoke: products.pricing_mode default must be FIXED, got %', v_default_pricing_mode;
  END IF;

  RAISE NOTICE 'Migration 070 smoke passed (pricing_profiles + tiers + flags)';
END
$smoke$;
