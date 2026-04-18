-- Migration 048: observability & alerts feature-flag seeds (Wave 6).
--
-- Purpose:
--   1. Seed two new feature flags (`alerts.pagerduty_enabled`, `alerts.email_enabled`)
--      consumed by `lib/alerts.ts` so operators can toggle alert channels without
--      a deploy.
--   2. Both default to `false` so no unsolicited emails or PagerDuty incidents are
--      raised until an operator explicitly turns them on.
--
-- Rollback:
--   DELETE FROM public.feature_flags
--    WHERE key IN ('alerts.pagerduty_enabled', 'alerts.email_enabled');
--
-- Idempotency: guarded by `ON CONFLICT (key) DO NOTHING`.

INSERT INTO public.feature_flags (key, description, enabled, owner)
VALUES
  (
    'alerts.pagerduty_enabled',
    'Route critical alerts (P1) to PagerDuty via Events API v2 in lib/alerts.ts (Wave 6).',
    false,
    'audit-2026-04'
  ),
  (
    'alerts.email_enabled',
    'Route P2/P3 alerts to OPS_ALERT_EMAIL via Resend in lib/alerts.ts (Wave 6).',
    false,
    'audit-2026-04'
  )
ON CONFLICT (key) DO NOTHING;

DO $smoke$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.feature_flags
   WHERE key IN ('alerts.pagerduty_enabled', 'alerts.email_enabled');
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Migration 048 smoke: expected 2 alert flags, found %', v_count;
  END IF;
  RAISE NOTICE 'Migration 048 smoke passed: % alert flags seeded', v_count;
END
$smoke$;
