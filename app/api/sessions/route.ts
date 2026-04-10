import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/db/server'
import { createAdminClient } from '@/lib/db/admin'
import { logSession } from '@/lib/session-logger'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const userId = searchParams.get('userId') ?? user.id
  const limit = Number(searchParams.get('limit') ?? '30')

  const admin = createAdminClient()

  // Admins can see any user's logs; regular users only their own
  const { data: roles } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .in('role', ['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  const isAdmin = (roles?.length ?? 0) > 0

  const targetUserId = isAdmin ? userId : user.id

  const { data, error } = await admin
    .from('access_logs')
    .select('*')
    .eq('user_id', targetUserId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    undefined
  const userAgent = req.headers.get('user-agent') ?? undefined

  await logSession({ userId: user.id, ip, userAgent, event: 'SESSION_START' })
  return NextResponse.json({ ok: true })
}
