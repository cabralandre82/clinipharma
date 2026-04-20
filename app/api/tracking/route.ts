/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Public order-tracking endpoint.
 *
 * @auth: public — token-as-credential (opaque random string from
 *        `order_tracking_tokens`). Rate-limited to frustrate
 *        brute-force enumeration of the token space.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { apiLimiter, guard } from '@/lib/rate-limit'

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  AWAITING_DOCUMENTS: 'Aguardando Documentos',
  AWAITING_PAYMENT: 'Aguardando Pagamento',
  PAYMENT_UNDER_REVIEW: 'Pagamento em Análise',
  PAYMENT_CONFIRMED: 'Pagamento Confirmado',
  READY_FOR_REVIEW: 'Em Revisão',
  COMMISSION_CALCULATED: 'Comissão Calculada',
  TRANSFER_PENDING: 'Repasse Pendente',
  TRANSFER_COMPLETED: 'Repasse Concluído',
  READY: 'Pedido Aprovado',
  RELEASED_FOR_EXECUTION: 'Liberado para Execução',
  RECEIVED_BY_PHARMACY: 'Recebido pela Farmácia',
  IN_EXECUTION: 'Em Manipulação',
  SHIPPED: 'Enviado',
  DELIVERED: 'Entregue',
  COMPLETED: 'Concluído',
  CANCELED: 'Cancelado',
  WITH_ISSUE: 'Com Problema',
}

const STATUS_ORDER = [
  'DRAFT',
  'AWAITING_DOCUMENTS',
  'AWAITING_PAYMENT',
  'PAYMENT_UNDER_REVIEW',
  'READY_FOR_REVIEW',
  'COMMISSION_CALCULATED',
  'TRANSFER_PENDING',
  'READY',
  'RELEASED_FOR_EXECUTION',
  'RECEIVED_BY_PHARMACY',
  'IN_EXECUTION',
  'SHIPPED',
  'DELIVERED',
]

export async function GET(req: NextRequest) {
  // Rate-limit before touching the token table. 60 req/min/IP is generous
  // enough for real tracking (a user reloads the page a few times) and
  // tight enough to frustrate token-space enumeration.
  const rl = await guard(req, apiLimiter, { bucket: 'tracking.public' })
  if (rl) return rl

  const { searchParams } = req.nextUrl
  const token = searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 })

  const admin = createAdminClient()

  // Validate token
  const { data: tokenRow } = await admin
    .from('order_tracking_tokens')
    .select('order_id, expires_at')
    .eq('token', token)
    .single()

  if (!tokenRow)
    return NextResponse.json({ error: 'Token inválido ou não encontrado' }, { status: 404 })
  if (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Link de rastreamento expirado' }, { status: 410 })
  }

  const { data: order } = await admin
    .from('orders')
    .select(
      `
      id, code, order_status, created_at, updated_at,
      order_items(id, quantity, product_id, products(name))
    `
    )
    .eq('id', tokenRow.order_id)
    .single()

  if (!order) return NextResponse.json({ error: 'Pedido não encontrado' }, { status: 404 })

  const o = order as any
  const currentStatusIndex = STATUS_ORDER.indexOf(o.order_status)

  const timeline = STATUS_ORDER.map((status, idx) => ({
    status,
    label: STATUS_LABELS[status] ?? status,
    completed: idx < currentStatusIndex,
    current: idx === currentStatusIndex,
    future: idx > currentStatusIndex,
  }))

  // Estimate delivery: rough ETA based on current status
  const daysLeft: Record<string, number> = {
    DRAFT: 10,
    AWAITING_DOCUMENTS: 9,
    AWAITING_PAYMENT: 8,
    PAYMENT_UNDER_REVIEW: 7,
    READY_FOR_REVIEW: 6,
    COMMISSION_CALCULATED: 5,
    TRANSFER_PENDING: 5,
    READY: 4,
    RELEASED_FOR_EXECUTION: 3,
    RECEIVED_BY_PHARMACY: 3,
    IN_EXECUTION: 2,
    SHIPPED: 1,
    DELIVERED: 0,
  }
  const days = daysLeft[o.order_status] ?? 5
  const etaDate = new Date()
  etaDate.setDate(etaDate.getDate() + days)

  return NextResponse.json({
    code: o.code,
    status: o.order_status,
    statusLabel: STATUS_LABELS[o.order_status] ?? o.order_status,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
    estimatedDelivery: o.order_status === 'DELIVERED' ? null : etaDate.toISOString(),
    isDelivered: o.order_status === 'DELIVERED',
    isCancelled: o.order_status === 'CANCELED',
    itemCount: (o.order_items ?? []).length,
    timeline,
  })
}
