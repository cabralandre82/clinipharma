import { Metadata } from 'next'
import { createAdminClient } from '@/lib/db/admin'
import { getCurrentUser } from '@/lib/auth/session'
import { formatCurrency, formatDate } from '@/lib/utils'
import { parseCursorParams, sliceCursorResult } from '@/lib/cursor-pagination'
import { CursorPagination } from '@/components/ui/cursor-pagination'
import { TransferCompleteDialog } from '@/components/shared/transfer-complete-dialog'
import { ExportButton } from '@/components/shared/export-button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const metadata: Metadata = { title: 'Repasses | Clinipharma' }

const PAGE_SIZE = 20

interface Props {
  searchParams: Promise<{ after?: string; before?: string }>
}

type TransferRow = {
  id: string
  gross_amount: number
  commission_amount: number
  net_amount: number
  status: string
  transfer_reference: string | null
  processed_at: string | null
  created_at: string
  orders: { code: string } | null
  pharmacies: { trade_name: string } | null
}

export default async function TransfersPage({ searchParams }: Props) {
  const { after, before } = await searchParams
  const user = await getCurrentUser()
  const admin = createAdminClient()
  const isAdmin = user?.roles.some((r) => ['SUPER_ADMIN', 'PLATFORM_ADMIN'].includes(r))
  const isPharmacy = user?.roles.includes('PHARMACY_ADMIN')

  // Resolve pharmacy scope for PHARMACY_ADMIN
  let pharmacyId: string | null = null
  if (isPharmacy && user) {
    const { data: membership } = await admin
      .from('pharmacy_members')
      .select('pharmacy_id')
      .eq('user_id', user.id)
      .limit(1)
      .single()
    pharmacyId = membership?.pharmacy_id ?? null
  }

  const cursor = parseCursorParams({ after, before, pageSize: PAGE_SIZE })

  let q = admin
    .from('transfers')
    .select(
      `id, gross_amount, commission_amount, net_amount, status,
       transfer_reference, processed_at, created_at,
       pharmacies (trade_name), orders (code)`
    )
    .order('created_at', { ascending: cursor.ascending })

  // Scope: admins see all; pharmacy sees own; others see nothing
  if (!isAdmin && pharmacyId) q = q.eq('pharmacy_id', pharmacyId)
  else if (!isAdmin && !pharmacyId) q = q.eq('pharmacy_id', 'none')

  if (cursor.after) q = q.lt('created_at', cursor.after)
  if (cursor.before) q = q.gt('created_at', cursor.before)

  const { data: raw } = await q.limit(cursor.fetchSize)

  const {
    rows: transfers,
    nextCursor,
    prevCursor,
    isFirstPage,
  } = sliceCursorResult<TransferRow>((raw ?? []) as unknown as TransferRow[], cursor)

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Repasses</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {transfers.length} repasse{transfers.length !== 1 ? 's' : ''} nesta página
          </p>
        </div>
        <ExportButton type="transfers" />
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead className="font-semibold">Pedido</TableHead>
                <TableHead className="font-semibold">Farmácia</TableHead>
                <TableHead className="text-right font-semibold">Bruto</TableHead>
                <TableHead className="text-right font-semibold">Comissão</TableHead>
                <TableHead className="text-right font-semibold">Líquido</TableHead>
                <TableHead className="font-semibold">Status</TableHead>
                <TableHead className="font-semibold">Data</TableHead>
                {isAdmin && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {transfers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-gray-400">
                    Nenhum repasse encontrado
                  </TableCell>
                </TableRow>
              ) : (
                transfers.map((t) => (
                  <TableRow key={t.id} className="hover:bg-gray-50">
                    <TableCell>
                      <span className="font-mono text-xs font-medium text-[hsl(213,75%,24%)]">
                        {t.orders?.code ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-gray-700">
                        {t.pharmacies?.trade_name ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {formatCurrency(Number(t.gross_amount))}
                    </TableCell>
                    <TableCell className="text-right text-sm text-red-600">
                      - {formatCurrency(Number(t.commission_amount))}
                    </TableCell>
                    <TableCell className="text-right text-sm font-semibold text-green-700">
                      {formatCurrency(Number(t.net_amount))}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          t.status === 'COMPLETED'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}
                      >
                        {t.status === 'COMPLETED' ? 'Concluído' : 'Pendente'}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-gray-500">
                      {t.processed_at ? formatDate(t.processed_at) : formatDate(t.created_at)}
                    </TableCell>
                    {isAdmin && (
                      <TableCell>
                        {t.status === 'PENDING' && (
                          <TransferCompleteDialog
                            transferId={t.id}
                            amount={Number(t.net_amount)}
                            pharmacyName={t.pharmacies?.trade_name ?? ''}
                          />
                        )}
                      </TableCell>
                    )}
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
        resultCount={transfers.length}
      />
    </div>
  )
}
