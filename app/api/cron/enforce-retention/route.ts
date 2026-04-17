import { NextRequest, NextResponse } from 'next/server'
import { enforceRetentionPolicy } from '@/lib/retention-policy'
import { logger, withCronContext } from '@/lib/logger'

/**
 * GET /api/cron/enforce-retention
 * Monthly cron: enforces data retention policy per LGPD + CTN requirements.
 * Schedule: 1st of each month at 02:00 UTC (see vercel.json)
 */
export const GET = withCronContext('enforce-retention', async (req: NextRequest) => {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await enforceRetentionPolicy()

  if (result.errors.length > 0) {
    logger.error('partial errors', { action: 'enforce-retention', errors: result.errors })
  }

  return NextResponse.json({
    ok: true,
    ran_at: new Date().toISOString(),
    ...result,
  })
})
