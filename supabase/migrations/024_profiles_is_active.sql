-- Migration 024: add is_active to profiles
-- Allows the users list to show active/inactive state without hitting
-- the Supabase Auth Admin API for every row.
-- Kept in sync by deactivateUser / reactivateUser server actions.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Backfill: existing users are active
UPDATE profiles SET is_active = true WHERE is_active IS DISTINCT FROM true;

COMMENT ON COLUMN profiles.is_active IS
  'Mirrors the Supabase Auth ban status. false = user is banned (876600h). '
  'Updated by deactivateUser / reactivateUser server actions.';
