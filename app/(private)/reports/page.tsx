import { Metadata } from 'next'
import { Suspense } from 'react'
import { createAdminClient } from '@/lib/db/admin'
import { requireRolePage } from '@/lib/rbac'
import { formatCurrency } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ExportButton } from '@/components/shared/export-button'
import { DateRangePicker } from '@/components/shared/date-range-picker'
import {
  OrdersBarChart,
  RevenueBarChart,
  StatusPieChart,
  PharmacyRevenueChart,
  ConsultantCommChart,
  type MonthlyData,
  type StatusData,
  type PharmacyRevenueData,
  type ConsultantCommData,
} from '@/components/reports/reports-charts'
import {
  TrendingUp,
  ShoppingBag,
  CreditCard,
  ArrowLeftRight,
  Building2,
  Package,
  Clock,
  AlertCircle,
} from 'lucide-react'

export const metadata: Metadata = { title: 'Relatórios | Clinipharma' }

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  AWAITING_DOCUMENTS: 'Aguard. Docs',
  READY_FOR_REVIEW: 'Em revisão',
  AWAITING_PAYMENT: 'Aguard. Pagto',
  PAYMENT_UNDER_REVIEW: 'Pagto em análise',
  PAYMENT_CONFIRMED: 'Pagto confirmado',
  COMMISSION_CALCULATED: 'Comissão calc.',
  TRANSFER_PENDING: 'Repasse pendente',
  TRANSFER_COMPLETED: 'Repasse concluído',
  RELEASED_FOR_EXECUTION: 'Liberado p/ farmácia',
  RECEIVED_BY_PHARMACY: 'Recebido farmácia',
  IN_EXECUTION: 'Em execução',
  READY: 'Pronto',
  SHIPPED: 'Enviado',
  DELIVERED: 'Entregue',
  COMPLETED: 'Concluído',
  CANCELED: 'Cancelado',
  WITH_ISSUE: 'Com problema',
}

interface PageProps {
  searchParams: Promise<{
    from?: string
    to?: string
    preset?: string
  }>
}

function defaultRange() {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)
  return { from, to }
}

export default async function ReportsPage({ searchParams }: PageProps) {
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])

  const params = await searchParams
  const range = params.from && params.to ? { from: params.from, to: params.to } : defaultRange()
  const rangeFrom = `${range.from}T00:00:00`
  const rangeTo = `${range.to}T23:59:59`

  const admin = createAdminClient()

  const [
    ordersRes,
    paymentsRes,
    transfersRes,
    clinicsRes,
    productsRes,
    consultantsRes,
    commissionRes,
  ] = await Promise.all([
    admin
      .from('orders')
      .select(
        `id, order_status, total_price, created_at,
         pharmacies(trade_name),
         payments(gross_amount, status)`
      )
      .gte('created_at', rangeFrom)
      .lte('created_at', rangeTo)
      .order('created_at'),
    admin
      .from('payments')
      .select('id, status, gross_amount')
      .gte('created_at', rangeFrom)
      .lte('created_at', rangeTo),
    admin
      .from('transfers')
      .select('id, status, net_amount, commission_amount')
      .gte('created_at', rangeFrom)
      .lte('created_at', rangeTo),
    admin.from('clinics').select('id, status'),
    admin.from('products').select('id, active'),
    admin.from('sales_consultants').select('id, status'),
    admin
      .from('consultant_commissions')
      .select('id, status, commission_amount, sales_consultants(full_name)')
      .gte('created_at', rangeFrom)
      .lte('created_at', rangeTo),
  ])

  const orders = ordersRes.data ?? []
  const payments = paymentsRes.data ?? []
  const transfers = transfersRes.data ?? []

  // ── KPIs ──────────────────────────────────────────────
  const totalOrders = orders.length
  const completedOrders = orders.filter((o) => o.order_status === 'COMPLETED').length
  const canceledOrders = orders.filter((o) => o.order_status === 'CANCELED').length
  const openOrders = orders.filter(
    (o) => !['COMPLETED', 'CANCELED'].includes(o.order_status)
  ).length

  const confirmedPayments = payments.filter((p) => p.status === 'CONFIRMED')
  const pendingPayments = payments.filter((p) => p.status === 'PENDING').length
  const totalRevenue = confirmedPayments.reduce((s, p) => s + Number(p.gross_amount), 0)
  const avgTicket = confirmedPayments.length ? totalRevenue / confirmedPayments.length : 0

  const completedTransfers = transfers.filter((t) => t.status === 'COMPLETED')
  const pendingTransfers = transfers.filter((t) => t.status === 'PENDING').length
  const totalTransferred = completedTransfers.reduce((s, t) => s + Number(t.net_amount), 0)
  const totalCommission = completedTransfers.reduce((s, t) => s + Number(t.commission_amount), 0)

  const pendingConsultantComm = (commissionRes.data ?? [])
    .filter((c) => c.status === 'PENDING')
    .reduce((s, c) => s + Number(c.commission_amount), 0)

  // ── Monthly data for charts ───────────────────────────
  // Build month buckets between from and to (up to 12)
  const fromDate = new Date(range.from + 'T12:00:00')
  const toDate = new Date(range.to + 'T12:00:00')
  const monthBuckets: Map<string, MonthlyData> = new Map()

  const cursor = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1)
  while (cursor <= toDate) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
    const label = cursor.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
    monthBuckets.set(key, { month: label, pedidos: 0, receita: 0 })
    cursor.setMonth(cursor.getMonth() + 1)
  }

  for (const o of orders) {
    const key = o.created_at?.slice(0, 7)
    if (key && monthBuckets.has(key)) {
      const b = monthBuckets.get(key)!
      b.pedidos++
      b.receita += Number(o.total_price)
    }
  }
  const monthlyData = Array.from(monthBuckets.values())

  // ── Status donut data ─────────────────────────────────
  const statusMap: Record<string, number> = {}
  for (const o of orders) {
    statusMap[o.order_status] = (statusMap[o.order_status] ?? 0) + 1
  }
  const statusData: StatusData[] = Object.entries(statusMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([s, v]) => ({ name: STATUS_LABELS[s] ?? s, value: v }))

  // ── Pharmacy revenue ──────────────────────────────────
  const pharmacyRevMap: Record<string, number> = {}
  for (const o of orders) {
    const pharma = (o.pharmacies as { trade_name?: string } | null)?.trade_name
    if (pharma) {
      pharmacyRevMap[pharma] = (pharmacyRevMap[pharma] ?? 0) + Number(o.total_price)
    }
  }
  const pharmacyData: PharmacyRevenueData[] = Object.entries(pharmacyRevMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, receita]) => ({
      name: name.length > 18 ? name.slice(0, 16) + '…' : name,
      receita,
    }))

  // ── Consultant commissions ────────────────────────────
  const consultantCommMap: Record<string, number> = {}
  for (const c of commissionRes.data ?? []) {
    const name =
      (c.sales_consultants as { full_name?: string } | null)?.full_name ?? 'Sem consultor'
    consultantCommMap[name] = (consultantCommMap[name] ?? 0) + Number(c.commission_amount)
  }
  const consultantData: ConsultantCommData[] = Object.entries(consultantCommMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, comissao]) => ({
      name: name.length > 18 ? name.slice(0, 16) + '…' : name,
      comissao,
    }))

  const fmtDate = (s: string) =>
    new Date(s + 'T12:00:00').toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })

  const exportParams = `&from=${range.from}&to=${range.to}`

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Relatórios</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {fmtDate(range.from)} até {fmtDate(range.to)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Suspense>
            <DateRangePicker />
          </Suspense>
          <ExportButton type="orders" label="Pedidos" extraParams={exportParams} />
          <ExportButton type="payments" label="Pagamentos" extraParams={exportParams} />
        </div>
      </div>

      {/* Pendências urgentes */}
      {(pendingPayments > 0 || pendingTransfers > 0 || pendingConsultantComm > 0) && (
        <div className="flex flex-wrap gap-3">
          {pendingPayments > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-2.5">
              <AlertCircle className="h-4 w-4 text-yellow-600" />
              <span className="text-sm font-medium text-yellow-800">
                {pendingPayments} pagamento(s) pendente(s)
              </span>
            </div>
          )}
          {pendingTransfers > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-4 py-2.5">
              <AlertCircle className="h-4 w-4 text-orange-600" />
              <span className="text-sm font-medium text-orange-800">
                {pendingTransfers} repasse(s) pendente(s)
              </span>
            </div>
          )}
          {pendingConsultantComm > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-4 py-2.5">
              <AlertCircle className="h-4 w-4 text-purple-600" />
              <span className="text-sm font-medium text-purple-800">
                {formatCurrency(pendingConsultantComm)} em comissões de consultores
              </span>
            </div>
          )}
        </div>
      )}

      {/* KPIs — Pedidos */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          icon={<ShoppingBag className="h-5 w-5 text-blue-600" />}
          label="Total de pedidos"
          value={totalOrders.toString()}
          bg="blue"
        />
        <KpiCard
          icon={<TrendingUp className="h-5 w-5 text-green-600" />}
          label="Pedidos concluídos"
          value={completedOrders.toString()}
          bg="green"
        />
        <KpiCard
          icon={<Clock className="h-5 w-5 text-amber-600" />}
          label="Pedidos em aberto"
          value={openOrders.toString()}
          bg="amber"
        />
        <KpiCard
          icon={<AlertCircle className="h-5 w-5 text-red-500" />}
          label="Pedidos cancelados"
          value={canceledOrders.toString()}
          bg="red"
        />
      </div>

      {/* KPIs — Financeiro */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          icon={<CreditCard className="h-5 w-5 text-green-600" />}
          label="Receita confirmada"
          value={formatCurrency(totalRevenue)}
          bg="green"
          large
        />
        <KpiCard
          icon={<ArrowLeftRight className="h-5 w-5 text-blue-600" />}
          label="Total repassado"
          value={formatCurrency(totalTransferred)}
          bg="blue"
          large
        />
        <KpiCard
          icon={<TrendingUp className="h-5 w-5 text-indigo-600" />}
          label="Comissão plataforma"
          value={formatCurrency(totalCommission)}
          bg="indigo"
          large
        />
        <KpiCard
          icon={<ShoppingBag className="h-5 w-5 text-teal-600" />}
          label="Ticket médio"
          value={formatCurrency(avgTicket)}
          bg="teal"
          large
        />
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pedidos por período</CardTitle>
          </CardHeader>
          <CardContent>
            {monthlyData.every((m) => m.pedidos === 0) ? (
              <EmptyChart />
            ) : (
              <OrdersBarChart data={monthlyData} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Faturamento por período (R$)</CardTitle>
          </CardHeader>
          <CardContent>
            {monthlyData.every((m) => m.receita === 0) ? (
              <EmptyChart />
            ) : (
              <RevenueBarChart data={monthlyData} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pedidos por status</CardTitle>
          </CardHeader>
          <CardContent>
            {statusData.length === 0 ? <EmptyChart /> : <StatusPieChart data={statusData} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Faturamento por farmácia</CardTitle>
          </CardHeader>
          <CardContent>
            {pharmacyData.length === 0 ? (
              <EmptyChart />
            ) : (
              <PharmacyRevenueChart data={pharmacyData} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Consultant commissions chart */}
      {consultantData.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Comissões por consultor</CardTitle>
          </CardHeader>
          <CardContent>
            <ConsultantCommChart data={consultantData} />
          </CardContent>
        </Card>
      )}

      {/* Entidades (always totals, not period-filtered) */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <EntityCard
          icon={<Building2 className="h-5 w-5 text-blue-600" />}
          bg="blue-50"
          label="Clínicas ativas"
          value={(clinicsRes.data ?? []).filter((c) => c.status === 'ACTIVE').length}
        />
        <EntityCard
          icon={<Package className="h-5 w-5 text-teal-600" />}
          bg="teal-50"
          label="Produtos ativos"
          value={(productsRes.data ?? []).filter((p) => p.active).length}
        />
        <EntityCard
          icon={<CreditCard className="h-5 w-5 text-green-600" />}
          bg="green-50"
          label="Pgtos confirmados"
          value={confirmedPayments.length}
        />
        <EntityCard
          icon={<TrendingUp className="h-5 w-5 text-purple-600" />}
          bg="purple-50"
          label="Consultores ativos"
          value={(consultantsRes.data ?? []).filter((c) => c.status === 'ACTIVE').length}
        />
      </div>
    </div>
  )
}

function EmptyChart() {
  return (
    <div className="flex h-[200px] items-center justify-center text-sm text-gray-400">
      Sem dados no período selecionado
    </div>
  )
}

function KpiCard({
  icon,
  label,
  value,
  bg,
  large = false,
}: {
  icon: React.ReactNode
  label: string
  value: string
  bg: string
  large?: boolean
}) {
  const bgMap: Record<string, string> = {
    blue: 'bg-blue-50',
    green: 'bg-green-50',
    amber: 'bg-amber-50',
    red: 'bg-red-50',
    indigo: 'bg-indigo-50',
    teal: 'bg-teal-50',
  }
  return (
    <Card>
      <CardContent className="p-5">
        <div
          className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${bgMap[bg] ?? 'bg-gray-50'}`}
        >
          {icon}
        </div>
        <p className="text-xs tracking-wide text-gray-500 uppercase">{label}</p>
        <p className={`mt-1 font-bold text-gray-900 ${large ? 'text-xl' : 'text-2xl'}`}>{value}</p>
      </CardContent>
    </Card>
  )
}

function EntityCard({
  icon,
  bg,
  label,
  value,
}: {
  icon: React.ReactNode
  bg: string
  label: string
  value: number
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg bg-${bg}`}>
            {icon}
          </div>
          <div>
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-2xl font-bold text-gray-900">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
