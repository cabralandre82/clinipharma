/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { requireRole } from '@/lib/rbac'
import { findOrCreateCustomer, createPayment, getPixQrCode, dueDateFromNow } from '@/lib/asaas'
import { createNotification } from '@/lib/notifications'

export async function POST(req: NextRequest) {
  try {
    await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { orderId } = body
  if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 })

  const admin = createAdminClient()

  // Fetch order with clinic data
  const { data: order } = await admin
    .from('orders')
    .select(
      `id, code, total_price, clinic_id, clinics(trade_name, cnpj, asaas_customer_id, profiles(email, phone))`
    )
    .eq('id', orderId)
    .single()

  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const clinic = (order as any).clinics as {
    trade_name: string
    cnpj: string | null
    asaas_customer_id: string | null
    profiles: { email: string | null; phone: string | null } | null
  } | null

  if (!clinic) return NextResponse.json({ error: 'Clinic not found' }, { status: 404 })

  // Find or create Asaas customer
  let customerId = clinic.asaas_customer_id
  if (!customerId) {
    const customer = await findOrCreateCustomer({
      cpfCnpj: clinic.cnpj ?? '00000000000000',
      name: clinic.trade_name,
      email: clinic.profiles?.email ?? undefined,
      phone: clinic.profiles?.phone ?? undefined,
    })
    customerId = customer.id
    // Save asaas_customer_id to clinic
    await admin
      .from('clinics')
      .update({ asaas_customer_id: customerId })
      .eq('id', (order as any).clinic_id)
  }

  const dueDate = dueDateFromNow(3)
  const description = `Pedido ${(order as any).code} — Clinipharma`

  // Create payment in Asaas
  const payment = await createPayment({
    customerId,
    value: Number((order as any).total_price),
    dueDate,
    description,
    externalReference: orderId,
  })

  // Get PIX QR code
  let pixQrCode = null
  let pixCopyPaste = null
  try {
    const pix = await getPixQrCode(payment.id)
    pixQrCode = pix.encodedImage
    pixCopyPaste = pix.payload
  } catch {
    // PIX may not be immediately available — client can retry
  }

  // Upsert payment record
  const { data: existingPayment } = await admin
    .from('payments')
    .select('id')
    .eq('order_id', orderId)
    .limit(1)
    .maybeSingle()

  if (existingPayment) {
    await admin
      .from('payments')
      .update({
        asaas_payment_id: payment.id,
        asaas_invoice_url: payment.invoiceUrl,
        asaas_boleto_url: payment.bankSlipUrl ?? null,
        asaas_pix_qr_code: pixQrCode,
        asaas_pix_copy_paste: pixCopyPaste,
        payment_link: payment.invoiceUrl,
        payment_due_date: dueDate,
        status: 'PENDING',
      })
      .eq('id', existingPayment.id)
  } else {
    await admin.from('payments').insert({
      order_id: orderId,
      gross_amount: Number((order as any).total_price),
      status: 'PENDING',
      payment_method: 'ASAAS',
      asaas_payment_id: payment.id,
      asaas_invoice_url: payment.invoiceUrl,
      asaas_boleto_url: payment.bankSlipUrl ?? null,
      asaas_pix_qr_code: pixQrCode,
      asaas_pix_copy_paste: pixCopyPaste,
      payment_link: payment.invoiceUrl,
      payment_due_date: dueDate,
    })
  }

  // Notify clinic user
  const { data: clinicMember } = await admin
    .from('clinic_members')
    .select('user_id')
    .eq('clinic_id', order.clinic_id)
    .limit(1)
    .maybeSingle()

  if (clinicMember) {
    await createNotification({
      userId: clinicMember.user_id,
      type: 'ORDER_STATUS',
      title: `Pagamento disponível — Pedido ${order.code}`,
      message: `Escolha PIX, boleto ou cartão para pagar o pedido ${order.code}. Vencimento: ${dueDate}.`,
      link: `/orders/${orderId}`,
    })
  }

  return NextResponse.json({
    ok: true,
    asaasPaymentId: payment.id,
    invoiceUrl: payment.invoiceUrl,
    pixQrCode,
    pixCopyPaste,
    dueDate,
  })
}
