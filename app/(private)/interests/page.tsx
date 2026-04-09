import { Metadata } from 'next'
import { requireRolePage } from '@/lib/rbac'
import { createAdminClient } from '@/lib/db/admin'
import { Bell, MessageCircle, Package, User } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { PaginationWrapper } from '@/components/ui/pagination-wrapper'
import { parsePage, paginationRange } from '@/lib/utils'

export const metadata: Metadata = { title: 'Interesses em produtos | Clinipharma' }

const PAGE_SIZE = 20

interface PageProps {
  searchParams: Promise<{ page?: string }>
}

export default async function InterestsPage({ searchParams }: PageProps) {
  await requireRolePage(['SUPER_ADMIN'])

  const params = await searchParams
  const page = parsePage(params.page)
  const { from, to } = paginationRange(page, PAGE_SIZE)

  const admin = createAdminClient()

  const { data: interests, count } = await admin
    .from('product_interests')
    .select(
      `id, name, whatsapp, created_at, user_id,
       products (id, name, sku),
       profiles:user_id (email)`,
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(from, to)

  // Count per product for summary
  const { data: summary } = await admin
    .from('product_interests')
    .select('product_id, products(name, sku)', { count: 'exact' })

  const productCounts: Record<string, { name: string; sku: string; count: number }> = {}
  for (const row of summary ?? []) {
    const pid = row.product_id as string
    const prod = row.products as unknown as { name: string; sku: string } | null
    if (!prod) continue
    if (!productCounts[pid]) productCounts[pid] = { name: prod.name, sku: prod.sku, count: 0 }
    productCounts[pid].count++
  }
  const topProducts = Object.values(productCounts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Interesses em produtos</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          {count ?? 0} registro(s) — clínicas e médicos que demonstraram interesse em produtos
          indisponíveis
        </p>
      </div>

      {/* Top products summary */}
      {topProducts.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-800">
            <Package className="h-4 w-4" />
            Produtos com mais interesse
          </h2>
          <div className="flex flex-wrap gap-2">
            {topProducts.map((p) => (
              <div
                key={p.sku}
                className="flex items-center gap-2 rounded-lg border border-amber-200 bg-white px-3 py-1.5"
              >
                <span className="text-xs font-medium text-gray-700">{p.name}</span>
                <Badge className="bg-amber-500 text-xs text-white">{p.count}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      {(interests ?? []).length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-20 text-center">
          <Bell className="mb-4 h-12 w-12 text-gray-200" />
          <p className="text-sm text-gray-500">Nenhum interesse registrado ainda</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs font-semibold tracking-wider text-gray-500 uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Produto</th>
                <th className="px-4 py-3 text-left">Interessado</th>
                <th className="px-4 py-3 text-left">WhatsApp</th>
                <th className="px-4 py-3 text-left">Usuário</th>
                <th className="px-4 py-3 text-left">Data</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(interests ?? []).map((row) => {
                const product = row.products as unknown as { name: string; sku: string } | null
                const profile = row.profiles as unknown as { email: string } | null
                const wa = String(row.whatsapp).replace(/\D/g, '')
                return (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{product?.name ?? '—'}</div>
                      <div className="text-xs text-gray-400">{product?.sku}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <User className="h-3.5 w-3.5 text-gray-400" />
                        <span className="font-medium text-gray-800">{row.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={`https://wa.me/${wa}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-green-700 hover:underline"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                        {row.whatsapp}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{profile?.email ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {formatDate(row.created_at)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <PaginationWrapper total={count ?? 0} pageSize={PAGE_SIZE} currentPage={page} />
    </div>
  )
}
