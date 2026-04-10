import { Metadata } from 'next'
import Link from 'next/link'
import { requireRolePage } from '@/lib/rbac'
import { createAdminClient } from '@/lib/db/admin'
import { formatDate } from '@/lib/utils'
import { Building2, Stethoscope, Clock } from 'lucide-react'
import { PaginationWrapper } from '@/components/ui/pagination-wrapper'
import { parsePage, paginationRange } from '@/lib/utils'
import {
  REGISTRATION_STATUS_LABELS,
  REGISTRATION_STATUS_COLORS,
} from '@/lib/registration-constants'

export const metadata: Metadata = { title: 'Solicitações de cadastro | Clinipharma' }

const PAGE_SIZE = 20

interface PageProps {
  searchParams: Promise<{ page?: string; status?: string }>
}

export default async function RegistrationsPage({ searchParams }: PageProps) {
  await requireRolePage(['SUPER_ADMIN'])

  const params = await searchParams
  const page = parsePage(params.page)
  const { from, to } = paginationRange(page, PAGE_SIZE)
  const statusFilter = params.status

  const admin = createAdminClient()

  let query = admin
    .from('registration_requests')
    .select(`id, type, status, form_data, created_at, updated_at`, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (statusFilter) query = query.eq('status', statusFilter)

  const { data: requests, count } = await query

  // Pending count for badge
  const { count: pendingCount } = await admin
    .from('registration_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'PENDING')

  const statuses = ['PENDING', 'PENDING_DOCS', 'APPROVED', 'REJECTED']

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Solicitações de cadastro</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {count ?? 0} solicitação(ões){' '}
            {statusFilter ? `com status "${REGISTRATION_STATUS_LABELS[statusFilter]}"` : 'no total'}
          </p>
        </div>
        {(pendingCount ?? 0) > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2">
            <Clock className="h-4 w-4 text-amber-600" />
            <span className="text-sm font-medium text-amber-800">
              {pendingCount} aguardando análise
            </span>
          </div>
        )}
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap gap-2">
        <Link
          href="/registrations"
          className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
            !statusFilter
              ? 'bg-[hsl(213,75%,24%)] text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Todos
        </Link>
        {statuses.map((s) => (
          <Link
            key={s}
            href={`/registrations?status=${s}`}
            className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === s
                ? 'bg-[hsl(213,75%,24%)] text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {REGISTRATION_STATUS_LABELS[s]}
          </Link>
        ))}
      </div>

      {(requests ?? []).length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-20 text-center">
          <Clock className="mb-4 h-12 w-12 text-gray-200" />
          <p className="text-sm text-gray-500">Nenhuma solicitação encontrada</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs font-semibold tracking-wider text-gray-500 uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Solicitante</th>
                <th className="px-4 py-3 text-left">Tipo</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Data</th>
                <th className="px-4 py-3 text-left"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(requests ?? []).map((req) => {
                const fd = req.form_data as Record<string, string>
                const name = fd.full_name ?? '—'
                const sub =
                  req.type === 'CLINIC'
                    ? fd.trade_name
                    : `CRM ${fd.crm ?? ''}/${fd.crm_state ?? ''}`
                return (
                  <tr key={req.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{name}</p>
                      <p className="text-xs text-gray-400">{sub}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {req.type === 'CLINIC' ? (
                          <Building2 className="h-3.5 w-3.5 text-blue-500" />
                        ) : (
                          <Stethoscope className="h-3.5 w-3.5 text-purple-500" />
                        )}
                        <span className="text-xs text-gray-600">
                          {req.type === 'CLINIC' ? 'Clínica' : 'Médico'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${REGISTRATION_STATUS_COLORS[req.status]}`}
                      >
                        {REGISTRATION_STATUS_LABELS[req.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {formatDate(req.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/registrations/${req.id}`}
                        className="text-xs font-medium text-[hsl(196,91%,36%)] hover:underline"
                      >
                        Analisar →
                      </Link>
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
