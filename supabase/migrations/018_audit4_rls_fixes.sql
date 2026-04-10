-- ============================================================
-- Clinipharma — Migration 018: Auditoria 4 — RLS Fixes
-- ============================================================
-- Bugs encontrados:
-- 1. order_operational_updates — RLS não habilitado (qualquer usuário
--    autenticado podia ler/escrever atualizações operacionais de qualquer pedido)
-- 2. pharmacy_products — RLS não habilitado (expunha associações
--    farmácia-produto a qualquer usuário autenticado)
-- 3. products policy — precedência de operadores ambígua (funciona mas
--    sem parênteses explícitos, risco de regressão em futuras alterações)
-- 4. sla_configs — PHARMACY_ADMIN sem política de leitura
--    (farmácias não conseguem ver seus próprios SLAs via client Supabase)
-- ============================================================

-- ── 1. order_operational_updates — Habilitar RLS ──────────────────────────
ALTER TABLE public.order_operational_updates ENABLE ROW LEVEL SECURITY;

-- Admins veem e gerenciam tudo
CREATE POLICY "Admins full access operational_updates"
  ON public.order_operational_updates FOR ALL
  USING (public.is_platform_admin());

-- Farmácia responsável pelo pedido pode inserir e ler suas próprias atualizações
CREATE POLICY "Pharmacy write own operational_updates"
  ON public.order_operational_updates FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.pharmacy_members pm
      WHERE pm.pharmacy_id = order_operational_updates.pharmacy_id
        AND pm.user_id = auth.uid()
    )
  );

CREATE POLICY "Pharmacy read own operational_updates"
  ON public.order_operational_updates FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.pharmacy_members pm
      WHERE pm.pharmacy_id = order_operational_updates.pharmacy_id
        AND pm.user_id = auth.uid()
    )
  );

-- Clínica do pedido pode ler as atualizações operacionais do seu pedido
CREATE POLICY "Clinic read own order operational_updates"
  ON public.order_operational_updates FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.clinic_members cm ON cm.clinic_id = o.clinic_id
      WHERE o.id = order_operational_updates.order_id
        AND cm.user_id = auth.uid()
    )
  );

-- Service role acesso total
CREATE POLICY "Service role full access operational_updates"
  ON public.order_operational_updates FOR ALL
  TO service_role USING (true);

-- ── 2. pharmacy_products — Habilitar RLS ──────────────────────────────────
ALTER TABLE public.pharmacy_products ENABLE ROW LEVEL SECURITY;

-- Admins gerenciam tudo
CREATE POLICY "Admins full access pharmacy_products"
  ON public.pharmacy_products FOR ALL
  USING (public.is_platform_admin());

-- Farmácia vê apenas seus próprios registros
CREATE POLICY "Pharmacy read own pharmacy_products"
  ON public.pharmacy_products FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.pharmacy_members pm
      WHERE pm.pharmacy_id = pharmacy_products.pharmacy_id
        AND pm.user_id = auth.uid()
    )
  );

-- Clínicas e médicos precisam ver se um produto está disponível na farmácia
-- (necessário para o fluxo de pedido)
CREATE POLICY "Authenticated read active pharmacy_products"
  ON public.pharmacy_products FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND active = true
  );

-- Service role acesso total
CREATE POLICY "Service role full access pharmacy_products"
  ON public.pharmacy_products FOR ALL
  TO service_role USING (true);

-- ── 3. products — Corrigir precedência de operadores ─────────────────────
-- Bug: USING (auth.uid() IS NOT NULL AND active = true OR is_platform_admin())
-- SQL evalua como: (uid IS NOT NULL AND active = true) OR is_platform_admin()
-- Isso funciona, mas é ambíguo. Reescrevemos com parênteses explícitos.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'products'
      AND policyname = 'products_select_authenticated'
  ) THEN
    DROP POLICY "products_select_authenticated" ON public.products;
  END IF;
END $$;

CREATE POLICY "products_select_authenticated" ON public.products
  FOR SELECT USING (
    public.is_platform_admin()
    OR (auth.uid() IS NOT NULL AND active = true)
  );

-- ── 4. sla_configs — Adicionar política de leitura para PHARMACY_ADMIN ───
-- Farmácias precisam ler seus próprios SLAs (e o global) para exibir prazos
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sla_configs'
      AND policyname = 'Pharmacy read own sla_configs'
  ) THEN
    CREATE POLICY "Pharmacy read own sla_configs"
      ON public.sla_configs FOR SELECT
      USING (
        -- SLA global (pharmacy_id IS NULL) — visível para todos autenticados
        (pharmacy_id IS NULL AND auth.uid() IS NOT NULL)
        OR
        -- SLA específico da farmácia — visível apenas para membros dela
        EXISTS (
          SELECT 1 FROM public.pharmacy_members pm
          WHERE pm.pharmacy_id = sla_configs.pharmacy_id
            AND pm.user_id = auth.uid()
        )
      );
  END IF;
END $$;
