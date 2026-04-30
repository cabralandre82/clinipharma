/**
 * /products/[id]/pricing — super-admin pricing dashboard for one product.
 *
 * Read-only consolidated view:
 *   - current pricing_mode + toggle CTA (dialog).
 *   - if TIERED_PROFILE: live pricing profile (or warning when none),
 *     tier table, profile history (last 10 versions).
 *   - buyer pricing overrides (live + historical) with create/expire CTAs.
 *   - inline simulator (interactive) at the bottom — quick sanity check.
 *
 * SUPER_ADMIN and PLATFORM_ADMIN can view; only SUPER_ADMIN can write
 * (the dialogs/CTAs are gated server-side by the actions themselves).
 */

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRolePage } from '@/lib/rbac'
import { createAdminClient } from '@/lib/db/admin'
import { formatCents } from '@/lib/money'
import { formatDate } from '@/lib/utils'
import {
  getActivePricingProfile,
  listPricingProfileHistory,
  listOverridesForProduct,
} from '@/services/pricing'
import { ButtonLink } from '@/components/ui/button-link'
import { Badge } from '@/components/ui/badge'
import { PricingModeToggleDialog } from '@/components/pricing/pricing-mode-toggle-dialog'
import { BuyerOverrideDialog } from '@/components/pricing/buyer-override-dialog'
import { ExpireOverrideButton } from '@/components/pricing/expire-override-button'
import { InlineSimulator } from '@/components/pricing/inline-simulator'
import { AlertTriangle, FileText } from 'lucide-react'
import type { Product, PricingMode } from '@/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Pricing do produto | Clinipharma' }

interface PageProps {
  params: Promise<{ id: string }>
}

const BASIS_LABELS: Record<string, string> = {
  TOTAL_PRICE: '% sobre o preço total ao cliente',
  PHARMACY_TRANSFER: '% sobre o repasse à farmácia',
  FIXED_PER_UNIT: 'valor fixo por unidade',
}

export default async function ProductPricingPage({ params }: PageProps) {
  const { id } = await params
  const actor = await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  const isSuperAdmin = actor.roles.includes('SUPER_ADMIN')

  const supabase = createAdminClient()

  const { data: productRaw } = await supabase
    .from('products')
    .select('id, name, sku, pricing_mode')
    .eq('id', id)
    .single()
  if (!productRaw) notFound()

  const product = productRaw as unknown as Pick<Product, 'id' | 'name' | 'sku'> & {
    pricing_mode: PricingMode
  }

  const [{ profile, tiers }, history, overrides, couponsRaw, clinicsRaw, doctorsRaw] =
    await Promise.all([
      getActivePricingProfile(id),
      listPricingProfileHistory(id),
      listOverridesForProduct(id),
      // Coupons targeted at this product (active) — used by simulator dropdown.
      supabase
        .from('coupons')
        .select('id, code, clinic_id, doctor_id, active')
        .eq('product_id', id)
        .eq('active', true),
      supabase.from('clinics').select('id, trade_name').order('trade_name'),
      supabase.from('doctors').select('id, full_name').order('full_name'),
    ])

  const liveOverrides = overrides.filter((o) => o.effective_until === null)
  const expiredOverrides = overrides.filter((o) => o.effective_until !== null)

  const couponsList = (couponsRaw.data ?? []) as Array<{
    id: string
    code: string
    clinic_id: string | null
    doctor_id: string | null
  }>
  const clinicMap = new Map(
    ((clinicsRaw.data as Array<{ id: string; trade_name: string }>) ?? []).map((c) => [
      c.id,
      c.trade_name,
    ])
  )
  const doctorMap = new Map(
    ((doctorsRaw.data as Array<{ id: string; full_name: string }>) ?? []).map((d) => [
      d.id,
      d.full_name,
    ])
  )

  const couponOptions = couponsList.map((c) => ({
    id: c.id,
    code: c.code,
    buyer_label: c.clinic_id
      ? (clinicMap.get(c.clinic_id) ?? '(clínica)')
      : (doctorMap.get(c.doctor_id ?? '') ?? '(médico)'),
  }))

  const clinicsOpt = Array.from(clinicMap.entries()).map(([id, label]) => ({ id, label }))
  const doctorsOpt = Array.from(doctorMap.entries()).map(([id, label]) => ({ id, label }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
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
            <span>Pricing</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">{product.name}</h1>
          <p className="text-sm text-gray-500">SKU: {product.sku}</p>
        </div>
      </div>

      {/* ── Mode + actions ───────────────────────────────────────────── */}
      <div className="space-y-4 rounded-lg border bg-white p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-semibold text-gray-900">Modo de precificação</h2>
            <p className="mt-1 text-sm text-slate-600">
              {product.pricing_mode === 'FIXED'
                ? 'Preço fixo por unidade — sem variação por quantidade.'
                : 'Preços por tier — variam com a quantidade do pedido.'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge
              className={
                product.pricing_mode === 'TIERED_PROFILE'
                  ? 'bg-purple-100 text-purple-700'
                  : 'bg-slate-100 text-slate-700'
              }
            >
              {product.pricing_mode === 'TIERED_PROFILE' ? 'Tier' : 'Fixo'}
            </Badge>
            {isSuperAdmin && (
              <PricingModeToggleDialog
                productId={id}
                currentMode={product.pricing_mode}
                hasActiveProfile={profile !== null}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Profile vivo + tiers ─────────────────────────────────────── */}
      <div className="space-y-4 rounded-lg border bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Pricing profile vigente</h2>
          {isSuperAdmin && (
            <ButtonLink href={`/products/${id}/pricing/edit`} variant="outline" size="sm">
              {profile ? 'Editar (criar nova versão)' : 'Cadastrar profile'}
            </ButtonLink>
          )}
        </div>

        {!profile && (
          <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
            <div>
              <p className="font-medium">Sem profile ativo.</p>
              <p className="mt-1">
                {product.pricing_mode === 'TIERED_PROFILE'
                  ? 'Pedidos para este produto serão bloqueados até que um profile seja cadastrado.'
                  : 'Cadastre um profile antes de mudar o modo para "preços por tier".'}
              </p>
            </div>
          </div>
        )}

        {profile && (
          <>
            <dl className="grid gap-4 md:grid-cols-3">
              <Field
                label="Custo à farmácia (por unid.)"
                value={formatCents(profile.pharmacy_cost_unit_cents)}
              />
              <Field
                label="Piso absoluto"
                value={
                  profile.platform_min_unit_cents != null
                    ? formatCents(profile.platform_min_unit_cents)
                    : '—'
                }
              />
              <Field
                label="Piso percentual"
                value={
                  profile.platform_min_unit_pct != null ? `${profile.platform_min_unit_pct}%` : '—'
                }
              />
              <Field
                label="Comissão consultor — critério"
                value={
                  BASIS_LABELS[profile.consultant_commission_basis] ??
                  profile.consultant_commission_basis
                }
              />
              {profile.consultant_commission_basis === 'FIXED_PER_UNIT' && (
                <Field
                  label="Comissão fixa por unid."
                  value={
                    profile.consultant_commission_fixed_per_unit_cents != null
                      ? formatCents(profile.consultant_commission_fixed_per_unit_cents)
                      : '—'
                  }
                />
              )}
              <Field label="Vigente desde" value={formatDate(profile.effective_from)} />
            </dl>

            {profile.change_reason && (
              <div className="rounded-md bg-slate-50 p-3 text-sm">
                <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                  Motivo desta versão
                </p>
                <p className="mt-1 text-slate-700">{profile.change_reason}</p>
              </div>
            )}

            <div>
              <h3 className="mb-2 text-sm font-medium text-slate-700">Tiers ({tiers.length})</h3>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-slate-600">Faixa</th>
                      <th className="px-3 py-2 text-left font-medium text-slate-600">
                        Preço/unid.
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {tiers.map((t) => (
                      <tr key={t.id} className="border-t">
                        <td className="px-3 py-2">
                          {t.min_quantity === t.max_quantity
                            ? `${t.min_quantity} unid.`
                            : `${t.min_quantity}–${t.max_quantity} unid.`}
                        </td>
                        <td className="px-3 py-2 font-medium">{formatCents(t.unit_price_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Histórico de profiles ──────────────────────────────────── */}
      {history.length > 1 && (
        <div className="space-y-4 rounded-lg border bg-white p-6">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-slate-400" />
            <h2 className="font-semibold text-gray-900">Histórico de versões ({history.length})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="pb-2 font-medium">Vigente</th>
                  <th className="pb-2 font-medium">Custo farmácia</th>
                  <th className="pb-2 font-medium">Piso abs.</th>
                  <th className="pb-2 font-medium">Piso %</th>
                  <th className="pb-2 font-medium">Motivo</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="py-2 text-slate-600">
                      {formatDate(h.effective_from)}
                      {' → '}
                      {h.effective_until ? formatDate(h.effective_until) : 'agora'}
                    </td>
                    <td className="py-2">{formatCents(h.pharmacy_cost_unit_cents)}</td>
                    <td className="py-2">
                      {h.platform_min_unit_cents != null
                        ? formatCents(h.platform_min_unit_cents)
                        : '—'}
                    </td>
                    <td className="py-2">
                      {h.platform_min_unit_pct != null ? `${h.platform_min_unit_pct}%` : '—'}
                    </td>
                    <td className="py-2 text-slate-600">{h.change_reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Buyer pricing overrides ─────────────────────────────────── */}
      <div className="space-y-4 rounded-lg border bg-white p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-900">
              Overrides de buyer ({liveOverrides.length} ativo(s))
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Pisos de plataforma negociados por cliente — vencem o piso do produto.
            </p>
          </div>
          {isSuperAdmin && (
            <BuyerOverrideDialog productId={id} clinics={clinicsOpt} doctors={doctorsOpt} />
          )}
        </div>

        {liveOverrides.length === 0 && expiredOverrides.length === 0 && (
          <p className="rounded-md border border-dashed bg-slate-50 p-6 text-center text-sm text-slate-500">
            Nenhum override cadastrado para este produto.
          </p>
        )}

        {liveOverrides.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">Buyer</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">Tipo</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">Piso abs.</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">Piso %</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">Vigente desde</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {liveOverrides.map((o) => (
                  <tr key={o.id} className="border-t">
                    <td className="px-3 py-2 font-medium">{o.buyer_label}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {o.buyer_kind === 'clinic' ? 'Clínica' : 'Médico'}
                    </td>
                    <td className="px-3 py-2">
                      {o.platform_min_unit_cents != null
                        ? formatCents(o.platform_min_unit_cents)
                        : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {o.platform_min_unit_pct != null ? `${o.platform_min_unit_pct}%` : '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{formatDate(o.effective_from)}</td>
                    <td className="px-3 py-2 text-right">
                      {isSuperAdmin && (
                        <ExpireOverrideButton overrideId={o.id} buyerLabel={o.buyer_label} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {expiredOverrides.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-slate-600">
              Histórico de overrides encerrados ({expiredOverrides.length})
            </summary>
            <div className="mt-3 overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Buyer</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Vigência</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {expiredOverrides.map((o) => (
                    <tr key={o.id} className="border-t">
                      <td className="px-3 py-2">{o.buyer_label}</td>
                      <td className="px-3 py-2 text-slate-500">
                        {formatDate(o.effective_from)} → {formatDate(o.effective_until ?? '')}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{o.change_reason ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>

      {/* ── Simulador ────────────────────────────────────────────────── */}
      {profile && <InlineSimulator productId={id} coupons={couponOptions} />}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-slate-900">{value}</dd>
    </div>
  )
}
