-- ============================================================
-- Migration 029 — AI Features
-- ============================================================
-- 1. Support tickets: ai_classified flag
-- 2. Support messages: sentiment column
-- 3. Product associations table (market basket for recommendations)
-- ============================================================

-- ── 1. Support tickets: track AI classification ──────────────────────────────

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS ai_classified boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.support_tickets.ai_classified IS
  'True when category and priority were set by AI classification (v6.0.0+)';

-- ── 2. Support messages: sentiment analysis ───────────────────────────────────

ALTER TABLE public.support_messages
  ADD COLUMN IF NOT EXISTS sentiment text
  CHECK (sentiment IN ('positive', 'neutral', 'negative', 'very_negative'));

COMMENT ON COLUMN public.support_messages.sentiment IS
  'Sentiment detected by AI for client messages. NULL = not yet analyzed or admin message.';

-- ── 3. Product associations (market basket analysis) ─────────────────────────

CREATE TABLE IF NOT EXISTS public.product_associations (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_a_id  uuid        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  product_b_id  uuid        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  -- Support: number of orders where both products appeared together
  support       integer     NOT NULL DEFAULT 0 CHECK (support >= 0),
  -- Confidence: P(B | A) = support / orders_with_A
  confidence    numeric(5,4) NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  computed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_a_id, product_b_id),
  -- Prevent self-association
  CHECK (product_a_id <> product_b_id)
);

CREATE INDEX IF NOT EXISTS idx_product_associations_a
  ON public.product_associations(product_a_id)
  WHERE confidence > 0.1;

CREATE INDEX IF NOT EXISTS idx_product_associations_conf
  ON public.product_associations(product_a_id, confidence DESC);

ALTER TABLE public.product_associations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read associations"
  ON public.product_associations FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role full access associations"
  ON public.product_associations FOR ALL
  TO service_role
  USING (true);
