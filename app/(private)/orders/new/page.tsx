import { Metadata } from 'next'
import { createClient } from '@/lib/db/server'
import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { NewOrderForm, type NewOrderFormProduct } from '@/components/orders/new-order-form'

export const metadata: Metadata = {
  title: 'Novo pedido',
}

interface NewOrderPageProps {
  searchParams: Promise<{ product?: string }>
}

export default async function NewOrderPage({ searchParams }: NewOrderPageProps) {
  const params = await searchParams
  const user = await getCurrentUser()

  if (!user) redirect('/login')

  if (!params.product) redirect('/catalog')

  const supabase = await createClient()

  const { data: product } = await supabase
    .from('products')
    .select(
      `
      id, name, slug, concentration, presentation,
      price_current, estimated_deadline_days,
      pharmacies (id, trade_name),
      product_images (id, public_url, alt_text, sort_order)
    `
    )
    .eq('id', params.product)
    .eq('active', true)
    .single()

  if (!product) notFound()

  const { data: clinics } = await supabase
    .from('clinics')
    .select('id, trade_name')
    .eq('status', 'ACTIVE')
    .order('trade_name')

  const { data: doctors } = await supabase
    .from('doctors')
    .select('id, full_name, crm, crm_state')
    .eq('status', 'ACTIVE')
    .order('full_name')

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Novo pedido</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Preencha os dados e anexe a documentação obrigatória
        </p>
      </div>
      <NewOrderForm
        product={product as unknown as NewOrderFormProduct}
        clinics={clinics ?? []}
        doctors={doctors ?? []}
      />
    </div>
  )
}
