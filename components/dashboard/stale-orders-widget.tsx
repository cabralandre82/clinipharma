import Link from 'next/link'
import { AlertTriangle, Clock } from 'lucide-react'
import { createAdminClient } from '@/lib/db/admin'
import { getDaysDiff, getStaleThreshold, type StaleOrder } from '@/lib/stale-orders'

export async function StaleOrdersWidget() {
  const admin = createAdminClient()

  const { data: orders } = await admin
    .from('orders')
    .select(
      `id, code, order_status, updated_at,
       clinics(trade_name), pharmacies(trade_name)`
    )
    .not('order_status', 'in', '("COMPLETED","CANCELED","DRAFT")')

  const stale: StaleOrder[] = []

  for (const o of orders ?? []) {
    const threshold = getStaleThreshold(o.order_status)
    if (!threshold) continue
    const days = getDaysDiff(o.updated_at)
    if (days >= threshold) {
      stale.push({
        id: o.id,
        code: o.code,
        order_status: o.order_status,
        updated_at: o.updated_at,
        daysStale: days,
        threshold,
        clinic: (o.clinics as { trade_name?: string } | null)?.trade_name ?? '—',
        pharmacy: (o.pharmacies as { trade_name?: string } | null)?.trade_name ?? '—',
      })
    }
  }

  if (stale.length === 0) return null

  stale.sort((a, b) => b.daysStale - a.daysStale)

  const STATUS_LABELS: Record<string, string> = {
    AWAITING_DOCUMENTS: 'Aguard. Docs',
    READY_FOR_REVIEW: 'Em revisão',
    AWAITING_PAYMENT: 'Aguard. Pagto',
    PAYMENT_UNDER_REVIEW: 'Pagto em análise',
    COMMISSION_CALCULATED: 'Comissão calc.',
    TRANSFER_PENDING: 'Repasse pendente',
    RELEASED_FOR_EXECUTION: 'Liberado p/ farmácia',
    RECEIVED_BY_PHARMACY: 'Recebido farmácia',
    IN_EXECUTION: 'Em execução',
    READY: 'Pronto p/ envio',
    SHIPPED: 'Enviado',
  }

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-5">
      <div className="mb-4 flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 text-red-500" />
        <h2 className="font-semibold text-red-900">
          {stale.length} pedido{stale.length > 1 ? 's' : ''} parado{stale.length > 1 ? 's' : ''}
        </h2>
        <span className="ml-auto text-xs text-red-500">
          sem movimentação há {stale[0].threshold}+ dias
        </span>
      </div>

      <div className="space-y-2">
        {stale.slice(0, 8).map((o) => (
          <Link
            key={o.id}
            href={`/orders/${o.id}`}
            className="flex items-center justify-between rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm transition-colors hover:bg-red-50"
          >
            <div className="flex min-w-0 items-center gap-3">
              <code className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 font-mono text-xs text-red-700">
                {o.code}
              </code>
              <span className="truncate text-gray-600">{o.clinic}</span>
              <span className="hidden text-xs text-gray-400 sm:block">
                {STATUS_LABELS[o.order_status] ?? o.order_status}
              </span>
            </div>
            <div className="ml-2 flex shrink-0 items-center gap-1.5 text-red-600">
              <Clock className="h-3.5 w-3.5" />
              <span className="text-xs font-semibold">{o.daysStale}d</span>
            </div>
          </Link>
        ))}
        {stale.length > 8 && (
          <p className="pt-1 text-center text-xs text-red-500">
            + {stale.length - 8} pedido(s) parado(s)
          </p>
        )}
      </div>
    </div>
  )
}
