import { Metadata } from 'next'
import { createClient } from '@/lib/db/server'
import { notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { OrderDetail } from '@/components/orders/order-detail'

export const metadata: Metadata = {
  title: 'Detalhe do pedido',
}

interface OrderPageProps {
  params: Promise<{ id: string }>
}

export default async function OrderPage({ params }: OrderPageProps) {
  const { id } = await params
  const user = await getCurrentUser()
  const supabase = await createClient()

  const { data: order } = await supabase
    .from('orders')
    .select(
      `
      *,
      clinics (id, trade_name, corporate_name, city, state),
      doctors (id, full_name, crm, crm_state, specialty),
      pharmacies (id, trade_name, city, state),
      order_items (
        id, product_id, quantity, unit_price, total_price,
        pharmacy_cost_per_unit, platform_commission_per_unit,
        products (id, name, concentration, presentation)
      ),
      order_documents (id, document_type, original_filename, mime_type, file_size, created_at),
      order_status_history (
        id, old_status, new_status, reason, created_at,
        profiles!changed_by_user_id (full_name)
      ),
      order_operational_updates (id, status, description, created_at),
      payments (id, gross_amount, status, payment_method, reference_code, confirmed_at, notes, asaas_payment_id, asaas_invoice_url, asaas_pix_qr_code, asaas_pix_copy_paste, asaas_boleto_url, payment_link, payment_due_date),
      commissions (id, commission_type, commission_percentage, commission_total_amount),
      transfers (id, gross_amount, commission_amount, net_amount, status, transfer_reference, processed_at)
    `
    )
    .eq('id', id)
    .single()

  if (!order) notFound()

  return <OrderDetail order={order} currentUser={user!} />
}
