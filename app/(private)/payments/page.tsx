import { Metadata } from 'next'
import { createAdminClient } from '@/lib/db/admin'
import { requireRolePage } from '@/lib/rbac'
import { formatCurrency, formatDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'
import { parseCursorParams, sliceCursorResult } from '@/lib/cursor-pagination'
import { CursorPagination } from '@/components/ui/cursor-pagination'
import { PaymentConfirmDialog } from '@/components/shared/payment-confirm-dialog'
import { ExportButton } from '@/components/shared/export-button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const metadata: Metadata = { title: 'Pagamentos | Clinipharma' }

const PAGE_SIZE = 20

interface Props {
  searchParams: Promise<{ after?: string; before?: string }>
}

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  UNDER_REVIEW: 'bg-blue-100 text-blue-800',
  CONFIRMED: 'bg-green-100 text-green-800',
  FAILED: 'bg-red-100 text-red-800',
  REFUNDED: 'bg-gray-100 text-gray-700',
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendente',
  UNDER_REVIEW: 'Em análise',
  CONFIRMED: 'Confirmado',
  FAILED: 'Falhou',
  REFUNDED: 'Estornado',
}

export default async function PaymentsPage({ searchParams }: Props) {
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  const { after, before } = await searchParams
  const supabase = createAdminClient()

  const cursor = parseCursorParams({ after, before, pageSize: PAGE_SIZE })

  let q = supabase
    .from('payments')
    .select(
      `id, gross_amount, status, payment_method, reference_code,
       confirmed_at, notes, created_at,
       orders (code, clinics (trade_name), doctors (full_name))`
    )
    .order('created_at', { ascending: cursor.ascending })

  if (cursor.after) q = q.lt('created_at', cursor.after)
  if (cursor.before) q = q.gt('created_at', cursor.before)

  const { data: raw } = await q.limit(cursor.fetchSize)

  type PaymentRow = {
    id: string
    gross_amount: number
    status: string
    payment_method: string | null
    reference_code: string | null
    confirmed_at: string | null
    notes: string | null
    created_at: string
    orders: {
      code: string
      clinics: { trade_name: string } | null
      doctors: { full_name: string } | null
    } | null
  }

  const {
    rows: payments,
    nextCursor,
    prevCursor,
    isFirstPage,
  } = sliceCursorResult<PaymentRow>((raw ?? []) as unknown as PaymentRow[], cursor)

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pagamentos</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {payments.length} pagamento{payments.length !== 1 ? 's' : ''} nesta página
          </p>
        </div>
        <ExportButton type="payments" />
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead className="font-semibold">Pedido</TableHead>
                <TableHead className="font-semibold">Clínica</TableHead>
                <TableHead className="text-right font-semibold">Valor</TableHead>
                <TableHead className="font-semibold">Método</TableHead>
                <TableHead className="font-semibold">Status</TableHead>
                <TableHead className="font-semibold">Data</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-gray-400">
                    Nenhum pagamento encontrado
                  </TableCell>
                </TableRow>
              ) : (
                payments.map((p) => (
                  <TableRow key={p.id} className="hover:bg-gray-50">
                    <TableCell>
                      <span className="font-mono text-xs font-medium text-[hsl(213,75%,24%)]">
                        {p.orders?.code ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-gray-700">
                        {p.orders?.clinics?.trade_name ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-sm font-semibold">
                        {formatCurrency(Number(p.gross_amount))}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-gray-600">{p.payment_method}</span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          STATUS_STYLES[p.status] ?? 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {STATUS_LABELS[p.status] ?? p.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-gray-500">
                      {formatDate(p.created_at)}
                    </TableCell>
                    <TableCell>
                      {p.status === 'PENDING' && (
                        <PaymentConfirmDialog
                          paymentId={p.id}
                          amount={p.gross_amount}
                          orderCode={p.orders?.code ?? ''}
                        />
                      )}
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
        resultCount={payments.length}
      />
    </div>
  )
}
