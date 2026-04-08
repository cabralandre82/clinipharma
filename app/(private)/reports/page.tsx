import { Metadata } from 'next'
import { createClient } from '@/lib/db/server'
import { requireRolePage } from '@/lib/rbac'
import { formatCurrency } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata: Metadata = { title: 'Relatórios' }

export default async function ReportsPage() {
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  const supabase = await createClient()

  const [ordersRes, paymentsRes, transfersRes, clinicsRes, productsRes] = await Promise.all([
    supabase.from('orders').select('id, order_status, total_price, created_at').limit(1000),
    supabase.from('payments').select('id, status, gross_amount').limit(1000),
    supabase.from('transfers').select('id, status, net_amount, commission_amount').limit(1000),
    supabase.from('clinics').select('id, status').limit(500),
    supabase.from('products').select('id, active').limit(500),
  ])

  const totalOrders = ordersRes.data?.length ?? 0
  const completedOrders = ordersRes.data?.filter((o) => o.order_status === 'COMPLETED').length ?? 0
  const canceledOrders = ordersRes.data?.filter((o) => o.order_status === 'CANCELED').length ?? 0
  const openOrders =
    ordersRes.data?.filter((o) => !['COMPLETED', 'CANCELED'].includes(o.order_status)).length ?? 0

  const confirmedPayments = paymentsRes.data?.filter((p) => p.status === 'CONFIRMED') ?? []
  const totalRevenue = confirmedPayments.reduce((s, p) => s + p.gross_amount, 0)

  const completedTransfers = transfersRes.data?.filter((t) => t.status === 'COMPLETED') ?? []
  const totalTransferred = completedTransfers.reduce((s, t) => s + t.net_amount, 0)
  const totalCommission = completedTransfers.reduce((s, t) => s + t.commission_amount, 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Relatórios</h1>
        <p className="mt-0.5 text-sm text-gray-500">Visão geral da operação</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total de pedidos" value={totalOrders.toString()} />
        <StatCard label="Pedidos concluídos" value={completedOrders.toString()} color="green" />
        <StatCard label="Pedidos em aberto" value={openOrders.toString()} color="blue" />
        <StatCard label="Pedidos cancelados" value={canceledOrders.toString()} color="red" />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard
          label="Receita total confirmada"
          value={formatCurrency(totalRevenue)}
          color="green"
          large
        />
        <StatCard
          label="Total repassado"
          value={formatCurrency(totalTransferred)}
          color="blue"
          large
        />
        <StatCard
          label="Total de comissões"
          value={formatCurrency(totalCommission)}
          color="indigo"
          large
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pedidos por status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(
                (ordersRes.data ?? []).reduce<Record<string, number>>((acc, o) => {
                  acc[o.order_status] = (acc[o.order_status] ?? 0) + 1
                  return acc
                }, {})
              )
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8)
                .map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">{status.replace(/_/g, ' ')}</span>
                    <span className="font-semibold text-gray-900">{count}</span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Resumo financeiro</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Pagamentos confirmados</span>
                <span className="font-semibold">{confirmedPayments.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Repasses realizados</span>
                <span className="font-semibold">{completedTransfers.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Clínicas ativas</span>
                <span className="font-semibold">
                  {clinicsRes.data?.filter((c) => c.status === 'ACTIVE').length ?? 0}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Produtos ativos</span>
                <span className="font-semibold">
                  {productsRes.data?.filter((p) => p.active).length ?? 0}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  color = 'gray',
  large = false,
}: {
  label: string
  value: string
  color?: string
  large?: boolean
}) {
  const colors: Record<string, string> = {
    gray: 'text-gray-900',
    green: 'text-green-700',
    blue: 'text-blue-700',
    red: 'text-red-700',
    indigo: 'text-indigo-700',
  }
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs tracking-wide text-gray-500 uppercase">{label}</p>
        <p
          className={`mt-1 font-bold ${large ? 'text-2xl' : 'text-xl'} ${colors[color] ?? colors.gray}`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  )
}
