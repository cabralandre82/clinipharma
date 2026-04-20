import { createAdminClient } from '@/lib/db/admin'
import { logger } from '@/lib/logger'
import { withCronGuard } from '@/lib/cron/guarded'

/**
 * GET /api/cron/purge-server-logs
 * Weekly cron — deletes operational log tables past their 90-day
 * retention window (RP-14 cron_runs, RP-15 server_logs).
 * Schedule: every Monday at 03:00 UTC (see vercel.json).
 *
 * Wrapped by withCronGuard (Wave 2) — single-flight lock + cron_runs audit.
 *
 * Note on cron_runs self-referential purge: this cron's own row is
 * written by withCronGuard *after* the handler returns, so the row
 * for this invocation is safely outside the 90-day cutoff and will
 * not delete itself.
 */
export const GET = withCronGuard('purge-server-logs', async () => {
  const admin = createAdminClient()
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  // RP-15 — server_logs (application events, 90d)
  const { data: serverLogsData, error: serverLogsErr } = await admin
    .from('server_logs')
    .delete()
    .lt('created_at', cutoff)
    .select('id')

  if (serverLogsErr) {
    logger.error('purge failed', {
      action: 'purge-server-logs',
      table: 'server_logs',
      error: serverLogsErr,
    })
    throw new Error(`server_logs delete failed: ${serverLogsErr.message}`)
  }
  const serverLogsPurged = serverLogsData?.length ?? 0

  // RP-14 — cron_runs (cron execution audit, 90d). Partial failure
  // here is non-fatal: we've already purged server_logs; log + return.
  let cronRunsPurged = 0
  const { data: cronRunsData, error: cronRunsErr } = await admin
    .from('cron_runs')
    .delete()
    .lt('started_at', cutoff)
    .select('id')

  if (cronRunsErr) {
    logger.error('cron_runs purge failed', {
      action: 'purge-server-logs',
      table: 'cron_runs',
      error: cronRunsErr,
    })
  } else {
    cronRunsPurged = cronRunsData?.length ?? 0
  }

  const purged = serverLogsPurged + cronRunsPurged
  logger.info('purged old logs', {
    action: 'purge-server-logs',
    purged,
    serverLogsPurged,
    cronRunsPurged,
    cutoff,
  })

  return { purged, serverLogsPurged, cronRunsPurged, cutoff }
})
