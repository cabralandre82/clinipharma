import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { logger } from '@/lib/logger'

/**
 * GET /api/cron/purge-server-logs
 * Weekly cron: delete server_logs entries older than 90 days.
 * Schedule: every Monday at 03:00 UTC (see vercel.json)
 */
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = createAdminClient()
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

    const { data, error } = await admin
      .from('server_logs')
      .delete()
      .lt('created_at', cutoff)
      .select('id')

    if (error) {
      logger.error('[cron/purge-server-logs] failed', { error })
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    const purged = data?.length ?? 0
    logger.info('[cron/purge-server-logs] purged old logs', { purged, cutoff })

    return NextResponse.json({ ok: true, purged, cutoff })
  } catch (err) {
    logger.error('[cron/purge-server-logs] unexpected error', { error: err })
    return NextResponse.json({ ok: false, error: 'Erro interno' }, { status: 500 })
  }
}
