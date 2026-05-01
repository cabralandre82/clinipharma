/**
 * /products/[id]/pricing/coupon-matrix — coupon impact matrix
 * (PR-C3 do ADR-001).
 *
 * Pergunta que esta página responde
 * ---------------------------------
 *   "Antes de eu (super-admin) atribuir um cupom de 30% para a clínica
 *    X em Tirzepatida 60mg, mostre exatamente quanto eu vou ganhar/
 *    perder em cada faixa de quantidade."
 *
 * Como funciona
 * -------------
 * Tudo na URL. Server Component que lê searchParams:
 *   buyer_kind=clinic|doctor   buyer_id=<uuid>
 *   max_qty=10
 *   hyp=PERCENT:30  hyp=FIXED:200   (até 4)
 *   coupon_id=<uuid>  coupon_id=<uuid>   (cupons existentes)
 *
 * Calcula via buildCouponImpactMatrix:
 *   • baseline (sem cupom)
 *   • cada cupom hipotético
 *   • cada cupom existente selecionado
 * Renderiza heatmap server-side. Filtros são client (vivem no querystring).
 *
 * Acesso: SUPER_ADMIN + PLATFORM_ADMIN.
 */

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRolePage } from '@/lib/rbac'
import { createAdminClient } from '@/lib/db/admin'
import { buildCouponImpactMatrix, type CouponVariant } from '@/lib/services/pricing-engine.server'
import { CouponImpactMatrix } from '@/components/pricing/coupon-impact-matrix'
import { CouponMatrixFilters } from '@/components/pricing/coupon-matrix-filters'
import type { PricingMode, Product } from '@/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Matriz de impacto de cupons | Clinipharma' }

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function readArray(v: string | string[] | undefined): string[] {
  if (v == null) return []
  return Array.isArray(v) ? v : [v]
}

function parseHyp(s: string): {
  type: 'PERCENT' | 'FIXED'
  value: number
} | null {
  const [type, valueStr] = s.split(':')
  if (type !== 'PERCENT' && type !== 'FIXED') return null
  const v = Number((valueStr ?? '').replace(',', '.'))
  if (!Number.isFinite(v) || v <= 0) return null
  if (type === 'PERCENT' && v > 100) return null
  return { type: type as 'PERCENT' | 'FIXED', value: v }
}

function discountLabel(type: string, value: number): string {
  if (type === 'PERCENT') return `${value}%`
  return `R$ ${value.toFixed(2).replace('.', ',')}/u`
}

export default async function CouponMatrixPage({ params, searchParams }: PageProps) {
  const { id } = await params
  const sp = await searchParams
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])

  const admin = createAdminClient()
  const { data: productRaw } = await admin
    .from('products')
    .select('id, name, sku, pricing_mode')
    .eq('id', id)
    .single()
  if (!productRaw) notFound()
  const product = productRaw as unknown as Pick<Product, 'id' | 'name' | 'sku'> & {
    pricing_mode: PricingMode
  }

  // ── Resolve filtros vindos da URL ─────────────────────────────────
  const buyerKind = (Array.isArray(sp.buyer_kind) ? sp.buyer_kind[0] : sp.buyer_kind) as
    | 'clinic'
    | 'doctor'
    | undefined
  const buyerIdRaw = Array.isArray(sp.buyer_id) ? sp.buyer_id[0] : sp.buyer_id
  const buyerId = buyerIdRaw && buyerIdRaw.length > 0 ? buyerIdRaw : null

  const maxQtyRaw = Array.isArray(sp.max_qty) ? sp.max_qty[0] : sp.max_qty
  const maxQty = (() => {
    const n = Number(maxQtyRaw)
    if (!Number.isFinite(n) || n <= 0) return 10
    return Math.min(20, Math.max(1, Math.floor(n)))
  })()
  const quantities = Array.from({ length: maxQty }, (_, i) => i + 1)

  const hypsRaw = readArray(sp.hyp)
  const hyps = hypsRaw.map(parseHyp).filter((h): h is NonNullable<typeof h> => h !== null)

  const existingCouponIds = readArray(sp.coupon_id)

  // ── Listas para os filtros ────────────────────────────────────────
  const [clinicsRes, doctorsRes, allCouponsRes] = await Promise.all([
    admin.from('clinics').select('id, trade_name').order('trade_name'),
    admin.from('doctors').select('id, full_name').order('full_name'),
    admin
      .from('coupons')
      .select('id, code, clinic_id, doctor_id, discount_type, discount_value, active')
      .eq('product_id', id)
      .eq('active', true),
  ])

  const clinics = ((clinicsRes.data as Array<{ id: string; trade_name: string }>) ?? []).map(
    (c) => ({ id: c.id, label: c.trade_name })
  )
  const doctors = ((doctorsRes.data as Array<{ id: string; full_name: string }>) ?? []).map(
    (d) => ({ id: d.id, label: d.full_name })
  )

  const clinicMap = new Map(clinics.map((c) => [c.id, c.label]))
  const doctorMap = new Map(doctors.map((d) => [d.id, d.label]))

  const existingCoupons = (
    (allCouponsRes.data as Array<{
      id: string
      code: string
      clinic_id: string | null
      doctor_id: string | null
      discount_type: 'PERCENT' | 'FIXED'
      discount_value: number
    }>) ?? []
  ).map((c) => ({
    id: c.id,
    code: c.code,
    buyer_label: c.clinic_id
      ? (clinicMap.get(c.clinic_id) ?? '(clínica)')
      : (doctorMap.get(c.doctor_id ?? '') ?? '(médico)'),
    discount_label: discountLabel(c.discount_type, c.discount_value),
    discount_type: c.discount_type,
    discount_value: c.discount_value,
  }))

  // ── Monta variantes para a matriz ────────────────────────────────
  const variants: CouponVariant[] = [{ kind: 'no_coupon', label: 'Sem cupom (baseline)' }]
  for (const h of hyps) {
    variants.push({
      kind: 'hypothetical',
      label: `Hipotético ${discountLabel(h.type, h.value)}`,
      discountType: h.type,
      discountValue: h.value,
    })
  }
  for (const cid of existingCouponIds) {
    const c = existingCoupons.find((x) => x.id === cid)
    if (!c) continue
    variants.push({
      kind: 'existing',
      label: `${c.code} (${c.discount_label}) · ${c.buyer_label}`,
      couponId: c.id,
    })
  }

  const variantHeader = variants.map((v, idx) => ({ idx, label: v.label }))

  // ── Calcula a matriz se for TIERED_PROFILE ───────────────────────
  const isTiered = product.pricing_mode === 'TIERED_PROFILE'
  const cells = isTiered
    ? await buildCouponImpactMatrix({
        productId: id,
        quantities,
        variants,
        clinicId: buyerKind === 'clinic' ? buyerId : null,
        doctorId: buyerKind === 'doctor' ? buyerId : null,
      })
    : []

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
          <span>Matriz de impacto</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Matriz de impacto de cupons</h1>
        <p className="text-sm text-gray-500">
          Visualize a projeção financeira para cada combinação de quantidade × cupom antes de
          atribuir.
        </p>
      </div>

      {!isTiered && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Este produto está em modo <strong>preço fixo</strong>. A matriz de impacto só faz sentido
          para produtos com tiers cadastrados. Cadastre um pricing profile e mude o modo em{' '}
          <Link href={`/products/${id}/pricing`} className="underline">
            Pricing avançado
          </Link>{' '}
          para usar esta visualização.
        </div>
      )}

      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <p className="font-medium text-slate-700">Tipos de cupom suportados</p>
        <p className="mt-1">
          A matriz hoje simula apenas <strong>desconto percentual</strong> e{' '}
          <strong>desconto fixo por unidade</strong> — os mesmos tipos que a plataforma cria em{' '}
          <Link href="/coupons" className="underline">
            /coupons
          </Link>
          . Outros formatos (upgrade de tier, desconto só na 1ª unidade, % condicionado a quantidade
          mínima) estão no roadmap como ADR-002 e ainda não estão implementados — não é possível
          criá-los e portanto não aparecem aqui.
        </p>
      </div>

      <CouponMatrixFilters
        productId={id}
        clinics={clinics}
        doctors={doctors}
        existingCoupons={existingCoupons}
      />

      {isTiered && variants.length === 1 && (
        <div className="rounded-md border bg-slate-50 p-4 text-sm text-slate-600">
          Adicione pelo menos um cupom hipotético OU selecione um cupom existente acima para começar
          a comparação.
        </div>
      )}

      {isTiered && variants.length > 1 && (
        <CouponImpactMatrix cells={cells} variants={variantHeader} quantities={quantities} />
      )}
    </div>
  )
}
