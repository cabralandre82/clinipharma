import { Metadata } from 'next'
import { createClient } from '@/lib/db/server'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { NewOrderForm, type NewOrderFormProduct } from '@/components/orders/new-order-form'

export const metadata: Metadata = { title: 'Novo pedido | Clinipharma' }

interface NewOrderPageProps {
  searchParams: Promise<{ product?: string }>
}

export default async function NewOrderPage({ searchParams }: NewOrderPageProps) {
  const params = await searchParams
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  if (user.registration_status && user.registration_status !== 'APPROVED') {
    redirect('/dashboard')
  }

  const supabase = await createClient()

  const { data: productsRaw } = await supabase
    .from('products')
    .select(
      'id, name, slug, concentration, presentation, price_current, pharmacy_cost, estimated_deadline_days, pharmacy_id, pharmacies(id, trade_name), product_images(id, public_url, alt_text, sort_order)'
    )
    .eq('active', true)
    .order('name')

  const products = (productsRaw ?? []) as unknown as NewOrderFormProduct[]
  const initialProduct = params.product ? products.find((p) => p.id === params.product) : undefined

  const [{ data: clinics }, { data: doctors }] = await Promise.all([
    supabase.from('clinics').select('id, trade_name').eq('status', 'ACTIVE').order('trade_name'),
    supabase
      .from('doctors')
      .select('id, full_name, crm, crm_state')
      .eq('status', 'ACTIVE')
      .order('full_name'),
  ])

  // For doctors: fetch their linked clinics to pre-select / force selection
  let doctorClinics: Array<{ id: string; trade_name: string }> | null = null
  if (user.roles.includes('DOCTOR')) {
    const { data: doctorRecord } = await supabase
      .from('doctors')
      .select('id')
      .eq('email', user.email)
      .maybeSingle()

    if (doctorRecord) {
      const { data: linked } = await supabase
        .from('doctor_clinic_links')
        .select('clinics(id, trade_name)')
        .eq('doctor_id', doctorRecord.id)

      doctorClinics = (linked ?? [])
        .map((l) => l.clinics as unknown as { id: string; trade_name: string })
        .filter(Boolean)
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Novo pedido</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Adicione um ou mais produtos da mesma farmácia e preencha os dados
        </p>
      </div>
      <NewOrderForm
        initialProduct={initialProduct}
        availableProducts={products}
        clinics={clinics ?? []}
        doctors={doctors ?? []}
        doctorClinics={doctorClinics}
      />
    </div>
  )
}
