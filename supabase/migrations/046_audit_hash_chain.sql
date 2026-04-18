-- Migration 046: audit_logs tamper-evident hash chain + append-only enforcement — Wave 3.
-- Purpose:
--   1. Make `public.audit_logs` cryptographically tamper-evident by
--      chaining every inserted row to the previous one via SHA-256:
--        row_hash = sha256( prev_hash || canonical_bytes(row) )
--      A single mutation to any historical row invalidates every hash
--      that comes after it.
--   2. Enforce append-only semantics at the table level. UPDATE is
--      unconditionally blocked. DELETE is blocked except through the
--      `audit_purge_retention` SECURITY DEFINER entry point which sets
--      a one-shot GUC inside its own transaction.
--   3. Provide `verify_audit_chain(p_start, p_end)` to rescan a time
--      window and return the count of inconsistencies + pointer to the
--      first broken row. Consumed by the nightly cron.
--   4. Backfill the existing 37 rows (prod) / N rows (staging) with a
--      deterministic chain before the trigger is installed so live
--      traffic starts with a valid head.
--
-- Consumers:
--   lib/audit/index.ts                 — plain INSERT, trigger fills hashes
--   lib/retention-policy.ts            — calls audit_purge_retention RPC
--   app/api/cron/verify-audit-chain/   — nightly chain verification
--
-- Access model:
--   - audit_logs: SELECT admin (unchanged); INSERT for all (unchanged);
--     UPDATE never; DELETE only via audit_purge_retention.
--   - audit_chain_checkpoints: SELECT admin; no direct write.
--   - verify_audit_chain: EXECUTE service_role only.
--   - audit_purge_retention: EXECUTE service_role only.
--
-- Rollback:
--   DROP FUNCTION public.audit_purge_retention(timestamptz, text[]);
--   DROP FUNCTION public.verify_audit_chain(timestamptz, timestamptz, int);
--   DROP FUNCTION public.audit_canonical_payload(public.audit_logs);
--   DROP FUNCTION public.audit_logs_chain_before_insert();
--   DROP FUNCTION public.audit_logs_prevent_mutation();
--   DROP TRIGGER  audit_logs_chain_trg          ON public.audit_logs;
--   DROP TRIGGER  audit_logs_prevent_update_trg ON public.audit_logs;
--   DROP TRIGGER  audit_logs_prevent_delete_trg ON public.audit_logs;
--   ALTER TABLE   public.audit_logs DROP COLUMN IF EXISTS seq, DROP COLUMN prev_hash, DROP COLUMN row_hash;
--   DROP SEQUENCE public.audit_logs_seq_seq;
--   DROP TABLE    public.audit_chain_checkpoints;
--
-- Idempotency: guarded with IF NOT EXISTS / OR REPLACE. Safe to re-run.

-- ─────────────────────────────────────────────────────────────────
-- 0. Dependencies
--
-- Supabase hosts pgcrypto in the `extensions` schema (not `public`).
-- We reference `extensions.digest(bytea, text)` explicitly throughout so
-- this migration works regardless of the caller's search_path.
-- ─────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;

-- ─────────────────────────────────────────────────────────────────
-- 1. Schema: add seq / prev_hash / row_hash columns
-- ─────────────────────────────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS public.audit_logs_seq_seq AS bigint START 1;

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS seq       bigint,
  ADD COLUMN IF NOT EXISTS prev_hash bytea,
  ADD COLUMN IF NOT EXISTS row_hash  bytea;

-- ─────────────────────────────────────────────────────────────────
-- 2. Checkpoint table (retention boundary audit trail)
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.audit_chain_checkpoints (
  id                bigserial   PRIMARY KEY,
  reason            text        NOT NULL CHECK (reason IN ('retention_purge','migration_backfill','manual')),
  cutoff_before     timestamptz,
  purged_count      bigint,
  last_hash_before  bytea,
  new_genesis_seq   bigint,
  new_genesis_hash  bytea,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.audit_chain_checkpoints IS
  'Append-only log of every chain-rotating event (retention purge, backfill).
   Not consumed by nightly verification (which scans a fresh window), but
   preserves a forensic trail so operators can explain historical chain
   gaps when running a manual full-chain audit.';

ALTER TABLE public.audit_chain_checkpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_chain_checkpoints_select_admin" ON public.audit_chain_checkpoints;
CREATE POLICY "audit_chain_checkpoints_select_admin" ON public.audit_chain_checkpoints
  FOR SELECT USING (public.is_platform_admin());

REVOKE ALL ON public.audit_chain_checkpoints FROM anon, authenticated;
GRANT SELECT ON public.audit_chain_checkpoints TO authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 3. Canonicalisation (used by trigger + verifier)
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.audit_canonical_payload(row_data public.audit_logs)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'id',              row_data.id,
    'seq',             row_data.seq,
    'actor_user_id',   row_data.actor_user_id,
    'actor_role',      row_data.actor_role,
    'entity_type',     row_data.entity_type,
    'entity_id',       row_data.entity_id,
    'action',          row_data.action,
    'old_values_json', row_data.old_values_json,
    'new_values_json', row_data.new_values_json,
    'metadata_json',   row_data.metadata_json,
    'ip',              row_data.ip,
    'user_agent',      row_data.user_agent,
    'created_at',      row_data.created_at
  )
$$;

COMMENT ON FUNCTION public.audit_canonical_payload(public.audit_logs) IS
  'Deterministic canonical bytes for hashing. jsonb_build_object output is
   key-sorted and type-stable; feeding it through ::text produces a stable
   serialisation across PostgreSQL versions.';

-- ─────────────────────────────────────────────────────────────────
-- 4. Backfill pre-existing rows (before installing the trigger)
-- ─────────────────────────────────────────────────────────────────

DO $backfill$
DECLARE
  r           public.audit_logs%ROWTYPE;
  prev        bytea := NULL;
  h           bytea;
  seq_val     bigint := 0;
  first_seq   bigint := NULL;
  first_hash  bytea  := NULL;
  last_hash   bytea  := NULL;
  did_work    boolean := false;
BEGIN
  -- Only run if any row still lacks a row_hash. Re-runs are no-ops.
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE row_hash IS NULL) THEN
    RAISE NOTICE 'audit_logs chain already backfilled; skipping';
    RETURN;
  END IF;

  FOR r IN
    SELECT * FROM public.audit_logs
    ORDER BY created_at ASC, id ASC
  LOOP
    seq_val := seq_val + 1;

    h := extensions.digest(
      coalesce(prev, '\x'::bytea) ||
      convert_to(
        jsonb_build_object(
          'id',              r.id,
          'seq',             seq_val,
          'actor_user_id',   r.actor_user_id,
          'actor_role',      r.actor_role,
          'entity_type',     r.entity_type,
          'entity_id',       r.entity_id,
          'action',          r.action,
          'old_values_json', r.old_values_json,
          'new_values_json', r.new_values_json,
          'metadata_json',   r.metadata_json,
          'ip',              r.ip,
          'user_agent',      r.user_agent,
          'created_at',      r.created_at
        )::text,
        'UTF8'
      ),
      'sha256'
    );

    -- Direct UPDATE: trigger is not installed yet at this point in the migration,
    -- so this bypasses the append-only guard legitimately.
    UPDATE public.audit_logs
       SET seq       = seq_val,
           prev_hash = prev,
           row_hash  = h
     WHERE id = r.id;

    IF first_seq IS NULL THEN first_seq := seq_val; first_hash := h; END IF;
    last_hash := h;
    prev      := h;
    did_work  := true;
  END LOOP;

  -- Advance the sequence so future INSERTs don't collide with backfilled seqs.
  PERFORM setval('public.audit_logs_seq_seq', greatest(seq_val, 1));

  IF did_work THEN
    INSERT INTO public.audit_chain_checkpoints
      (reason, cutoff_before, purged_count, last_hash_before, new_genesis_seq, new_genesis_hash, notes)
    VALUES
      ('migration_backfill', NULL, 0, last_hash, first_seq, first_hash,
       format('Wave 3 migration 046 backfilled %s rows', seq_val));
  END IF;
END
$backfill$;

-- ─────────────────────────────────────────────────────────────────
-- 5. Constraints and defaults (apply AFTER backfill so they succeed)
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE public.audit_logs
  ALTER COLUMN seq SET DEFAULT nextval('public.audit_logs_seq_seq');

-- seq / row_hash are NOT NULL from now on; prev_hash stays nullable (genesis row).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE seq IS NULL) THEN
    EXECUTE 'ALTER TABLE public.audit_logs ALTER COLUMN seq SET NOT NULL';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE row_hash IS NULL) THEN
    EXECUTE 'ALTER TABLE public.audit_logs ALTER COLUMN row_hash SET NOT NULL';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS audit_logs_seq_uidx ON public.audit_logs(seq);
CREATE INDEX        IF NOT EXISTS audit_logs_seq_created_idx
  ON public.audit_logs(seq, created_at);

-- ─────────────────────────────────────────────────────────────────
-- 6. Trigger: fill prev_hash + row_hash on INSERT
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.audit_logs_chain_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prev bytea;
  v_seq  bigint;
BEGIN
  -- Serialise concurrent inserts — prev_hash must be read under lock to
  -- avoid two sessions reading the same tail and producing divergent hashes.
  PERFORM pg_advisory_xact_lock(hashtext('clinipharma.audit_logs_chain')::bigint);

  -- Assign seq if the caller didn't (they shouldn't).
  IF NEW.seq IS NULL THEN
    NEW.seq := nextval('public.audit_logs_seq_seq');
  END IF;

  -- Refuse caller-supplied hashes; the chain must be computed server-side.
  NEW.prev_hash := NULL;
  NEW.row_hash  := NULL;

  SELECT row_hash INTO v_prev
    FROM public.audit_logs
   ORDER BY seq DESC
   LIMIT 1;

  NEW.prev_hash := v_prev;
  NEW.row_hash  := extensions.digest(
    coalesce(v_prev, '\x'::bytea) ||
    convert_to(audit_canonical_payload(NEW)::text, 'UTF8'),
    'sha256'
  );

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION public.audit_logs_chain_before_insert() IS
  'Before-insert trigger: serialises with pg_advisory_xact_lock, reads the
   current chain head, and fills prev_hash + row_hash. Caller-supplied
   values for those columns are ignored.';

DROP TRIGGER IF EXISTS audit_logs_chain_trg ON public.audit_logs;
CREATE TRIGGER audit_logs_chain_trg
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_logs_chain_before_insert();

-- ─────────────────────────────────────────────────────────────────
-- 7. Triggers: forbid UPDATE always; forbid DELETE unless GUC on
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.audit_logs_prevent_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_logs is append-only: UPDATE is forbidden';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF coalesce(current_setting('clinipharma.audit_allow_delete', true), 'off') <> 'on' THEN
      RAISE EXCEPTION
        'audit_logs DELETE requires the audit_purge_retention SECURITY DEFINER entry point';
    END IF;
    RETURN OLD;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS audit_logs_prevent_update_trg ON public.audit_logs;
CREATE TRIGGER audit_logs_prevent_update_trg
  BEFORE UPDATE ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_logs_prevent_mutation();

DROP TRIGGER IF EXISTS audit_logs_prevent_delete_trg ON public.audit_logs;
CREATE TRIGGER audit_logs_prevent_delete_trg
  BEFORE DELETE ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_logs_prevent_mutation();

-- ─────────────────────────────────────────────────────────────────
-- 8. verify_audit_chain(start, end, max_rows)
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.verify_audit_chain(
  p_start    timestamptz DEFAULT (now() - interval '48 hours'),
  p_end      timestamptz DEFAULT now(),
  p_max_rows integer     DEFAULT 1000000
) RETURNS TABLE (
  scanned_rows       bigint,
  inconsistent_count bigint,
  first_broken_seq   bigint,
  first_broken_id    uuid,
  verified_from      timestamptz,
  verified_to        timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r              public.audit_logs%ROWTYPE;
  expected_prev  bytea;
  computed_hash  bytea;
  v_scanned      bigint := 0;
  v_bad          bigint := 0;
  v_first_seq    bigint := NULL;
  v_first_id     uuid   := NULL;
  v_is_first     boolean := true;
BEGIN
  -- Anchor: row immediately preceding the window.
  SELECT row_hash INTO expected_prev
    FROM public.audit_logs
   WHERE created_at < p_start
   ORDER BY seq DESC
   LIMIT 1;

  FOR r IN
    SELECT * FROM public.audit_logs
     WHERE created_at >= p_start AND created_at <= p_end
     ORDER BY seq ASC
     LIMIT p_max_rows
  LOOP
    v_scanned := v_scanned + 1;

    computed_hash := extensions.digest(
      coalesce(r.prev_hash, '\x'::bytea) ||
      convert_to(audit_canonical_payload(r)::text, 'UTF8'),
      'sha256'
    );

    -- prev_hash continuity — unless this is the first row and a
    -- checkpoint marks it as a legitimate new genesis.
    IF r.prev_hash IS DISTINCT FROM expected_prev
       AND NOT (v_is_first AND EXISTS (
         SELECT 1 FROM public.audit_chain_checkpoints c
         WHERE c.new_genesis_seq = r.seq
       ))
    THEN
      v_bad := v_bad + 1;
      IF v_first_seq IS NULL THEN
        v_first_seq := r.seq;
        v_first_id  := r.id;
      END IF;
    ELSIF r.row_hash IS DISTINCT FROM computed_hash THEN
      v_bad := v_bad + 1;
      IF v_first_seq IS NULL THEN
        v_first_seq := r.seq;
        v_first_id  := r.id;
      END IF;
    END IF;

    expected_prev := r.row_hash;
    v_is_first := false;
  END LOOP;

  RETURN QUERY SELECT v_scanned, v_bad, v_first_seq, v_first_id, p_start, p_end;
END
$$;

COMMENT ON FUNCTION public.verify_audit_chain(timestamptz, timestamptz, integer) IS
  'Recomputes the hash chain for the given time window and compares each
   row''s stored row_hash with the recomputed value. Returns a one-row
   summary. Consumed by /api/cron/verify-audit-chain nightly.';

-- ─────────────────────────────────────────────────────────────────
-- 9. audit_purge_retention(cutoff, exclude_entity_types)
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.audit_purge_retention(
  p_cutoff               timestamptz,
  p_exclude_entity_types text[] DEFAULT ARRAY['PAYMENT','COMMISSION','TRANSFER','CONSULTANT_TRANSFER']
) RETURNS TABLE (
  purged_count  bigint,
  checkpoint_id bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count           bigint := 0;
  v_last_hash       bytea;
  v_new_seq         bigint;
  v_new_hash        bytea;
  v_checkpoint_id   bigint;
BEGIN
  -- One-shot permission for the DELETE trigger inside THIS transaction.
  PERFORM set_config('clinipharma.audit_allow_delete', 'on', true);

  -- Capture the last row_hash that will be deleted (for forensic trail).
  SELECT row_hash INTO v_last_hash
    FROM public.audit_logs
   WHERE created_at < p_cutoff
     AND entity_type <> ALL(p_exclude_entity_types)
   ORDER BY seq DESC
   LIMIT 1;

  WITH deleted AS (
    DELETE FROM public.audit_logs
     WHERE created_at < p_cutoff
       AND entity_type <> ALL(p_exclude_entity_types)
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM deleted;

  IF v_count > 0 THEN
    SELECT seq, row_hash
      INTO v_new_seq, v_new_hash
      FROM public.audit_logs
     ORDER BY seq ASC
     LIMIT 1;

    INSERT INTO public.audit_chain_checkpoints
      (reason, cutoff_before, purged_count, last_hash_before,
       new_genesis_seq, new_genesis_hash, notes)
    VALUES
      ('retention_purge', p_cutoff, v_count, v_last_hash,
       v_new_seq, v_new_hash,
       format('Purged %s rows, excluded types: %s', v_count, p_exclude_entity_types::text))
    RETURNING id INTO v_checkpoint_id;
  END IF;

  RETURN QUERY SELECT v_count, v_checkpoint_id;
END
$$;

COMMENT ON FUNCTION public.audit_purge_retention(timestamptz, text[]) IS
  'Retention-driven purge of audit_logs. Sets clinipharma.audit_allow_delete=on
   inside its own transaction so the append-only trigger permits the DELETE.
   Appends a checkpoint row so full-chain forensics can explain the gap later.';

-- ─────────────────────────────────────────────────────────────────
-- 10. Grants
-- ─────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.verify_audit_chain(timestamptz, timestamptz, integer) FROM public;
REVOKE ALL ON FUNCTION public.audit_purge_retention(timestamptz, text[])            FROM public;
GRANT  EXECUTE ON FUNCTION public.verify_audit_chain(timestamptz, timestamptz, integer) TO service_role;
GRANT  EXECUTE ON FUNCTION public.audit_purge_retention(timestamptz, text[])            TO service_role;

-- ─────────────────────────────────────────────────────────────────
-- 11. Post-migration smoke check
--
-- Verify the backfill produced a consistent chain over all existing rows.
-- If this RAISE EXCEPTION fires, the migration aborts — safer than leaving
-- a half-chained table behind.
-- ─────────────────────────────────────────────────────────────────

DO $smoke$
DECLARE
  v_bad bigint;
BEGIN
  SELECT inconsistent_count INTO v_bad
    FROM public.verify_audit_chain(
      '-infinity'::timestamptz,
      'infinity'::timestamptz,
      1000000
    );

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Migration 046 smoke check failed: verify_audit_chain reports % inconsistencies', v_bad;
  END IF;

  RAISE NOTICE 'Migration 046 smoke check passed — audit hash chain is consistent';
END
$smoke$;
