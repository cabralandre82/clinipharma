import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/db/server'
import { createAdminClient } from '@/lib/db/admin'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const token: string = body.token
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 })

  const deviceInfo = req.headers.get('user-agent')?.slice(0, 200) ?? null

  const admin = createAdminClient()
  const { error } = await admin
    .from('fcm_tokens')
    .upsert(
      { user_id: user.id, token, device_info: deviceInfo, updated_at: new Date().toISOString() },
      { onConflict: 'token' }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const token: string = body.token
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 })

  const admin = createAdminClient()
  await admin.from('fcm_tokens').delete().eq('token', token).eq('user_id', user.id)
  return NextResponse.json({ ok: true })
}
