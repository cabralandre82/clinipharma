/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/db/server'
import { createAdminClient } from '@/lib/db/admin'
import { createNotification } from '@/lib/notifications'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { orderId, templateId } = body

  const admin = createAdminClient()
  let items: Array<{
    product_id: string
    variant_id: string | null
    quantity: number
    pharmacy_id: string
    unit_price: number
    pharmacy_cost_per_unit: number
  }> = []
  let clinicId: string
  let pharmacyId: string

  if (orderId) {
    // Reorder from an existing order
    const { data: order } = await admin
      .from('orders')
      .select(
        'clinic_id, pharmacy_id, order_items(product_id, variant_id, quantity, unit_price, pharmacy_cost_per_unit)'
      )
      .eq('id', orderId)
      .single()

    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    clinicId = (order as any).clinic_id
    pharmacyId = (order as any).pharmacy_id
    items = ((order as any).order_items ?? []).map((i: any) => ({
      product_id: i.product_id,
      variant_id: i.variant_id ?? null,
      quantity: i.quantity,
      pharmacy_id: pharmacyId,
      unit_price: i.unit_price,
      pharmacy_cost_per_unit: i.pharmacy_cost_per_unit ?? 0,
    }))
  } else if (templateId) {
    // Use a saved template
    const { data: template } = await admin
      .from('order_templates')
      .select('*')
      .eq('id', templateId)
      .single()

    if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    clinicId = (template as any).clinic_id
    const templateItems = (template as any).items as Array<{
      product_id: string
      variant_id?: string
      quantity: number
      pharmacy_id: string
      unit_price: number
      pharmacy_cost_per_unit?: number
    }>
    pharmacyId = templateItems[0]?.pharmacy_id
    items = templateItems.map((i) => ({
      product_id: i.product_id,
      variant_id: i.variant_id ?? null,
      quantity: i.quantity,
      pharmacy_id: i.pharmacy_id,
      unit_price: i.unit_price,
      pharmacy_cost_per_unit: i.pharmacy_cost_per_unit ?? 0,
    }))
  } else {
    return NextResponse.json({ error: 'orderId or templateId required' }, { status: 400 })
  }

  if (!items.length) return NextResponse.json({ error: 'No items to reorder' }, { status: 400 })

  // Generate new order code
  const code = `PED-${Date.now().toString(36).toUpperCase()}`
  const totalAmount = items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0)

  // Create new order
  const { data: newOrder, error: orderErr } = await admin
    .from('orders')
    .insert({
      code,
      clinic_id: clinicId!,
      pharmacy_id: pharmacyId!,
      order_status: 'DRAFT',
      total_amount: totalAmount,
      created_by: user.id,
    })
    .select()
    .single()

  if (orderErr || !newOrder) {
    return NextResponse.json(
      { error: orderErr?.message ?? 'Failed to create order' },
      { status: 500 }
    )
  }

  // Create order items
  await admin.from('order_items').insert(
    items.map((i) => ({
      order_id: (newOrder as any).id,
      product_id: i.product_id,
      variant_id: i.variant_id,
      quantity: i.quantity,
      unit_price: i.unit_price,
      total_price: i.unit_price * i.quantity,
      pharmacy_cost_per_unit: i.pharmacy_cost_per_unit,
      pharmacy_id: i.pharmacy_id,
    }))
  )

  // Tracking token — upsert to avoid duplicate on conflict
  await admin.from('order_tracking_tokens').upsert(
    {
      order_id: (newOrder as any).id,
      expires_at: null,
    },
    { onConflict: 'order_id', ignoreDuplicates: true }
  )

  // Notification
  await createNotification({
    userId: user.id,
    type: 'ORDER_CREATED',
    title: `Pedido ${code} criado (repetição)`,
    message: `Pedido gerado a partir de ${orderId ? 'pedido anterior' : 'template'}. Acesse para concluir.`,
    link: `/orders/${(newOrder as any).id}`,
  })

  return NextResponse.json({ orderId: (newOrder as any).id, code }, { status: 201 })
}
