import { Metadata } from 'next'
import { createAdminClient } from '@/lib/db/admin'
import { requireRolePage } from '@/lib/rbac'
import { formatDateTime } from '@/lib/utils'

import { parseCursorParams, sliceCursorResult } from '@/lib/cursor-pagination'
import { CursorPagination } from '@/components/ui/cursor-pagination'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Auditoria | Clinipharma' }

// Audit logs grow fastest of all tables — 50/page and cursor pagination are critical here
const PAGE_SIZE = 50

interface Props {
  searchParams: Promise<{ after?: string; before?: string }>
}

const ACTION_COLORS: Record<string, string> = {
  CREATE: 'bg-green-100 text-green-800',
  UPDATE: 'bg-blue-100 text-blue-800',
  DELETE: 'bg-red-100 text-red-800',
  STATUS_CHANGE: 'bg-purple-100 text-purple-800',
  PRICE_CHANGE: 'bg-amber-100 text-amber-800',
  PAYMENT_CONFIRMED: 'bg-teal-100 text-teal-800',
  TRANSFER_REGISTERED: 'bg-cyan-100 text-cyan-800',
  LOGIN: 'bg-gray-100 text-gray-700',
}

type AuditLog = {
  id: string
  entity_type: string
  entity_id: string
  action: string
  actor_role: string | null
  created_at: string
  profiles: { full_name: string } | null
}

export default async function AuditPage({ searchParams }: Props) {
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  const { after, before } = await searchParams
  const supabase = createAdminClient()

  const cursor = parseCursorParams({ after, before, pageSize: PAGE_SIZE })

  let q = supabase
    .from('audit_logs')
    .select(
      `id, entity_type, entity_id, action, actor_role, created_at,
       profiles!actor_user_id (full_name)`
    )
    .order('created_at', { ascending: cursor.ascending })

  if (cursor.after) q = q.lt('created_at', cursor.after)
  if (cursor.before) q = q.gt('created_at', cursor.before)

  const { data: raw } = await q.limit(cursor.fetchSize)

  const {
    rows: logs,
    nextCursor,
    prevCursor,
    isFirstPage,
  } = sliceCursorResult<AuditLog>((raw ?? []) as unknown as AuditLog[], cursor)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Auditoria</h1>
        <p className="mt-0.5 text-sm text-gray-500">{logs.length} ações nesta página</p>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead className="font-semibold">Ação</TableHead>
                <TableHead className="font-semibold">Entidade</TableHead>
                <TableHead className="font-semibold">ID</TableHead>
                <TableHead className="font-semibold">Usuário</TableHead>
                <TableHead className="font-semibold">Papel</TableHead>
                <TableHead className="font-semibold">Data/Hora</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-gray-400">
                    Nenhum log de auditoria
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => (
                  <TableRow key={log.id} className="hover:bg-gray-50">
                    <TableCell>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          ACTION_COLORS[log.action] ?? 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {log.action}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-gray-700">{log.entity_type}</TableCell>
                    <TableCell>
                      <span className="block max-w-[120px] truncate font-mono text-xs text-gray-500">
                        {log.entity_id}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-gray-700">
                      {log.profiles?.full_name ?? '—'}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-gray-500">{log.actor_role ?? '—'}</span>
                    </TableCell>
                    <TableCell className="text-xs text-gray-500">
                      {formatDateTime(log.created_at)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <CursorPagination
        nextCursor={nextCursor}
        prevCursor={isFirstPage ? null : prevCursor}
        pageSize={PAGE_SIZE}
        resultCount={logs.length}
      />
    </div>
  )
}
