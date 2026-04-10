-- ============================================================
-- 016 — Second-round audit fixes
-- ============================================================

-- ── 1. product_price_history: upgrade precision to numeric(15,2) ─────────
ALTER TABLE public.product_price_history
  ALTER COLUMN old_price TYPE numeric(15,2),
  ALTER COLUMN new_price TYPE numeric(15,2);

-- ── 2. product_pharmacy_cost_history: upgrade precision ──────────────────
ALTER TABLE public.product_pharmacy_cost_history
  ALTER COLUMN old_cost TYPE numeric(15,2),
  ALTER COLUMN new_cost TYPE numeric(15,2);

-- ── 3. Add index on clinic_members.user_id (missing, high-frequency lookup) ─
CREATE INDEX IF NOT EXISTS idx_clinic_members_user_id
  ON public.clinic_members(user_id);

-- ── 4. Add index on pharmacy_members.user_id ─────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pharmacy_members_user_id
  ON public.pharmacy_members(user_id);

-- ── 5. Ensure doctor_clinic_links has index on clinic_id ─────────────────
CREATE INDEX IF NOT EXISTS idx_doctor_clinic_links_clinic_id
  ON public.doctor_clinic_links(clinic_id);

-- ── 6. Add index on consultant_commissions.consultant_id + status ─────────
CREATE INDEX IF NOT EXISTS idx_consultant_commissions_consultant_status
  ON public.consultant_commissions(consultant_id, status);

-- ── 7. Add index on fcm_tokens.user_id ───────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_fcm_tokens_user_id
  ON public.fcm_tokens(user_id);

-- ── 8. Add index on access_logs.user_id + created_at ────────────────────
CREATE INDEX IF NOT EXISTS idx_access_logs_user_created
  ON public.access_logs(user_id, created_at DESC);

-- ── 9. Add index on notifications.user_id (unread filter) ───────────────
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id, created_at DESC)
  WHERE read_at IS NULL;

-- ── 10. Add index on contracts.entity_id ────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_contracts_entity_id
  ON public.contracts(entity_id);

-- ── 11. SLA configs: add index on order_status ──────────────────────────
CREATE INDEX IF NOT EXISTS idx_sla_configs_status
  ON public.sla_configs(order_status);

-- ── 12. order_tracking_tokens: ensure token is indexed ──────────────────
CREATE INDEX IF NOT EXISTS idx_order_tracking_tokens_token
  ON public.order_tracking_tokens(token);

-- ── 13. RLS: allow clinic members to read their own order_tracking_tokens ─
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'order_tracking_tokens'
      AND policyname = 'clinic_read_own_tracking_token'
  ) THEN
    CREATE POLICY "clinic_read_own_tracking_token"
      ON public.order_tracking_tokens
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.orders o
          JOIN public.clinic_members cm ON cm.clinic_id = o.clinic_id
          WHERE o.id = order_tracking_tokens.order_id
            AND cm.user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- ── 14. RLS: allow doctors to read tracking tokens for their orders ────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'order_tracking_tokens'
      AND policyname = 'doctor_read_own_tracking_token'
  ) THEN
    CREATE POLICY "doctor_read_own_tracking_token"
      ON public.order_tracking_tokens
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.orders o
          WHERE o.id = order_tracking_tokens.order_id
            AND o.doctor_id IN (
              SELECT id FROM public.doctors WHERE email = (
                SELECT email FROM public.profiles WHERE id = auth.uid()
              )
            )
        )
      );
  END IF;
END $$;
