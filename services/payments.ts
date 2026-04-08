'use server'

import { createAdminClient } from '@/lib/db/admin'
import { createAuditLog, AuditAction, AuditEntity } from '@/lib/audit'
import { requireRole } from '@/lib/rbac'
import { calculateCommission } from '@/lib/payments/commission'

interface ConfirmPaymentInput {
  paymentId: string
  paymentMethod: string
  referenceCode?: string
  notes?: string
}

export async function confirmPayment(input: ConfirmPaymentInput): Promise<{ error?: string }> {
  try {
    const user = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const adminClient = createAdminClient()

    const { data: payment, error: fetchError } = await adminClient
      .from('payments')
      .select('id, order_id, gross_amount, status')
      .eq('id', input.paymentId)
      .single()

    if (fetchError || !payment) return { error: 'Pagamento não encontrado' }
    if (payment.status !== 'PENDING') return { error: 'Pagamento já processado' }

    // Confirm payment
    await adminClient
      .from('payments')
      .update({
        status: 'CONFIRMED',
        payment_method: input.paymentMethod,
        reference_code: input.referenceCode ?? null,
        notes: input.notes ?? null,
        confirmed_by_user_id: user.id,
        confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.paymentId)

    // Get commission setting
    const { data: setting } = await adminClient
      .from('app_settings')
      .select('value_json')
      .eq('key', 'default_commission_percentage')
      .single()

    const commissionPct = Number(setting?.value_json ?? 15)
    const commission = calculateCommission(payment.gross_amount, commissionPct)

    // Create commission record
    await adminClient.from('commissions').insert({
      order_id: payment.order_id,
      commission_type: 'PERCENTAGE',
      commission_percentage: commissionPct,
      commission_total_amount: commission.commissionAmount,
      calculated_by_user_id: user.id,
    })

    // Create transfer record
    await adminClient.from('transfers').insert({
      order_id: payment.order_id,
      pharmacy_id: await getOrderPharmacyId(adminClient, payment.order_id),
      gross_amount: commission.grossAmount,
      commission_amount: commission.commissionAmount,
      net_amount: commission.netAmount,
      status: 'PENDING',
    })

    // Update order status
    await adminClient
      .from('orders')
      .update({
        payment_status: 'CONFIRMED',
        order_status: 'COMMISSION_CALCULATED',
        transfer_status: 'PENDING',
        updated_at: new Date().toISOString(),
      })
      .eq('id', payment.order_id)

    await adminClient.from('order_status_history').insert({
      order_id: payment.order_id,
      old_status: 'AWAITING_PAYMENT',
      new_status: 'COMMISSION_CALCULATED',
      changed_by_user_id: user.id,
      reason: `Pagamento confirmado (${input.paymentMethod}${input.referenceCode ? ' · ref: ' + input.referenceCode : ''})`,
    })

    await createAuditLog({
      actorUserId: user.id,
      actorRole: user.roles[0],
      entityType: AuditEntity.PAYMENT,
      entityId: input.paymentId,
      action: AuditAction.PAYMENT_CONFIRMED,
      newValues: {
        order_id: payment.order_id,
        amount: payment.gross_amount,
        method: input.paymentMethod,
        commission_pct: commissionPct,
        commission_amount: commission.commissionAmount,
        net_amount: commission.netAmount,
      },
    })

    return {}
  } catch (err) {
    console.error('confirmPayment error:', err)
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return { error: 'Sem permissão' }
    }
    return { error: 'Erro interno' }
  }
}

async function getOrderPharmacyId(
  client: ReturnType<typeof import('@/lib/db/admin').createAdminClient>,
  orderId: string
): Promise<string> {
  const { data } = await client.from('orders').select('pharmacy_id').eq('id', orderId).single()
  return data?.pharmacy_id ?? ''
}

export async function completeTransfer(
  transferId: string,
  reference: string,
  notes?: string
): Promise<{ error?: string }> {
  try {
    const user = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const adminClient = createAdminClient()

    const { data: transfer, error: fetchError } = await adminClient
      .from('transfers')
      .select('id, order_id, status, net_amount, pharmacy_id')
      .eq('id', transferId)
      .single()

    if (fetchError || !transfer) return { error: 'Repasse não encontrado' }
    if (transfer.status === 'COMPLETED') return { error: 'Repasse já concluído' }

    await adminClient
      .from('transfers')
      .update({
        status: 'COMPLETED',
        transfer_reference: reference,
        notes: notes ?? null,
        processed_by_user_id: user.id,
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', transferId)

    await adminClient
      .from('orders')
      .update({
        transfer_status: 'COMPLETED',
        order_status: 'RELEASED_FOR_EXECUTION',
        updated_at: new Date().toISOString(),
      })
      .eq('id', transfer.order_id)

    await adminClient.from('order_status_history').insert({
      order_id: transfer.order_id,
      old_status: 'TRANSFER_PENDING',
      new_status: 'RELEASED_FOR_EXECUTION',
      changed_by_user_id: user.id,
      reason: `Repasse registrado · ref: ${reference}`,
    })

    await createAuditLog({
      actorUserId: user.id,
      actorRole: user.roles[0],
      entityType: AuditEntity.TRANSFER,
      entityId: transferId,
      action: AuditAction.TRANSFER_REGISTERED,
      newValues: {
        order_id: transfer.order_id,
        net_amount: transfer.net_amount,
        reference,
      },
    })

    return {}
  } catch (err) {
    console.error('completeTransfer error:', err)
    return { error: 'Erro interno' }
  }
}
