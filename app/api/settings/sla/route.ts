import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { requireRole } from '@/lib/rbac'

export async function GET(req: NextRequest) {
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
  const admin = createAdminClient()

  // body: { configs: [{order_status, pharmacy_id, warning_days, alert_days, critical_days}] }
  const configs = body.configs as Array<{
    order_status: string
    pharmacy_id: string | null
    warning_days: number
    alert_days: number
    critical_days: number
  }>

  if (!Array.isArray(configs))
    return NextResponse.json({ error: 'configs array required' }, { status: 400 })

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
