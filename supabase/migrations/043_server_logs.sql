-- Migration 043: server_logs — persistent error/warn log storage
-- Stores error and warn level logs from lib/logger.ts.
-- Replaces the need for an external log drain for critical issues.
-- Retention: auto-purge logs older than 90 days via cron.

CREATE TABLE IF NOT EXISTS public.server_logs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  level       text        NOT NULL CHECK (level IN ('error', 'warn')),
  message     text        NOT NULL,
  context     jsonb,
  route       text,          -- Next.js route path (/api/orders, etc.)
  request_id  text,          -- x-request-id header
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Index for admin queries (most recent first, filter by level)
CREATE INDEX IF NOT EXISTS idx_server_logs_created_at ON public.server_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_server_logs_level       ON public.server_logs (level, created_at DESC);

-- RLS: only service role can insert; SUPER_ADMIN can read
ALTER TABLE public.server_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_insert_server_logs"
  ON public.server_logs FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "super_admin_read_server_logs"
  ON public.server_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('SUPER_ADMIN', 'PLATFORM_ADMIN')
    )
  );

COMMENT ON TABLE public.server_logs IS
  'Server-side error/warn logs persisted from lib/logger.ts. Auto-purged after 90 days.';
