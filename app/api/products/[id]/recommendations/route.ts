import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { requireRole } from '@/lib/rbac'

/**
 * GET /api/products/[id]/recommendations
 * Returns top product recommendations (frequently bought together) for a given product.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN', 'CLINIC_ADMIN', 'DOCTOR'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('product_associations')
    .select(
      `product_b_id,
       support,
       confidence,
       product:product_b_id (
         id, name, slug, price_current, status,
         category:category_id (name)
       )`
    )
    .eq('product_a_id', id)
    .gte('confidence', 0.1)
    .order('confidence', { ascending: false })
    .limit(4)

  if (error) {
    return NextResponse.json({ error: 'Erro ao buscar recomendações' }, { status: 500 })
  }

  const recommendations = (data ?? [])
    .map((row) => {
      const product = row.product as unknown as {
        id: string
        name: string
        slug: string
        price_current: number
        status: string
        category: { name: string } | null
      } | null
      if (!product || product.status !== 'active') return null
      return {
        id: product.id,
        name: product.name,
        slug: product.slug,
        price_current: product.price_current,
        category: product.category?.name,
        confidence: row.confidence,
        support: row.support,
      }
    })
    .filter(Boolean)

  return NextResponse.json({ recommendations })
}
