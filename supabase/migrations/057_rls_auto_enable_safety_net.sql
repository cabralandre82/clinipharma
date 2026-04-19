-- ============================================================================
-- 057_rls_auto_enable_safety_net.sql
-- ----------------------------------------------------------------------------
-- Codifies the runtime safety net that already lives in production but had
-- never been represented in this repo's migrations. Surfaced by
-- `Schema Drift Detection` (Layer 2) on 2026-04-19.
--
-- Two pieces:
--
--   1. `public.rls_auto_enable` event-trigger function + `ensure_rls`
--      event trigger. After every CREATE TABLE in `public`, RLS is
--      automatically enabled. A developer who forgets the explicit
--      `ENABLE ROW LEVEL SECURITY` is silently rescued instead of
--      shipping an unprotected table to prod.
--
--   2. The current side-effect of (1): `public.doctor_addresses` was
--      created in migration 041 without an explicit RLS toggle. The
--      auto-trigger enabled it in production. We codify the explicit
--      toggle here AND attach an owner-only policy so the table is
--      not RLS-with-no-policy (which denies everything).
--
-- The function body is written in the SAME line layout as the version
-- already running in production so that `pg_dump`-based schema-drift
-- detection produces zero noise once this migration deploys. Do NOT
-- reformat without re-checking schema-drift CI.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql
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
    IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
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

DROP EVENT TRIGGER IF EXISTS ensure_rls;
CREATE EVENT TRIGGER ensure_rls
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION public.rls_auto_enable();

ALTER TABLE IF EXISTS public.doctor_addresses ENABLE ROW LEVEL SECURITY;

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
      USING ( doctor_id IN ( SELECT doctors.id FROM public.doctors WHERE doctors.user_id = auth.uid() ) )
      WITH CHECK ( doctor_id IN ( SELECT doctors.id FROM public.doctors WHERE doctors.user_id = auth.uid() ) )
    $POLICY$;
  END IF;
END $$;
