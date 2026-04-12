import { NextRequest, NextResponse } from 'next/server'
import { inngest } from '@/lib/inngest'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await inngest.send({ name: 'cron/churn.check', data: { triggeredAt: new Date().toISOString() } })

  return NextResponse.json({ ok: true, triggered: 'churn-detection' })
}
