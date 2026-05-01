/**
 * /products/[id]/pricing/edit — super-admin profile editor.
 *
 * SCD-2: edits never overwrite — they create a new version. The form
 * starts pre-filled with the live profile (if any), the operator
 * tweaks pharmacy_cost / floors / consultant basis / tiers, fills a
 * change_reason, and clicks "Salvar e publicar nova versão". Server action
 * `savePricingProfile` calls the atomic RPC (mig-076) to expire the
 * old + insert the new + insert tiers in a single transaction.
 *
 * Only SUPER_ADMIN can save (server action enforces). Page itself is
 * gated for SUPER_ADMIN only — PLATFORM_ADMIN reads /pricing but
 * cannot edit.
 */

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRolePage } from '@/lib/rbac'
import { createAdminClient } from '@/lib/db/admin'
import { getActivePricingProfile } from '@/services/pricing'
import { PricingProfileForm } from '@/components/pricing/pricing-profile-form'
import type { Product } from '@/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Editar pricing | Clinipharma' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ProductPricingEditPage({ params }: PageProps) {
  const { id } = await params
  await requireRolePage(['SUPER_ADMIN'])

  const supabase = createAdminClient()
  const { data: productRaw } = await supabase
    .from('products')
    .select('id, name, sku')
    .eq('id', id)
    .single()
  if (!productRaw) notFound()

  const product = productRaw as unknown as Pick<Product, 'id' | 'name' | 'sku'>
  const { profile, tiers } = await getActivePricingProfile(id)

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Link href="/products" className="hover:text-primary">
            Produtos
          </Link>
          <span>/</span>
          <Link href={`/products/${id}`} className="hover:text-primary">
            {product.name}
          </Link>
          <span>/</span>
          <Link href={`/products/${id}/pricing`} className="hover:text-primary">
            Pricing
          </Link>
          <span>/</span>
          <span>{profile ? 'Nova versão' : 'Cadastrar profile'}</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">
          {profile ? 'Editar pricing profile' : 'Cadastrar pricing profile'}
        </h1>
        <p className="text-sm text-gray-500">
          {profile
            ? 'Salvar publica uma nova versão. A versão atual fica preservada como histórico.'
            : 'Defina custo da farmácia, pisos da plataforma, comissão do consultor e tiers de quantidade.'}
        </p>
      </div>

      <div className="rounded-lg border bg-white p-6">
        <PricingProfileForm
          productId={id}
          currentProfile={profile}
          currentTiers={tiers}
          cancelHref={`/products/${id}/pricing`}
        />
      </div>
    </div>
  )
}
