-- Migration 052: rate-limit violation ledger + Turnstile bypass flag (Wave 10).
--
-- Purpose
-- -------
-- The platform already has `lib/rate-limit.ts` which, when a
-- bucket exceeds its budget, returns HTTP 429. What's missing is
-- persistent, queryable visibility into WHO is getting blocked so
-- we can tell "legit users hitting a genuine ceiling" from "a
-- single IP abusing the LGPD-erasure form to grief the queue".
--
-- This migration introduces:
--
--   1. public.rate_limit_violations — one row per bucket/IP-hash/
--      minute, with `hits` incremented via ON CONFLICT so a busy
--      attacker doesn't explode the table. IP is stored as a
--      SHA-256 hex of the raw value (salted with a server-side
--      secret) so the table is LGPD-safe at rest.
--
--   2. public.rate_limit_report_view — aggregates the last 60
--      minutes of violations per IP-hash, used by the Wave-10
--      cron to decide whether to page on-call.
--
--   3. public.rate_limit_record(...) SECURITY DEFINER RPC used by
--      the application to persist a violation atomically. Direct
--      INSERT is NOT blocked (service_role uses the table
--      directly) but RLS forbids selection by anonymous users.
--
--   4. Feature flag `security.turnstile_enforce` (default OFF)
--      gating Cloudflare Turnstile verification on public forms.
--      While OFF, the server still verifies tokens when present
--      but does not 403 on missing tokens.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.rate_limit_record(text, text, text, int);
--   DROP VIEW IF EXISTS public.rate_limit_report_view;
--   DROP TABLE IF EXISTS public.rate_limit_violations;
--   DELETE FROM public.feature_flags WHERE key = 'security.turnstile_enforce';

SET search_path TO public, extensions, pg_temp;

-- ── 1. rate_limit_violations ─────────────────────────────────────────────
--
-- Granularity: (bucket, ip_hash, bucket_minute). A minute bucket is
-- cheap to aggregate and gives us 60 rows per IP per hour, which
-- is rollable to a top-N report in O(1) with the index below.

CREATE TABLE IF NOT EXISTS public.rate_limit_violations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket         text NOT NULL,      -- e.g. "auth.forgot", "lgpd.deletion", "register.submit"
  ip_hash        text NOT NULL,      -- SHA-256(ip || secret), lowercase hex (64 chars)
  user_id        uuid REFERENCES public.profiles(id),
  bucket_minute  timestamptz NOT NULL,  -- truncated to the minute
  hits           int NOT NULL DEFAULT 1 CHECK (hits >= 1),
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  -- Metadata (stored as jsonb so we don't bloat the row for short
  -- incidents and can dump full request fingerprints for forensics).
  metadata_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT rate_limit_violations_minute_agg UNIQUE (bucket, ip_hash, bucket_minute)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_violations_recent
  ON public.rate_limit_violations (bucket, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_rate_limit_violations_ip_hash_recent
  ON public.rate_limit_violations (ip_hash, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_rate_limit_violations_user
  ON public.rate_limit_violations (user_id, last_seen_at DESC)
  WHERE user_id IS NOT NULL;

COMMENT ON TABLE public.rate_limit_violations IS
  'Wave 10 — ledger of HTTP 429 events. IPs are SHA-256 hashed with a server-side secret so the table is safe to retain past the LGPD soft-delete window.';

COMMENT ON COLUMN public.rate_limit_violations.ip_hash IS
  'hex-encoded SHA-256(ip || RATE_LIMIT_IP_SALT). Never the raw IP.';

-- ── 2. rate_limit_record() RPC ───────────────────────────────────────────
--
-- Idempotent upsert: one minute bucket per (bucket, ip_hash). Any
-- additional hit within the same minute just increments `hits`.
-- Called from `lib/rate-limit.ts` on every deny.

CREATE OR REPLACE FUNCTION public.rate_limit_record(
  p_bucket   text,
  p_ip_hash  text,
  p_user_id  uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_id         uuid;
  v_minute     timestamptz := date_trunc('minute', now());
BEGIN
  IF p_bucket IS NULL OR length(p_bucket) = 0 THEN
    RAISE EXCEPTION 'rate_limit_record: bucket required' USING ERRCODE = 'P0001';
  END IF;
  IF p_ip_hash IS NULL OR length(p_ip_hash) <> 64 THEN
    RAISE EXCEPTION 'rate_limit_record: ip_hash must be 64-char hex SHA-256' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.rate_limit_violations AS r
    (bucket, ip_hash, user_id, bucket_minute, metadata_json)
    VALUES (p_bucket, p_ip_hash, p_user_id, v_minute, COALESCE(p_metadata, '{}'::jsonb))
  ON CONFLICT (bucket, ip_hash, bucket_minute) DO UPDATE
     SET hits         = r.hits + 1,
         last_seen_at = now(),
         user_id      = COALESCE(r.user_id, EXCLUDED.user_id),
         metadata_json = r.metadata_json || EXCLUDED.metadata_json
    RETURNING id INTO v_id;

  RETURN v_id;
END
$$;

COMMENT ON FUNCTION public.rate_limit_record(text, text, uuid, jsonb) IS
  'Wave 10 — atomic upsert of a rate-limit violation row. One row per (bucket, ip_hash, minute); additional hits just bump `hits`.';

GRANT EXECUTE ON FUNCTION public.rate_limit_record(text, text, uuid, jsonb) TO service_role;

-- ── 3. rate_limit_report_view ────────────────────────────────────────────
--
-- Aggregates the last 60 minutes of violations. Used by the
-- /api/cron/rate-limit-report cron to classify incidents.

CREATE OR REPLACE VIEW public.rate_limit_report_view AS
SELECT
  r.ip_hash,
  count(DISTINCT r.bucket)                     AS distinct_buckets,
  sum(r.hits)::bigint                          AS total_hits,
  max(r.last_seen_at)                          AS last_seen_at,
  min(r.first_seen_at)                         AS first_seen_at,
  array_agg(DISTINCT r.bucket ORDER BY r.bucket) AS buckets,
  -- Pick an arbitrary user_id observed for this ip_hash (NULL if
  -- only anonymous hits were ever recorded). `max(uuid)` doesn't
  -- exist in PG, so cast to text, take max, then read the row.
  (SELECT user_id
     FROM public.rate_limit_violations r2
    WHERE r2.ip_hash = r.ip_hash
      AND r2.user_id IS NOT NULL
    ORDER BY last_seen_at DESC
    LIMIT 1)                                   AS sample_user_id
FROM public.rate_limit_violations r
WHERE r.last_seen_at > now() - interval '1 hour'
GROUP BY r.ip_hash;

COMMENT ON VIEW public.rate_limit_report_view IS
  'Wave 10 — per-IP-hash rollup of the last hour of HTTP 429 events, ordered by severity downstream.';

GRANT SELECT ON public.rate_limit_report_view TO service_role;

-- ── 4. Retention: purge rows > 30 days ───────────────────────────────────
--
-- Violations are operational data, not user-owned. 30-day window
-- is long enough for trend analysis but short enough that the
-- table stays small. The cron `/api/cron/rate-limit-report`
-- calls rate_limit_purge_old() on every run.

CREATE OR REPLACE FUNCTION public.rate_limit_purge_old(
  p_retention_days int DEFAULT 30
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_deleted int;
BEGIN
  IF p_retention_days < 1 THEN
    RAISE EXCEPTION 'rate_limit_purge_old: retention must be >= 1 day' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.rate_limit_violations
   WHERE last_seen_at < now() - make_interval(days => p_retention_days);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END
$$;

COMMENT ON FUNCTION public.rate_limit_purge_old(int) IS
  'Wave 10 — deletes rate_limit_violations older than p_retention_days. Called by the rate-limit-report cron.';

GRANT EXECUTE ON FUNCTION public.rate_limit_purge_old(int) TO service_role;

-- ── 5. Feature flag ──────────────────────────────────────────────────────

INSERT INTO public.feature_flags (key, description, enabled, owner)
VALUES (
  'security.turnstile_enforce',
  'When ON, public form endpoints (forgot-password, lgpd/deletion-request, registration) require a valid Cloudflare Turnstile token. Default OFF so rollout can audit false positives first.',
  false,
  'audit-2026-04'
)
ON CONFLICT (key) DO NOTHING;

-- ── 6. RLS ──────────────────────────────────────────────────────────────

ALTER TABLE public.rate_limit_violations ENABLE ROW LEVEL SECURITY;

-- Deny-by-default. Only service_role reads/writes directly via
-- rate_limit_record / rate_limit_report_view. No public policy
-- needed because the default is DENY under RLS.

-- ── 7. Smoke ─────────────────────────────────────────────────────────────

DO $smoke$
DECLARE
  v_count       int;
  v_flag_off    boolean;
  v_first_id    uuid;
  v_second_id   uuid;
  v_hits        int;
  v_bad_caught  boolean;
BEGIN
  -- Structural checks
  SELECT count(*) INTO v_count FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'rate_limit_violations';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'smoke: rate_limit_violations table missing';
  END IF;

  SELECT count(*) INTO v_count FROM information_schema.views
   WHERE table_schema = 'public' AND table_name = 'rate_limit_report_view';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'smoke: rate_limit_report_view missing';
  END IF;

  SELECT count(*) INTO v_count FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN ('rate_limit_record', 'rate_limit_purge_old');
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'smoke: expected 2 functions, got %', v_count;
  END IF;

  SELECT enabled INTO v_flag_off
    FROM public.feature_flags WHERE key = 'security.turnstile_enforce';
  IF v_flag_off IS NULL THEN
    RAISE EXCEPTION 'smoke: security.turnstile_enforce flag missing';
  END IF;
  IF v_flag_off THEN
    RAISE EXCEPTION 'smoke: security.turnstile_enforce must default OFF';
  END IF;

  -- Functional: two inserts in the same minute must collapse to 1
  -- row with hits=2.
  v_first_id := public.rate_limit_record(
    'smoke.w10',
    repeat('a', 64),
    NULL,
    '{"smoke":true}'::jsonb
  );
  v_second_id := public.rate_limit_record(
    'smoke.w10',
    repeat('a', 64),
    NULL,
    '{}'::jsonb
  );
  IF v_first_id <> v_second_id THEN
    RAISE EXCEPTION 'smoke: expected same id, got % vs %', v_first_id, v_second_id;
  END IF;

  SELECT hits INTO v_hits FROM public.rate_limit_violations WHERE id = v_first_id;
  IF v_hits <> 2 THEN
    RAISE EXCEPTION 'smoke: expected hits=2, got %', v_hits;
  END IF;

  -- Reject bad ip_hash (must be 64 chars).
  v_bad_caught := false;
  BEGIN
    PERFORM public.rate_limit_record('smoke.w10', 'too-short', NULL, '{}'::jsonb);
  EXCEPTION WHEN sqlstate 'P0001' THEN v_bad_caught := true;
  END;
  IF NOT v_bad_caught THEN
    RAISE EXCEPTION 'smoke: short ip_hash did not raise';
  END IF;

  -- Reject empty bucket.
  v_bad_caught := false;
  BEGIN
    PERFORM public.rate_limit_record('', repeat('a', 64), NULL, '{}'::jsonb);
  EXCEPTION WHEN sqlstate 'P0001' THEN v_bad_caught := true;
  END;
  IF NOT v_bad_caught THEN
    RAISE EXCEPTION 'smoke: empty bucket did not raise';
  END IF;

  -- Clean up smoke row. Service role has full access.
  DELETE FROM public.rate_limit_violations WHERE bucket = 'smoke.w10';

  RAISE NOTICE 'Migration 052 smoke passed (table=1, view=1, functions=2, flag OFF, upsert works, validation works)';
END
$smoke$;
