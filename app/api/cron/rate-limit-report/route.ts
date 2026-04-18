/**
 * GET /api/cron/rate-limit-report — Wave 10.
 *
 * Aggregates the last 60 minutes of `rate_limit_violations`
 * and pages on-call when abuse patterns appear. Runs every 15
 * minutes via `vercel.json`.
 *
 * ### Alert ladder
 *
 *   - **P3 (info)**  — < 10 distinct IPs in the last hour. Quiet.
 *   - **P2 (warn)**  — 10–49 distinct IPs OR one IP with
 *     > 100 hits in an hour. `rate-limit-abuse.md` runbook,
 *     dedupKey `rate-limit:spike`.
 *   - **P1 (crit)**  — 50+ distinct IPs, OR any single IP with
 *     > 500 hits, OR > 5 distinct buckets hit by one IP
 *     (indicates credential-stuffing / scanner). Page immediately.
 *
 * ### Retention
 *
 * Every run also calls `rate_limit_purge_old(30)` so the table
 * stays small. Deletion count is logged but does not influence
 * alerting.
 *
 * ### Metrics emitted
 *
 *   rate_limit_suspicious_ips_total — absolute count of IPs in
 *     the last-hour report. Gauge-like, emitted once per run.
 *
 * The endpoint is idempotent: re-running twice within the same
 * minute produces the same verdict (the violation table is
 * minute-bucketed, and PagerDuty dedup keys collapse repeats).
 */

import { createAdminClient } from '@/lib/db/admin'
import { logger } from '@/lib/logger'
import { withCronGuard } from '@/lib/cron/guarded'
import { incCounter, Metrics } from '@/lib/metrics'

interface ReportRow {
  ip_hash: string
  distinct_buckets: number
  total_hits: number
  last_seen_at: string
  first_seen_at: string
  buckets: string[]
  sample_user_id: string | null
}

type Severity = 'info' | 'warning' | 'critical'

interface Classification {
  severity: Severity
  reason: string
  topOffenders: ReportRow[]
}

/**
 * Turn a raw report into an alerting decision. Factoring this
 * out lets us unit-test the thresholds without mocking the
 * database.
 */
export function classifyReport(rows: ReportRow[]): Classification {
  const distinctIps = rows.length
  const maxHits = rows.reduce((acc, r) => Math.max(acc, r.total_hits), 0)
  const maxBuckets = rows.reduce((acc, r) => Math.max(acc, r.distinct_buckets), 0)

  // Stable ordering for sample — highest total_hits first, then
  // distinct_buckets tie-break, then lexicographic hash so two
  // runs with identical data produce identical PagerDuty payloads.
  const sorted = [...rows].sort((a, b) => {
    if (b.total_hits !== a.total_hits) return b.total_hits - a.total_hits
    if (b.distinct_buckets !== a.distinct_buckets) return b.distinct_buckets - a.distinct_buckets
    return a.ip_hash.localeCompare(b.ip_hash)
  })
  const topOffenders = sorted.slice(0, 10)

  if (distinctIps >= 50 || maxHits > 500 || maxBuckets > 5) {
    return {
      severity: 'critical',
      reason:
        distinctIps >= 50
          ? `${distinctIps} IPs blocked in the last hour (>= 50)`
          : maxBuckets > 5
            ? `single IP hitting ${maxBuckets} distinct buckets (credential stuffing?)`
            : `single IP with ${maxHits} hits in the last hour (> 500)`,
      topOffenders,
    }
  }

  if (distinctIps >= 10 || maxHits > 100) {
    return {
      severity: 'warning',
      reason:
        distinctIps >= 10
          ? `${distinctIps} IPs blocked in the last hour (>= 10)`
          : `single IP with ${maxHits} hits (> 100)`,
      topOffenders,
    }
  }

  return {
    severity: 'info',
    reason: `quiet: ${distinctIps} IPs / ${maxHits} max hits`,
    topOffenders,
  }
}

export const GET = withCronGuard('rate-limit-report', async () => {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('rate_limit_report_view')
    .select(
      'ip_hash, distinct_buckets, total_hits, last_seen_at, first_seen_at, buckets, sample_user_id'
    )

  if (error) {
    logger.error('[rate-limit-report] query failed', { error })
    throw new Error(`rate_limit_report_view query failed: ${error.message}`)
  }

  const rows = (data ?? []) as ReportRow[]
  const verdict = classifyReport(rows)

  incCounter(Metrics.RATE_LIMIT_SUSPICIOUS_IPS_TOTAL, { severity: verdict.severity }, rows.length)

  // ── Retention ──────────────────────────────────────────────
  // 30 days is plenty for trend analysis. The service_role
  // executes directly under the RPC's SECURITY DEFINER.
  let purgedCount = 0
  try {
    const { data: purged, error: purgeErr } = await admin.rpc('rate_limit_purge_old', {
      p_retention_days: 30,
    })
    if (purgeErr) {
      logger.warn('[rate-limit-report] purge failed', { error: purgeErr })
    } else {
      purgedCount = Number(purged ?? 0)
    }
  } catch (err) {
    logger.warn('[rate-limit-report] purge threw', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // ── Alert dispatch ─────────────────────────────────────────
  if (verdict.severity !== 'info') {
    try {
      const { triggerAlert } = await import('@/lib/alerts')
      await triggerAlert({
        severity: verdict.severity === 'critical' ? 'critical' : 'warning',
        title: `Rate-limit anomaly — ${verdict.reason}`,
        message:
          `Runbook: docs/runbooks/rate-limit-abuse.md\n` +
          `Top offenders (ip_hash prefix · total_hits · buckets):\n` +
          verdict.topOffenders
            .map(
              (r) => `- ${r.ip_hash.slice(0, 12)}… · ${r.total_hits} hits · ${r.buckets.join(',')}`
            )
            .join('\n'),
        dedupKey:
          verdict.severity === 'critical' ? 'rate-limit:spike:crit' : 'rate-limit:spike:warn',
        component: 'cron/rate-limit-report',
        customDetails: {
          reason: verdict.reason,
          distinctIps: rows.length,
          topOffenders: verdict.topOffenders.map((r) => ({
            ipHashPrefix: r.ip_hash.slice(0, 12),
            totalHits: r.total_hits,
            distinctBuckets: r.distinct_buckets,
            buckets: r.buckets,
            lastSeenAt: r.last_seen_at,
          })),
        },
      })
    } catch (alertErr) {
      logger.error('[rate-limit-report] alert dispatch failed', { error: alertErr })
    }
  }

  logger.info('[rate-limit-report] run complete', {
    distinctIps: rows.length,
    severity: verdict.severity,
    reason: verdict.reason,
    purgedCount,
  })

  return {
    severity: verdict.severity,
    reason: verdict.reason,
    distinctIps: rows.length,
    purgedCount,
  }
})
