-- ============================================================
-- 009 — Notificações in-app
-- ============================================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        text NOT NULL,          -- ORDER_CREATED, PAYMENT_CONFIRMED, etc.
  title       text NOT NULL,
  body        text,
  link        text,                   -- relative URL to navigate to
  read_at     timestamptz,            -- null = unread
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user ON public.notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON public.notifications(user_id) WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Each user can only see their own notifications
CREATE POLICY "Users manage own notifications"
  ON public.notifications FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Service role can insert from server actions
CREATE POLICY "Service role full access notifications"
  ON public.notifications FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
