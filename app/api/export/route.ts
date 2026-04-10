/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { getCurrentUser } from '@/lib/auth/session'
import { toCSV, toXLSX } from '@/lib/export'
import { formatCurrency } from '@/lib/utils'

const ADMIN_ROLES = ['SUPER_ADMIN', 'PLATFORM_ADMIN']

/**
 * GET /api/export?type=orders|payments|commissions|transfers&format=csv|xlsx&from=YYYY-MM-DD&to=YYYY-MM-DD
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user || !user.roles.some((r) => ADMIN_ROLES.includes(r))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = req.nextUrl
  const type = searchParams.get('type') ?? 'orders'
  const format = searchParams.get('format') ?? 'csv'
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')
  const admin = createAdminClient()

  const now = new Date().toISOString().slice(0, 10)
  const rangeFrom = fromParam ? `${fromParam}T00:00:00` : null
  const rangeTo = toParam ? `${toParam}T23:59:59` : null
  const periodSuffix = fromParam && toParam ? `_${fromParam}_a_${toParam}` : ''

  function dateFilter(q: any) {
    if (rangeFrom) q = q.gte('created_at', rangeFrom)
    if (rangeTo) q = q.lte('created_at', rangeTo)
    return q
  }

  if (type === 'orders') {
    const { data } = await dateFilter(
      admin
        .from('orders')
        .select(
          `code, order_status, payment_status, transfer_status, total_price, created_at,
           clinics(trade_name), doctors(full_name), pharmacies(trade_name),
           order_items(quantity, unit_price, total_price, products(name))`
        )
        .order('created_at', { ascending: false })
    )

    const rows = (data ?? []).map((o: any) => {
      const items: Array<{
        quantity: number
        unit_price: number
        total_price: number
        products: { name: string } | null
      }> = o.order_items ?? []
      const productNames = items.map((i) => `${i.products?.name ?? '—'} ×${i.quantity}`).join(' | ')
      return {
        Código: o.code,
        Clínica: (o.clinics as { trade_name?: string } | null)?.trade_name ?? '—',
        Médico: (o.doctors as { full_name?: string } | null)?.full_name ?? '—',
        Farmácia: (o.pharmacies as { trade_name?: string } | null)?.trade_name ?? '—',
        Produtos: productNames,
        Total: formatCurrency(Number(o.total_price)),
        'Status do pedido': o.order_status,
        'Status pagamento': o.payment_status,
        'Status repasse': o.transfer_status,
        'Data criação': o.created_at?.slice(0, 16).replace('T', ' '),
      }
    })

    return buildResponse(rows, format, `pedidos${periodSuffix || '-' + now}`)
  }

  if (type === 'payments') {
    const { data } = await dateFilter(
      admin
        .from('payments')
        .select(
          `gross_amount, status, payment_method, reference_code, confirmed_at, created_at,
           orders(code, clinics(trade_name))`
        )
        .order('created_at', { ascending: false })
    )

    const rows = (data ?? []).map((p: any) => {
      const order = p.orders as { code?: string; clinics?: { trade_name?: string } } | null
      return {
        Pedido: order?.code ?? '—',
        Clínica: order?.clinics?.trade_name ?? '—',
        Valor: formatCurrency(Number(p.gross_amount)),
        Status: p.status,
        Método: p.payment_method ?? '—',
        Referência: p.reference_code ?? '—',
        'Data confirmação': p.confirmed_at?.slice(0, 16).replace('T', ' ') ?? '—',
        'Data criação': p.created_at?.slice(0, 16).replace('T', ' '),
      }
    })

    return buildResponse(rows, format, `pagamentos${periodSuffix || '-' + now}`)
  }

  if (type === 'commissions') {
    const { data } = await dateFilter(
      admin
        .from('consultant_commissions')
        .select(
          `commission_amount, commission_rate, order_total, status, created_at,
           orders(code), sales_consultants(full_name)`
        )
        .order('created_at', { ascending: false })
    )

    const rows = (data ?? []).map((c: any) => ({
      Consultor: (c.sales_consultants as { full_name?: string } | null)?.full_name ?? '—',
      Pedido: (c.orders as { code?: string } | null)?.code ?? '—',
      'Total do pedido': formatCurrency(Number(c.order_total)),
      'Taxa (%)': Number(c.commission_rate).toFixed(2),
      Comissão: formatCurrency(Number(c.commission_amount)),
      Status: c.status,
      Data: c.created_at?.slice(0, 16).replace('T', ' '),
    }))

    return buildResponse(rows, format, `comissoes${periodSuffix || '-' + now}`)
  }

  if (type === 'transfers') {
    const { data } = await dateFilter(
      admin
        .from('transfers')
        .select(
          `gross_amount, commission_amount, net_amount, status,
           transfer_reference, processed_at, created_at,
           pharmacies(trade_name), orders(code)`
        )
        .order('created_at', { ascending: false })
    )

    const rows = (data ?? []).map((t: any) => ({
      Pedido: (t.orders as { code?: string } | null)?.code ?? '—',
      Farmácia: (t.pharmacies as { trade_name?: string } | null)?.trade_name ?? '—',
      Bruto: formatCurrency(Number(t.gross_amount)),
      'Comissão plataforma': formatCurrency(Number(t.commission_amount)),
      Líquido: formatCurrency(Number(t.net_amount)),
      Status: t.status,
      Referência: t.transfer_reference ?? '—',
      'Data repasse': t.processed_at?.slice(0, 16).replace('T', ' ') ?? '—',
      Criado: t.created_at?.slice(0, 16).replace('T', ' '),
    }))

    return buildResponse(rows, format, `repasses${periodSuffix || '-' + now}`)
  }

  return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
}

function buildResponse(rows: Record<string, unknown>[], format: string, filename: string) {
  if (format === 'xlsx') {
    const uint8 = toXLSX([{ name: filename, rows }])
    return new NextResponse(uint8.buffer as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}.xlsx"`,
      },
    })
  }

  const csv = toCSV(rows)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}.csv"`,
    },
  })
}
