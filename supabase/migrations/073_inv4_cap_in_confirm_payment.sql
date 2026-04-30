-- Migration 073 — INV-4 cap defensivo em confirm_payment_atomic.
--
-- Visão
-- -----
-- INV-4: `consultant_commission <= platform_commission` por unidade
-- E por order. Esta invariante já é cumprida em compute_unit_price
-- (mig-071) para itens TIERED_PROFILE. Para itens FIXED legados, a
-- comissão de consultor era calculada como rate × total_price sem
-- cap — em teoria possível ficar > platform_commission se a clínica
-- tiver cupom muito agressivo (legacy FIXED não enforçava floor).
--
-- Esta migration adiciona o cap em runtime no nível de order:
--
--   v_consultant_commission := LEAST(
--     round(total_price × rate / 100, 2),
--     v_platform_commission
--   )
--
-- Quando o cap dispara, emite RAISE NOTICE com order_id e diferença
-- (visível em logs do Supabase + Sentry breadcrumb se anexado). NOTICE
-- não bloqueia o INSERT.
--
-- Por que defensivo: é um net-de-segurança, não a primeira linha. Os
-- caminhos de pricing são quem PRIMEIRO impede o cenário; este cap é
-- "última defesa" para casos legados / reprocessamento / item criado
-- antes da migration entrar.
--
-- Mudança cirúrgica
-- -----------------
-- A função inteira é re-criada para manter idempotência, mas o único
-- byte semanticamente novo é o LEAST + RAISE NOTICE. O resto é
-- literalmente a versão da migration 069.
--
-- Rollback
-- --------
-- Re-aplicar o corpo da migration 069 via CREATE OR REPLACE.

SET search_path TO public, pg_temp;

CREATE OR REPLACE FUNCTION public.confirm_payment_atomic(
  p_payment_id uuid,
  p_args jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment              public.payments%ROWTYPE;
  v_order                public.orders%ROWTYPE;
  v_expected_lock        int;
  v_pharmacy_transfer    numeric(10,2);
  v_platform_commission  numeric(10,2);
  v_consultant_id        uuid;
  v_consultant_rate      numeric;
  v_consultant_raw       numeric(10,2);
  v_consultant_commission numeric(10,2);
BEGIN
  IF p_payment_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payment' USING ERRCODE = 'P0001';
  END IF;
  IF p_args IS NULL OR (p_args ? 'confirmed_by_user_id') = false THEN
    RAISE EXCEPTION 'invalid_args' USING ERRCODE = 'P0001';
  END IF;

  v_expected_lock := COALESCE((p_args ->> 'expected_lock_version')::int, 0);

  UPDATE public.payments
     SET status              = 'CONFIRMED',
         payment_method      = COALESCE(p_args ->> 'payment_method', payment_method),
         reference_code      = NULLIF(p_args ->> 'reference_code', ''),
         notes               = NULLIF(p_args ->> 'notes', ''),
         confirmed_by_user_id= (p_args ->> 'confirmed_by_user_id')::uuid,
         confirmed_at        = now(),
         updated_at          = now(),
         lock_version        = lock_version + 1
   WHERE id = p_payment_id
     AND status = 'PENDING'
     AND (v_expected_lock = 0 OR lock_version = v_expected_lock)
  RETURNING * INTO v_payment;

  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.payments WHERE id = p_payment_id AND status <> 'PENDING') THEN
      RAISE EXCEPTION 'already_processed' USING ERRCODE = 'P0001';
    END IF;
    IF v_expected_lock > 0 AND EXISTS (SELECT 1 FROM public.payments WHERE id = p_payment_id) THEN
      RAISE EXCEPTION 'stale_version' USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_payment.order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT round(coalesce(sum(pharmacy_cost_per_unit * quantity), 0)::numeric, 2)
    INTO v_pharmacy_transfer
    FROM public.order_items
   WHERE order_id = v_payment.order_id;

  v_platform_commission := GREATEST(0, round((v_order.total_price - v_pharmacy_transfer)::numeric, 2));

  INSERT INTO public.commissions (
    order_id, commission_type, commission_fixed_amount,
    commission_total_amount, calculated_by_user_id
  ) VALUES (
    v_payment.order_id, 'FIXED', v_platform_commission,
    v_platform_commission, (p_args ->> 'confirmed_by_user_id')::uuid
  );

  INSERT INTO public.transfers (
    order_id, pharmacy_id, gross_amount, commission_amount, net_amount, status
  ) VALUES (
    v_payment.order_id, v_order.pharmacy_id,
    v_order.total_price, v_platform_commission, v_pharmacy_transfer,
    'PENDING'
  );

  -- ── Consultant resolution — buyer-aware (mig-069 unchanged) ─────────
  IF v_order.clinic_id IS NOT NULL THEN
    SELECT consultant_id INTO v_consultant_id
      FROM public.clinics WHERE id = v_order.clinic_id;
  ELSIF v_order.doctor_id IS NOT NULL THEN
    SELECT consultant_id INTO v_consultant_id
      FROM public.doctors WHERE id = v_order.doctor_id;
  END IF;

  IF v_consultant_id IS NOT NULL THEN
    SELECT COALESCE((value_json::text)::numeric, 5)
      INTO v_consultant_rate
      FROM public.app_settings
     WHERE key = 'consultant_commission_rate'
     LIMIT 1;
    v_consultant_rate := COALESCE(v_consultant_rate, 5);
    v_consultant_raw  := round(v_order.total_price * v_consultant_rate / 100, 2);

    -- ── INV-4 cap defensivo (mig-073) ─────────────────────────────────
    -- "Consultor nunca recebe mais que a plataforma." Este é o último
    -- nó na rede onde podemos enforçar isso; pricing engine (071) já
    -- enforça por unidade, mas pedidos antigos / pricing FIXED podem
    -- passar pelo cap aqui.
    v_consultant_commission := LEAST(v_consultant_raw, v_platform_commission);
    IF v_consultant_commission < v_consultant_raw THEN
      RAISE NOTICE 'INV-4 cap fired in confirm_payment_atomic (order_id=%, raw=%, capped=%, platform=%)',
        v_payment.order_id, v_consultant_raw, v_consultant_commission, v_platform_commission;
    END IF;

    INSERT INTO public.consultant_commissions (
      order_id, consultant_id, order_total,
      commission_rate, commission_amount, status
    ) VALUES (
      v_payment.order_id, v_consultant_id, v_order.total_price,
      v_consultant_rate, v_consultant_commission, 'PENDING'
    );
  END IF;

  UPDATE public.orders
     SET payment_status  = 'CONFIRMED',
         order_status    = 'COMMISSION_CALCULATED',
         transfer_status = 'PENDING',
         updated_at      = now(),
         lock_version    = lock_version + 1
   WHERE id = v_payment.order_id;

  INSERT INTO public.order_status_history (
    order_id, old_status, new_status, changed_by_user_id, reason
  ) VALUES (
    v_payment.order_id,
    v_order.order_status,
    'COMMISSION_CALCULATED',
    (p_args ->> 'confirmed_by_user_id')::uuid,
    COALESCE(
      'Pagamento confirmado (' || COALESCE(p_args ->> 'payment_method', 'MANUAL') ||
      CASE WHEN NULLIF(p_args ->> 'reference_code', '') IS NOT NULL
           THEN ' · ref: ' || (p_args ->> 'reference_code')
           ELSE '' END
      || ')',
      'Pagamento confirmado'
    )
  );

  RETURN jsonb_build_object(
    'payment_id', v_payment.id,
    'order_id', v_payment.order_id,
    'pharmacy_transfer', v_pharmacy_transfer,
    'platform_commission', v_platform_commission,
    'consultant_commission', v_consultant_commission,
    'consultant_capped', (v_consultant_raw IS NOT NULL AND v_consultant_commission < v_consultant_raw),
    'new_lock_version', v_payment.lock_version
  );
END;
$$;

-- ── Smoke ──────────────────────────────────────────────────────────────
DO $smoke$
DECLARE
  v_body text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'confirm_payment_atomic';
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'mig073 smoke: confirm_payment_atomic missing';
  END IF;
  IF v_body NOT LIKE '%LEAST(v_consultant_raw, v_platform_commission)%' THEN
    RAISE EXCEPTION 'mig073 smoke: INV-4 LEAST cap missing in confirm_payment_atomic';
  END IF;
  IF v_body NOT LIKE '%ELSIF v_order.doctor_id%' THEN
    RAISE EXCEPTION 'mig073 smoke: doctor branch (mig-069) regressed — must remain';
  END IF;
  RAISE NOTICE 'Migration 073 smoke passed (INV-4 cap installed, doctor branch preserved)';
END
$smoke$;
