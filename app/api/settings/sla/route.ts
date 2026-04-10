import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { requireRole } from '@/lib/rbac'
import { getCurrentUser } from '@/lib/auth/session'
import { z } from 'zod'

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const pharmacyId = searchParams.get('pharmacyId') // null = global

  const admin = createAdminClient()
  const query = admin.from('sla_configs').select('*').order('order_status')

  if (pharmacyId) {
    query.eq('pharmacy_id', pharmacyId)
  } else {
    query.is('pharmacy_id', null)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  try {
    await requireRole(['SUPER_ADMIN'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const slaConfigSchema = z.object({
    configs: z.array(
      z.object({
        order_status: z.string().min(1),
        pharmacy_id: z.string().uuid().nullable().optional(),
        warning_days: z.number().int().min(0),
        alert_days: z.number().int().min(0),
        critical_days: z.number().int().min(0),
      })
    ),
  })
  const parsed = slaConfigSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })

  const { configs } = parsed.data
  const admin = createAdminClient()

  const results = await Promise.all(
    configs.map((c) =>
      admin
        .from('sla_configs')
        .upsert(
          {
            pharmacy_id: c.pharmacy_id ?? null,
            order_status: c.order_status,
            warning_days: c.warning_days,
            alert_days: c.alert_days,
            critical_days: c.critical_days,
          },
          { onConflict: 'pharmacy_id,order_status' }
        )
        .select()
    )
  )

  const errors = results.filter((r) => r.error)
  if (errors.length) return NextResponse.json({ error: errors[0].error?.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
