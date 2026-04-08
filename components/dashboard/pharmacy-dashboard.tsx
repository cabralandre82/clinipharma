import { createClient } from '@/lib/db/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Package, Truck } from 'lucide-react'
import type { ProfileWithRoles } from '@/types'
import Link from 'next/link'
import { formatCurrency, formatDate } from '@/lib/utils'

export async function PharmacyDashboard({ user }: { user: ProfileWithRoles }) {
  const supabase = await createClient()

  const { data: orders } = await supabase
    .from('orders')
    .select('id, code, order_status, total_price, created_at')
    .in('order_status', [
      'RELEASED_FOR_EXECUTION',
      'RECEIVED_BY_PHARMACY',
      'IN_EXECUTION',
      'READY',
      'SHIPPED',
    ])
    .order('created_at', { ascending: false })
    .limit(10)

  const released = orders?.filter((o) => o.order_status === 'RELEASED_FOR_EXECUTION') ?? []
  const inExecution =
    orders?.filter((o) => ['IN_EXECUTION', 'RECEIVED_BY_PHARMACY'].includes(o.order_status)) ?? []
  const shipped = orders?.filter((o) => o.order_status === 'SHIPPED') ?? []

  const { data: transfers } = await supabase
    .from('transfers')
    .select('id, status, net_amount, created_at')
    .order('created_at', { ascending: false })
    .limit(5)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Olá, {user.full_name.split(' ')[0]}</h1>
        <p className="mt-0.5 text-sm text-gray-500">Painel operacional da farmácia</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-50 p-2.5">
                <Package className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs tracking-wide text-gray-500 uppercase">Para executar</p>
                <p className="text-2xl font-bold text-gray-900">{released.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-amber-50 p-2.5">
                <Package className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-xs tracking-wide text-gray-500 uppercase">Em execução</p>
                <p className="text-2xl font-bold text-gray-900">{inExecution.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-green-50 p-2.5">
                <Truck className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-xs tracking-wide text-gray-500 uppercase">Enviados</p>
                <p className="text-2xl font-bold text-gray-900">{shipped.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold">Pedidos ativos</CardTitle>
            <Link href="/orders" className="text-sm text-[hsl(196,91%,36%)] hover:underline">
              Ver todos
            </Link>
          </CardHeader>
          <CardContent>
            {(orders?.length ?? 0) === 0 ? (
              <p className="py-4 text-center text-sm text-gray-500">Sem pedidos no momento</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {orders?.map((order) => (
                  <div key={order.id} className="flex items-center justify-between py-2.5">
                    <div>
                      <Link
                        href={`/orders/${order.id}`}
                        className="text-sm font-medium text-gray-900 hover:text-[hsl(196,91%,36%)]"
                      >
                        {order.code}
                      </Link>
                      <p className="text-xs text-gray-500">{formatCurrency(order.total_price)}</p>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {order.order_status.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold">Repasses recentes</CardTitle>
            <Link href="/transfers" className="text-sm text-[hsl(196,91%,36%)] hover:underline">
              Ver todos
            </Link>
          </CardHeader>
          <CardContent>
            {(transfers?.length ?? 0) === 0 ? (
              <p className="py-4 text-center text-sm text-gray-500">Sem repasses ainda</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {transfers?.map((t) => (
                  <div key={t.id} className="flex items-center justify-between py-2.5">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {formatCurrency(t.net_amount)}
                      </p>
                      <p className="text-xs text-gray-500">{formatDate(t.created_at)}</p>
                    </div>
                    <Badge
                      variant={t.status === 'COMPLETED' ? 'default' : 'secondary'}
                      className="text-xs"
                    >
                      {t.status === 'COMPLETED' ? 'Concluído' : 'Pendente'}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
