-- ============================================================================
-- 057_rls_auto_enable_safety_net.sql
-- ----------------------------------------------------------------------------
-- Codifies a runtime safety net that production has been carrying for some
-- time but was never represented in the migrations: an event trigger that
-- automatically enables Row-Level Security on every newly created table in
-- the `public` schema. Without this safety net, a developer who forgets to
-- add `ALTER TABLE … ENABLE ROW LEVEL SECURITY` after `CREATE TABLE` ships
-- an unprotected table to production.
--
-- This migration was authored after `Schema Drift Detection` (Layer 2) ran
-- against production for the first time on 2026-04-19 and surfaced two
-- delta items:
--
--   1. Production has the `rls_auto_enable` function and `ensure_rls`
--      event trigger but the repo migrations do not.
--   2. `public.doctor_addresses` (created in 041_solo_doctor_purchase.sql)
--      ends up with RLS enabled in production — clearly the work of (1).
--      The migration itself never enabled RLS explicitly, which is the
--      bug the safety net silently masked.
--
-- We do BOTH:
--   (a) Create the safety net in migrations so the dev/CI databases also
--       have it (and so a `restore-drill` from offsite is faithful).
--   (b) Add the explicit `ENABLE ROW LEVEL SECURITY` for doctor_addresses
--       so the intent is encoded — defence in depth.
--
-- Idempotent: every step uses IF NOT EXISTS / OR REPLACE / DROP IF EXISTS.
-- ============================================================================

-- (1) The function that the event trigger invokes after every DDL command.
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
    -- Only enforce on schemas we own. System schemas (pg_catalog,
    -- information_schema, pg_toast*, pg_temp*) and Supabase-managed
    -- schemas (auth, storage, realtime, vault, extensions, graphql,
    -- supabase_*) are explicitly skipped — Supabase has its own RLS
    -- policies for those.
    IF cmd.schema_name IS NOT NULL
       AND cmd.schema_name IN ('public')
       AND cmd.schema_name NOT IN ('pg_catalog','information_schema')
       AND cmd.schema_name NOT LIKE 'pg_toast%'
       AND cmd.schema_name NOT LIKE 'pg_temp%'
    THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
    ELSE
      RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.rls_auto_enable() IS
  'Wave 16 — defence-in-depth: auto-enables RLS on every CREATE TABLE in public schema. Codified from production state surfaced by schema-drift Layer 2 on 2026-04-19. Without this trigger, a forgotten `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` ships an unprotected table.';

-- (2) The event trigger itself. Drop-then-create is the only portable
--     way to mutate event triggers — there is no `CREATE OR REPLACE
--     EVENT TRIGGER` in PostgreSQL.
DROP EVENT TRIGGER IF EXISTS ensure_rls;
CREATE EVENT TRIGGER ensure_rls
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION public.rls_auto_enable();

COMMENT ON EVENT TRIGGER ensure_rls IS
  'Fires after every CREATE TABLE / CREATE TABLE AS / SELECT INTO and delegates to public.rls_auto_enable(). See migration 057 for rationale.';

-- (3) Make the existing-table fix explicit (idempotent — repeated calls
--     are no-ops once RLS is on).
ALTER TABLE IF EXISTS public.doctor_addresses ENABLE ROW LEVEL SECURITY;

-- (4) RLS without a policy denies everything by default. We expose
--     doctor_addresses through service-role queries today; codify the
--     intent here so a future developer cannot accidentally grant
--     anonymous access without thinking about it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE  schemaname = 'public'
      AND  tablename  = 'doctor_addresses'
      AND  policyname = 'doctor_addresses_owner_all'
  ) THEN
    EXECUTE $POLICY$
      CREATE POLICY doctor_addresses_owner_all
      ON public.doctor_addresses
      FOR ALL
      USING ( doctor_id IN (
                SELECT id FROM public.doctors
                WHERE  user_id = auth.uid()
              ) )
      WITH CHECK ( doctor_id IN (
                SELECT id FROM public.doctors
                WHERE  user_id = auth.uid()
              ) )
    $POLICY$;
  END IF;
END $$;

COMMENT ON POLICY doctor_addresses_owner_all ON public.doctor_addresses IS
  'A doctor can read/write only their own delivery addresses. Service-role bypasses RLS and remains unaffected.';
