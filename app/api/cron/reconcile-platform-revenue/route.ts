/**
 * GET /api/cron/reconcile-platform-revenue — nightly platform revenue
 * reconciliation audit (Wave 16, follow-up of migration 064).
 *
 * Reads `public.platform_revenue_view` (migration 063 + 064) and finds
 * every CONFIRMED-payment order whose `recon_gap` exceeds 1 cent. The
 * gap is defined as
 *
 *   recorded_platform_commission − (gross_paid − pharmacy_share)
 *
 * which is zero by construction when the platform booked the
 * commission against the post-coupon paid amount. A non-zero gap means
 * one of the following:
 *
 *   1. A coupon order was confirmed via the legacy non-RPC path BEFORE
 *      `services/payments.ts` was patched on 2026-04-29 (the same bug
 *      that produced the R$ 9,50 phantom money on CP-2026-000015). The
 *      fix is one of: (a) backfill the `commissions` and `transfers`
 *      rows manually under audit, or (b) approve the operator to call
 *      a future `recompute_commission_atomic` helper.
 *
 *   2. A direct ledger edit happened outside the platform code path
 *      (someone hand-ran SQL in the prod DB to "fix" something).
 *      Same backfill path applies; also opens a question of whether
 *      the audit_logs chain caught the edit.
 *
 *   3. The `confirm_payment_atomic` RPC was called BEFORE migration
 *      064 reached the database. The pre-064 body summed the
 *      `platform_commission_per_unit` snapshot, so any payment
 *      confirmed via that RPC against a coupon order has a non-zero
 *      gap. Same backfill path applies.
 *
 * Output (when there is no drift):
 *   { scanned: N, gapCount: 0, totalGapCents: 0, durationMs: T }
 *
 * On a non-zero gap the cron:
 *   - logs `error` with a sample of the offending rows;
 *   - emits `platform_revenue_recon_gap_total{table,severity}` and
 *     `platform_revenue_recon_gap_amount_cents` for the dashboards;
 *   - fires a P2 alert via `triggerAlert` with `dedupKey =
 *     platform-revenue:recon:gap`;
 *   - throws so the cron_runs row is `failed` and on-call is paged.
 *
 * Manual run:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     https://clinipharma.com.br/api/cron/reconcile-platform-revenue
 *
 * Schedule: 04:30 UTC daily (after `verify-audit-chain` at 03:45 and
 * before `purge-revoked-tokens` at 03:00 — none of them touch the
 * commissions ledger so order doesn't matter, but the picked slot is
 * empty in `vercel.json`).
 */

import { createAdminClient } from '@/lib/db/admin'
import { logger } from '@/lib/logger'
import { withCronGuard } from '@/lib/cron/guarded'
import { incCounter, setGauge, observeHistogram, Metrics } from '@/lib/metrics'

interface RevenueRow {
  order_id: string
  order_code: string | null
  gross_paid: string | number | null
  pharmacy_share: string | number | null
  consultant_share: string | number | null
  platform_net: string | number | null
  recorded_platform_commission: string | number | null
  recon_gap: string | number | null
  payment_status: string | null
  transfer_status: string | null
}

const MAX_SAMPLES_LOGGED = Number(process.env.PLATFORM_REVENUE_RECON_MAX_SAMPLES ?? '20')
const GAP_THRESHOLD_CENTS = Number(process.env.PLATFORM_REVENUE_RECON_THRESHOLD_CENTS ?? '1')

export const GET = withCronGuard('reconcile-platform-revenue', async () => {
  const started = Date.now()
  const admin = createAdminClient()

  // Pull only paid orders. The view exposes draft / pending rows too,
  // but those have no commission row yet (recon_gap = NULL or 0) and
  // would just inflate the scan count.
  const { data, error } = await admin
    .from('platform_revenue_view')
    .select(
      'order_id, order_code, gross_paid, pharmacy_share, consultant_share, platform_net, recorded_platform_commission, recon_gap, payment_status, transfer_status'
    )
    .eq('payment_status', 'CONFIRMED')

  const duration = Date.now() - started
  observeHistogram(Metrics.PLATFORM_REVENUE_RECON_DURATION_MS, duration)
  setGauge(Metrics.PLATFORM_REVENUE_RECON_LAST_RUN_TS, Math.floor(Date.now() / 1000))

  if (error) {
    logger.error('[reconcile-platform-revenue] view query failed', { error })
    throw new Error(`platform_revenue_view query failed: ${error.message}`)
  }

  const rows = (data ?? []) as RevenueRow[]

  // Cents-precise comparison. Doing the threshold in cents avoids the
  // rounding noise floating-point arithmetic introduces on numerics like
  // 0.30000000000000004 — the underlying ledger is integer cents.
  const offending = rows.filter((r) => {
    const gap = Number(r.recon_gap ?? 0)
    const cents = Math.round(Math.abs(gap) * 100)
    return cents >= GAP_THRESHOLD_CENTS
  })

  const totalGapCents = offending.reduce((s, r) => {
    return s + Math.round(Math.abs(Number(r.recon_gap ?? 0)) * 100)
  }, 0)
  setGauge(Metrics.PLATFORM_REVENUE_RECON_GAP_AMOUNT_CENTS, totalGapCents)

  if (offending.length === 0) {
    logger.info('[reconcile-platform-revenue] no gap', {
      scanned: rows.length,
      durationMs: duration,
    })
    return {
      scanned: rows.length,
      gapCount: 0,
      totalGapCents: 0,
      durationMs: duration,
      sampleRows: [],
    }
  }

  for (const _row of offending) {
    incCounter(Metrics.PLATFORM_REVENUE_RECON_GAP_TOTAL, { severity: 'warning' })
  }

  const sample = offending.slice(0, MAX_SAMPLES_LOGGED).map((r) => ({
    orderId: r.order_id,
    orderCode: r.order_code,
    grossPaid: String(r.gross_paid ?? '0'),
    pharmacyShare: String(r.pharmacy_share ?? '0'),
    consultantShare: String(r.consultant_share ?? '0'),
    recordedPlatformCommission: String(r.recorded_platform_commission ?? '0'),
    reconGap: String(r.recon_gap ?? '0'),
    transferStatus: r.transfer_status,
  }))

  logger.error('[reconcile-platform-revenue] gap detected', {
    scanned: rows.length,
    gapCount: offending.length,
    totalGapCents,
    durationMs: duration,
    sample,
  })

  // Dynamic import: `lib/alerts` pulls in the email transport which
  // only links on the Node runtime. The cron module otherwise stays
  // edge-compatible.
  try {
    const { triggerAlert } = await import('@/lib/alerts')
    await triggerAlert({
      severity: 'warning',
      title: `Reconciliação: ${offending.length} pedido(s) com gap de comissão (${totalGapCents}¢)`,
      message:
        `platform_revenue_view encontrou ${offending.length} pedido(s) cujo ` +
        `commission_total_amount divergiu de (gross_paid - pharmacy_share) por mais de ` +
        `${GAP_THRESHOLD_CENTS} centavo(s). Veja docs/runbooks/platform-revenue-reconciliation.md.\n\n` +
        sample
          .slice(0, 10)
          .map(
            (r) =>
              `${r.orderCode ?? r.orderId}: gap=${r.reconGap} (pago=${r.grossPaid}, farmácia=${r.pharmacyShare}, registrado=${r.recordedPlatformCommission})`
          )
          .join('\n'),
      dedupKey: 'platform-revenue:recon:gap',
      component: 'cron/reconcile-platform-revenue',
      customDetails: {
        gapCount: offending.length,
        totalGapCents,
        sample,
      },
    })
  } catch (alertErr) {
    logger.error('[reconcile-platform-revenue] alert dispatch failed', { error: alertErr })
  }

  // Marking the run as failed forces on-call paging through the standard
  // cron-failure path. The runbook resolves backfill or audit-trail
  // verification.
  throw new Error(
    `platform_revenue_view returned ${offending.length} row(s) with |recon_gap| >= ${GAP_THRESHOLD_CENTS}¢; total gap ${totalGapCents}¢. See runbook platform-revenue-reconciliation.md`
  )
})
