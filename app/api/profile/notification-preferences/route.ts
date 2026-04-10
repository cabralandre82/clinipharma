import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/db/server'
import { createAdminClient } from '@/lib/db/admin'
import { SILENCEABLE_TYPES } from '@/lib/notifications'

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const rawPrefs: Record<string, boolean> = body.preferences ?? {}

  // Only allow toggling silenceable types — strip everything else
  const sanitized: Record<string, boolean> = {}
  for (const type of SILENCEABLE_TYPES) {
    if (type in rawPrefs) {
      sanitized[type] = Boolean(rawPrefs[type])
    }
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('profiles')
    .update({ notification_preferences: sanitized })
    .eq('id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
