import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { logger } from '@/lib/logger'

/**
 * GET /api/cron/purge-drafts
 * Daily cron: remove registration drafts past their expiration date.
 * Schedule: every day at 03:30 UTC (see vercel.json)
 *
 * Drafts are anonymous (no auth user created) so deletion is safe and
 * requires no cascade cleanup.
 */
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = createAdminClient()
    const now = new Date().toISOString()

    const { data, error } = await admin
      .from('registration_drafts')
      .delete()
      .lt('expires_at', now)
      .select('id')

    if (error) {
      logger.error('[cron/purge-drafts] failed to delete expired drafts', { error })
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    const purged = data?.length ?? 0
    logger.info('[cron/purge-drafts] purged expired drafts', { purged, ran_at: now })

    return NextResponse.json({ ok: true, ran_at: now, purged })
  } catch (err) {
    logger.error('[cron/purge-drafts] unexpected error', { err })
    return NextResponse.json({ ok: false, error: 'Erro interno' }, { status: 500 })
  }
}
