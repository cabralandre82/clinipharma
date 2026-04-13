import { Metadata } from 'next'
import { createAdminClient } from '@/lib/db/admin'
import { CatalogGrid, type ProductCard } from '@/components/catalog/catalog-grid'
import { CatalogFilters } from '@/components/catalog/catalog-filters'
import { PaginationWrapper } from '@/components/ui/pagination-wrapper'
import { parsePage, paginationRange } from '@/lib/utils'
import { Suspense } from 'react'

export const metadata: Metadata = { title: 'Catálogo | Clinipharma' }

const PAGE_SIZE = 12

interface CatalogPageProps {
  searchParams: Promise<{
    category?: string
    pharmacy?: string
    search?: string
    sort?: string
    page?: string
  }>
}

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const params = await searchParams
  const supabase = createAdminClient()

  const page = parsePage(params.page)
  const { from, to } = paginationRange(page, PAGE_SIZE)

  // Resolve category slug → id
  let categoryId: string | undefined
  if (params.category) {
    const { data: cat } = await supabase
      .from('product_categories')
      .select('id')
      .eq('slug', params.category)
      .single()
    categoryId = cat?.id
  }

  // Build order
  const sort = params.sort ?? 'featured'
  const orderMap: Record<string, { col: string; asc: boolean }> = {
    featured: { col: 'featured', asc: false },
    name_asc: { col: 'name', asc: true },
    price_asc: { col: 'price_current', asc: true },
    price_desc: { col: 'price_current', asc: false },
    newest: { col: 'created_at', asc: false },
  }
  const { col: sortCol, asc: sortAsc } = orderMap[sort] ?? orderMap.featured

  let query = supabase
    .from('products')
    .select(
      `id, name, slug, concentration, presentation,
       short_description, price_current, estimated_deadline_days,
       active, status, featured,
       product_categories (id, name, slug),
       pharmacies (id, trade_name),
       product_images (id, public_url, alt_text, sort_order)`,
      { count: 'exact' }
    )
    .in('status', ['active', 'unavailable'])

  if (categoryId) query = query.eq('category_id', categoryId)
  if (params.pharmacy) query = query.eq('pharmacy_id', params.pharmacy)
  if (params.search) query = query.ilike('name', `%${params.search}%`)

  if (sortCol === 'featured') {
    query = query.order('featured', { ascending: false }).order('name', { ascending: true })
  } else {
    query = query.order(sortCol, { ascending: sortAsc })
  }

  const { data: products, count } = await query.range(from, to)

  const [{ data: categories }, { data: pharmacies }] = await Promise.all([
    supabase
      .from('product_categories')
      .select('id, name, slug')
      .eq('is_active', true)
      .order('sort_order'),
    supabase.from('pharmacies').select('id, trade_name').eq('status', 'ACTIVE').order('trade_name'),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Catálogo de produtos</h1>
          <p className="mt-0.5 text-sm text-gray-500">{count ?? 0} produto(s) encontrado(s)</p>
        </div>
      </div>

      <Suspense fallback={null}>
        <CatalogFilters
          categories={categories ?? []}
          pharmacies={pharmacies ?? []}
          currentCategory={params.category}
          currentPharmacy={params.pharmacy}
          currentSearch={params.search}
          currentSort={sort}
        />
      </Suspense>

      <CatalogGrid products={(products ?? []) as unknown as ProductCard[]} />

      <PaginationWrapper total={count ?? 0} pageSize={PAGE_SIZE} currentPage={page} />
    </div>
  )
}
