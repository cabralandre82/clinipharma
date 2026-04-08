import { Metadata } from 'next'
import { createClient } from '@/lib/db/server'
import { CatalogGrid, type ProductCard } from '@/components/catalog/catalog-grid'
import { CatalogFilters } from '@/components/catalog/catalog-filters'

export const metadata: Metadata = {
  title: 'Catálogo',
}

interface CatalogPageProps {
  searchParams: Promise<{ category?: string; pharmacy?: string; search?: string }>
}

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const params = await searchParams
  const supabase = await createClient()

  let query = supabase
    .from('products')
    .select(
      `
      id, name, slug, concentration, presentation,
      short_description, price_current, estimated_deadline_days,
      active, featured,
      product_categories (id, name, slug),
      pharmacies (id, trade_name),
      product_images (id, public_url, alt_text, sort_order)
    `
    )
    .eq('active', true)
    .order('featured', { ascending: false })
    .order('name')

  if (params.category) query = query.eq('product_categories.slug', params.category)
  if (params.pharmacy) query = query.eq('pharmacy_id', params.pharmacy)
  if (params.search) query = query.ilike('name', `%${params.search}%`)

  const { data: products } = await query

  const { data: categories } = await supabase
    .from('product_categories')
    .select('id, name, slug')
    .eq('is_active', true)
    .order('sort_order')

  const { data: pharmacies } = await supabase
    .from('pharmacies')
    .select('id, trade_name')
    .eq('status', 'ACTIVE')
    .order('trade_name')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Catálogo de produtos</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Produtos farmacêuticos manipulados de nossas farmácias parceiras
        </p>
      </div>

      <CatalogFilters
        categories={categories ?? []}
        pharmacies={pharmacies ?? []}
        currentCategory={params.category}
        currentPharmacy={params.pharmacy}
        currentSearch={params.search}
      />

      <CatalogGrid products={(products ?? []) as unknown as ProductCard[]} />
    </div>
  )
}
