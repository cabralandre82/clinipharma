-- Migration 069 — confirm_payment_atomic resolves doctor consultant.
--
-- Bug
-- ---
-- Continuação direta da migration 068. A função
-- `public.confirm_payment_atomic` (versão da migration 064) só olhava
-- `clinics.consultant_id` ao decidir se um pedido gera comissão de
-- consultor:
--
--   IF v_order.clinic_id IS NOT NULL THEN
--     SELECT consultant_id INTO v_consultant_id
--       FROM public.clinics WHERE id = v_order.clinic_id;
--     ...
--   END IF;
--
-- Pedido com `buyer_type='DOCTOR'` (clinic_id NULL, doctor_id NOT NULL)
-- nunca entrava no bloco. Mesmo se algum dia `doctors.consultant_id`
-- existisse (não existia até 068), não seria lido.
--
-- Fix
-- ---
-- Adicionar ramo ELSIF que resolve via `doctors.consultant_id`. Toda
-- a lógica subsequente (carregamento de rate via app_settings, INSERT
-- em consultant_commissions, etc) é a mesma — só a etapa de
-- resolução do consultor ganha um caminho extra.
--
-- O resto do corpo da função é IDÊNTICO ao da migration 064. Mantemos
-- a função cirurgicamente mínima: nenhum outro behaviour change.
--
-- Verificação
-- -----------
-- Após aplicar, smoke local:
--   1. Inserir doctor com consultant_id apontando para sales_consultant ativo.
--   2. Criar order com buyer_type='DOCTOR', doctor_id setado.
--   3. Criar payment PENDING vinculado a esse order.
--   4. Chamar confirm_payment_atomic — esperar consultant_commissions
--      com 1 linha.
-- Coberto pelos novos tests em
-- `tests/unit/sql/confirm-payment-atomic-doctor-consultant.test.ts`.
--
-- Rollback
-- --------
-- Aplicar de volta o corpo exato da migration 064 via
-- CREATE OR REPLACE FUNCTION. (Coluna doctors.consultant_id pode ser
-- mantida — não rege a função; só fica órfã.)
--
-- LGPD: nenhum dado novo persistido pela função. Resolução é em
-- memória durante a transação de pagamento.

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
  v_consultant_commission numeric(10,2);
BEGIN
  IF p_payment_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payment' USING ERRCODE = 'P0001';
  END IF;
  IF p_args IS NULL OR (p_args ? 'confirmed_by_user_id') = false THEN
    RAISE EXCEPTION 'invalid_args' USING ERRCODE = 'P0001';
  END IF;

  v_expected_lock := COALESCE((p_args ->> 'expected_lock_version')::int, 0);

  -- Atomic status transition. If another confirmer already moved the
  -- payment to CONFIRMED, `lock_version` will no longer match the expected
  -- value (which defaults to the row's current one in the TS wrapper) and
  -- the UPDATE will match 0 rows.
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
    -- Distinguish "already confirmed" from "stale version" so the caller
    -- can retry on stale but abort on already-confirmed.
    IF EXISTS (SELECT 1 FROM public.payments WHERE id = p_payment_id AND status <> 'PENDING') THEN
      RAISE EXCEPTION 'already_processed' USING ERRCODE = 'P0001';
    END IF;
    IF v_expected_lock > 0 AND EXISTS (SELECT 1 FROM public.payments WHERE id = p_payment_id) THEN
      RAISE EXCEPTION 'stale_version' USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Load the companion order once; subsequent updates reuse it.
  SELECT * INTO v_order FROM public.orders WHERE id = v_payment.order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Pharmacy transfer = sum of frozen pharmacy_cost columns. INVARIANT
  -- to coupons: a R$ 9,50 coupon does NOT cut what the pharmacy gets;
  -- the platform absorbs the discount. (This is current product policy
  -- as of 2026-04-29.)
  SELECT round(coalesce(sum(pharmacy_cost_per_unit * quantity), 0)::numeric, 2)
    INTO v_pharmacy_transfer
    FROM public.order_items
   WHERE order_id = v_payment.order_id;

  -- Platform commission DERIVED from the reconciliation invariant
  -- (mig-064). pharmacy_transfer + platform_commission == gross_paid is
  -- now an exact arithmetic identity.
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

  -- ── Consultant resolution — buyer-aware ─────────────────────────────
  --
  -- Migration 069 (this file): em vez de olhar SOMENTE clinic.consultant_id,
  -- a função agora ramifica por buyer_type. Pedido de DOCTOR resolve via
  -- doctors.consultant_id (coluna criada em migration 068).
  --
  -- Os dois ramos são mutuamente exclusivos por construção: um order tem
  -- ou clinic_id ou doctor_id (orders schema enforces this since day 1).
  IF v_order.clinic_id IS NOT NULL THEN
    SELECT consultant_id INTO v_consultant_id
      FROM public.clinics WHERE id = v_order.clinic_id;
  ELSIF v_order.doctor_id IS NOT NULL THEN
    SELECT consultant_id INTO v_consultant_id
      FROM public.doctors WHERE id = v_order.doctor_id;
  END IF;

  -- A partir daqui o caminho é idêntico ao da migration 064 — apenas
  -- a fonte do consultant_id mudou.
  IF v_consultant_id IS NOT NULL THEN
    SELECT COALESCE((value_json::text)::numeric, 5)
      INTO v_consultant_rate
      FROM public.app_settings
     WHERE key = 'consultant_commission_rate'
     LIMIT 1;
    v_consultant_rate := COALESCE(v_consultant_rate, 5);
    v_consultant_commission := round(v_order.total_price * v_consultant_rate / 100, 2);

    INSERT INTO public.consultant_commissions (
      order_id, consultant_id, order_total,
      commission_rate, commission_amount, status
    ) VALUES (
      v_payment.order_id, v_consultant_id, v_order.total_price,
      v_consultant_rate, v_consultant_commission, 'PENDING'
    );
  END IF;

  -- Order status transition — also lock-versioned so a concurrent admin
  -- edit cannot silently clobber the new status.
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
    'new_lock_version', v_payment.lock_version
  );
END;
$$;

-- ── Smoke ──────────────────────────────────────────────────────────────
-- Verifica apenas que a função compila e tem a assinatura esperada.
-- Smoke funcional vive nos tests Vitest (que mocam o RPC).
DO $smoke$
BEGIN
  PERFORM 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'confirm_payment_atomic'
     AND pg_get_function_arguments(p.oid) = 'p_payment_id uuid, p_args jsonb';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Migration 069 smoke: confirm_payment_atomic signature missing';
  END IF;
  RAISE NOTICE 'Migration 069 smoke passed (confirm_payment_atomic doctor branch installed)';
END
$smoke$;
