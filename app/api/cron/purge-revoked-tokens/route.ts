import { NextRequest, NextResponse } from 'next/server'
import { purgeExpiredTokens } from '@/lib/token-revocation'

/**
 * Daily cron: removes expired rows from revoked_tokens.
 * Vercel cron schedule: every day at 03:00 UTC (configured in vercel.json).
 */
export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret') ?? req.nextUrl.searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { deleted } = await purgeExpiredTokens()
    return NextResponse.json({ ok: true, deleted })
  } catch (err) {
    console.error('[cron/purge-revoked-tokens]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
