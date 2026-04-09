-- ============================================================
-- Migration 010: product status (active/unavailable/inactive)
--                + product_interests table
-- ============================================================

-- 1. Adiciona coluna status nos produtos
--    'active'      → disponível no catálogo (comportamento atual de active=true)
--    'unavailable' → aparece no catálogo mas bloqueado para pedido (botão "Tenho interesse")
--    'inactive'    → não aparece no catálogo (comportamento atual de active=false)

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'unavailable', 'inactive'));

-- Migra dados existentes: active=true → 'active', active=false → 'inactive'
UPDATE public.products SET status = 'active'   WHERE active = true;
UPDATE public.products SET status = 'inactive' WHERE active = false;

-- 2. Tabela de interesses em produtos indisponíveis
CREATE TABLE IF NOT EXISTS public.product_interests (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  whatsapp    text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_interests_product ON public.product_interests(product_id);
CREATE INDEX IF NOT EXISTS idx_product_interests_user    ON public.product_interests(user_id);

-- 3. RLS para product_interests
ALTER TABLE public.product_interests ENABLE ROW LEVEL SECURITY;

-- Usuário autenticado pode inserir seu próprio interesse
CREATE POLICY "Users insert own interest"
  ON public.product_interests FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Usuário vê apenas seus próprios interesses
CREATE POLICY "Users view own interests"
  ON public.product_interests FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Admins veem todos os interesses
CREATE POLICY "Admins view all interests"
  ON public.product_interests FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('SUPER_ADMIN', 'PLATFORM_ADMIN')
    )
  );

-- Service role acesso total
CREATE POLICY "Service role full access interests"
  ON public.product_interests FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
