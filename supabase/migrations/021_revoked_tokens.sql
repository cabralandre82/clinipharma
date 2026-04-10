-- ── Migration 021: Revoked tokens blacklist ──────────────────────────────────
-- Enables active session revocation for deactivated/role-changed users.
-- JWT tokens are stateless; this table acts as a server-side blacklist.
-- Applied: 2026-04-08

CREATE TABLE IF NOT EXISTS public.revoked_tokens (
  jti         text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  revoked_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

-- Index for fast lookup on every authenticated request
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_jti ON public.revoked_tokens(jti);

-- Index for purge cron (delete where expires_at < now())
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires_at ON public.revoked_tokens(expires_at);

-- RLS: only service_role can read/write (checked by middleware via admin client)
ALTER TABLE public.revoked_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access revoked_tokens"
  ON public.revoked_tokens FOR ALL
  USING (true)
  WITH CHECK (true);
