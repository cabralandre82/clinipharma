import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { requireRole } from '@/lib/rbac'
import { z } from 'zod'

const variantSchema = z.object({
  product_id: z.string().uuid(),
  name: z.string().min(1),
  attributes: z.record(z.string(), z.string()).default({}),
  price_current: z.number().min(0),
  pharmacy_cost: z.number().min(0).default(0),
  platform_commission_type: z.enum(['PERCENTAGE', 'FIXED']).default('FIXED'),
  platform_commission_value: z.number().min(0).default(0),
  is_default: z.boolean().default(false),
})

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const productId = searchParams.get('productId')
  if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('product_variants')
    .select('*')
    .eq('product_id', productId)
    .order('is_default', { ascending: false })
    .order('created_at')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  try {
    await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const parsed = variantSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const admin = createAdminClient()

  // If marking as default, unset other defaults for this product
  if (parsed.data.is_default) {
    await admin
      .from('product_variants')
      .update({ is_default: false })
      .eq('product_id', parsed.data.product_id)
  }

  const { data, error } = await admin.from('product_variants').insert(parsed.data).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  try {
    await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { id, ...updates } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = createAdminClient()

  if (updates.is_default) {
    const { data: v } = await admin
      .from('product_variants')
      .select('product_id')
      .eq('id', id)
      .single()
    if (v)
      await admin
        .from('product_variants')
        .update({ is_default: false })
        .eq('product_id', v.product_id)
  }

  const { data, error } = await admin
    .from('product_variants')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  try {
    await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = req.nextUrl
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = createAdminClient()
  const { error } = await admin.from('product_variants').update({ is_active: false }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
