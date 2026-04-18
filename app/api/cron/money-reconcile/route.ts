/**
 * GET /api/cron/money-reconcile — Wave 8 money-drift detector.
 *
 * Selects from `public.money_drift_view` (migration 050) which lists
 * every hot-path row whose `*_cents` column disagrees with its twin
 * `numeric` column by more than 1 cent. The view is empty in steady
 * state — any non-zero count means a writer (legacy path, external
 * admin, or bug in a sync trigger) broke the invariant, which is a
 * **P2** because it blocks flipping `money.cents_read` to ON.
 *
 * Emits:
 *   - `money_drift_total{table,field}` counter (per drift row).
 *   - `money_reconcile_last_run_ts` gauge.
 *   - `money_reconcile_duration_ms` histogram.
 *
 * If drift is found, fires a P2 alert via `lib/alerts::triggerAlert`
 * with `severity='warning'` and dedup key `money:reconcile:drift`,
 * and the cron run is marked `failed` so the runbook
 * `docs/runbooks/money-drift.md` triggers.
 *
 * Wrapped by `withCronGuard` for single-flight semantics.
 * Schedule: every 30 min via `vercel.json` (the view is cheap — all
 * 7 subqueries hit PK indexes). Can be run manually via
 * `GET /api/cron/money-reconcile` with `Authorization: Bearer $CRON_SECRET`.
 */

import { createAdminClient } from '@/lib/db/admin'
import { logger } from '@/lib/logger'
import { withCronGuard } from '@/lib/cron/guarded'
import { incCounter, setGauge, observeHistogram, Metrics } from '@/lib/metrics'

interface DriftRow {
  table_name: string
  row_id: string
  field: string
  numeric_value: string | number
  cents_value: string | number
  drift_cents: string | number
}

const MAX_SAMPLES_LOGGED = Number(process.env.MONEY_RECONCILE_MAX_SAMPLES ?? '20')

export const GET = withCronGuard('money-reconcile', async () => {
  const started = Date.now()
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('money_drift_view')
    .select('table_name, row_id, field, numeric_value, cents_value, drift_cents')
    .limit(MAX_SAMPLES_LOGGED + 1)

  const duration = Date.now() - started
  observeHistogram(Metrics.MONEY_RECONCILE_DURATION_MS, duration)
  setGauge(Metrics.MONEY_RECONCILE_LAST_RUN_TS, Math.floor(Date.now() / 1000))

  if (error) {
    logger.error('[money-reconcile] view query failed', { error })
    throw new Error(`money_drift_view query failed: ${error.message}`)
  }

  const rows = (data ?? []) as DriftRow[]
  const driftCount = rows.length

  if (driftCount === 0) {
    logger.info('[money-reconcile] no drift', { durationMs: duration })
    return { driftCount: 0, durationMs: duration, sampleRows: [] }
  }

  for (const row of rows) {
    incCounter(Metrics.MONEY_DRIFT_TOTAL, {
      table: row.table_name,
      field: row.field,
    })
  }

  const sample = rows.slice(0, MAX_SAMPLES_LOGGED)
  logger.error('[money-reconcile] drift detected', {
    driftCount,
    durationMs: duration,
    sample: sample.map((r) => ({
      table: r.table_name,
      id: r.row_id,
      field: r.field,
      numeric: String(r.numeric_value),
      cents: String(r.cents_value),
      driftCents: String(r.drift_cents),
    })),
  })

  // Dynamic import so the cron module stays compatible with the Edge
  // runtime used by the metrics layer; `lib/alerts` pulls in email
  // deps that only live on Node.
  try {
    const { triggerAlert } = await import('@/lib/alerts')
    await triggerAlert({
      severity: 'warning',
      title: `Money reconciliation: ${driftCount} row(s) with drift > 1 cent`,
      message:
        `See runbook docs/runbooks/money-drift.md. Sample:\n` +
        sample
          .map((r) => `${r.table_name}.${r.field} id=${r.row_id} drift=${r.drift_cents}`)
          .join('\n'),
      dedupKey: 'money:reconcile:drift',
      component: 'cron/money-reconcile',
      customDetails: {
        driftCount,
        sample: sample.map((r) => ({
          table: r.table_name,
          id: r.row_id,
          field: r.field,
          driftCents: String(r.drift_cents),
        })),
      },
    })
  } catch (alertErr) {
    logger.error('[money-reconcile] alert dispatch failed', { error: alertErr })
  }

  // Throwing makes the cron_runs row `failed` so on-call is paged via
  // the standard cron-failure path. The runbook money-drift.md takes
  // over from here.
  throw new Error(`money_drift_view returned ${driftCount} row(s); see runbook money-drift.md`)
})
