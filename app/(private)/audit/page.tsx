import { Metadata } from 'next'
import { createClient } from '@/lib/db/server'
import { requireRolePage } from '@/lib/rbac'
import { formatDateTime } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const metadata: Metadata = { title: 'Auditoria' }

export default async function AuditPage() {
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  const supabase = await createClient()

  const { data: logs } = await supabase
    .from('audit_logs')
    .select(
      `
      id, entity_type, entity_id, action, actor_role, created_at,
      profiles!actor_user_id (full_name)
    `
    )
    .order('created_at', { ascending: false })
    .limit(200)

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

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Auditoria</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Últimas {logs?.length ?? 0} ações registradas
        </p>
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
              {(logs?.length ?? 0) === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-gray-400">
                    Nenhum log de auditoria
                  </TableCell>
                </TableRow>
              ) : (
                logs?.map((log) => {
                  const actor = log.profiles as unknown as { full_name: string } | null
                  return (
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
                        {actor?.full_name ?? '—'}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-gray-500">{log.actor_role ?? '—'}</span>
                      </TableCell>
                      <TableCell className="text-xs text-gray-500">
                        {formatDateTime(log.created_at)}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
