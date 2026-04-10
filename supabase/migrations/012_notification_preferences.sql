-- Migration 012: Notification preferences per user
-- Adds a jsonb column to profiles with silenceable notification types.
-- Critical types are always sent regardless of preferences.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notification_preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.profiles.notification_preferences IS
  'Map of silenceable notification types to boolean. Missing key means enabled. E.g. {"PRODUCT_INTEREST": false}';
