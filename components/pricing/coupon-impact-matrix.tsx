/**
 * Coupon impact matrix — visualização para super-admin antes de
 * atribuir um cupom para uma clínica/médico.
 *
 * Esta é uma camada de PRESENTATION pura — recebe `cells` calculados
 * server-side (via `buildCouponImpactMatrix` em pricing-engine.server)
 * e renderiza um heatmap 2-D:
 *
 *     ┌──────┬──────────┬──────────┬──────────┐
 *     │      │ Sem cupom│ 30% PCT  │ R$ 200/u │
 *     ├──────┼──────────┼──────────┼──────────┤
 *     │ 1u   │  R$1500  │  R$1050↓ │ R$1300↓  │
 *     │ 2u   │  R$1400  │   980↓   │ R$1200↓  │
 *     │ ...  │   ...    │   ...    │   ...    │
 *     └──────┴──────────┴──────────┴──────────┘
 *
 * Cada célula mostra:
 *   • preço final ao cliente (destaque)
 *   • receita da plataforma por unidade (cor: verde se > média; laranja
 *     se baixa; vermelho se zero)
 *   • desconto efetivo (se cupom-cap INV-2 fired, badge "cap")
 *   • comissão consultor (badge se INV-4 cap fired)
 *
 * Server-rendered. Sem JS no client além de tooltip nativo.
 */

import { formatCents } from '@/lib/money'
import { AlertTriangle, ArrowDown } from 'lucide-react'
import type { CouponMatrixCell } from '@/lib/services/pricing-engine.server'

interface Props {
  cells: CouponMatrixCell[]
  variants: Array<{ idx: number; label: string }>
  quantities: number[]
  /** Optional volume projection: monthly units per quantity bracket
   *  for 'campaign cost' summary.
   *  Map qty → expected monthly units. */
  monthlyVolumeByQty?: Record<number, number>
}

export function CouponImpactMatrix({ cells, variants, quantities, monthlyVolumeByQty }: Props) {
  // Index cells by (qty, variantIdx) for O(1) lookup during render.
  const byKey = new Map<string, CouponMatrixCell>()
  for (const c of cells) {
    byKey.set(`${c.quantity}|${c.variantIdx}`, c)
  }

  // Compute baseline (variant 0 — assumed "no_coupon") for delta highlighting.
  const baselineByQty = new Map<number, number>()
  for (const q of quantities) {
    const baseline = byKey.get(`${q}|0`)
    if (baseline?.breakdown?.final_unit_price_cents != null) {
      baselineByQty.set(q, baseline.breakdown.final_unit_price_cents)
    }
  }

  // Campaign cost projection: for each variant, sum (delta × volume) across qty rows.
  const campaignCostsByVariant = new Map<number, number>()
  if (monthlyVolumeByQty) {
    for (const v of variants) {
      let cost = 0
      for (const q of quantities) {
        const baseline = baselineByQty.get(q)
        const cell = byKey.get(`${q}|${v.idx}`)
        const finalPrice = cell?.breakdown?.final_unit_price_cents
        const volume = monthlyVolumeByQty[q] ?? 0
        if (baseline != null && finalPrice != null && volume > 0) {
          cost += (baseline - finalPrice) * volume
        }
      }
      campaignCostsByVariant.set(v.idx, cost)
    }
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="sticky left-0 z-10 border-r bg-slate-50 px-3 py-2 text-left font-medium text-slate-600">
                Qtd.
              </th>
              {variants.map((v) => (
                <th
                  key={v.idx}
                  className="min-w-[180px] px-3 py-2 text-left font-medium text-slate-600"
                >
                  {v.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {quantities.map((q) => {
              const baseline = baselineByQty.get(q)
              return (
                <tr key={q} className="border-t">
                  <td className="sticky left-0 z-10 border-r bg-white px-3 py-3 text-sm font-medium text-slate-700">
                    {q} {q === 1 ? 'unid.' : 'unid.'}
                  </td>
                  {variants.map((v) => {
                    const cell = byKey.get(`${q}|${v.idx}`)
                    return (
                      <td key={v.idx} className="px-3 py-3 align-top">
                        <Cell cell={cell} baselineCents={baseline} isBaseline={v.idx === 0} />
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <Legend />

      {monthlyVolumeByQty && (
        <CampaignCostSummary
          variants={variants}
          costsByVariant={campaignCostsByVariant}
          monthlyVolumeByQty={monthlyVolumeByQty}
        />
      )}
    </div>
  )
}

function Legend() {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
      <p className="mb-2 font-medium text-slate-700">Como ler a matriz</p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        <LegendItem
          swatch="bg-emerald-100 border-emerald-300"
          label="Líquido da plataforma ≥ R$ 50/u — saudável"
        />
        <LegendItem
          swatch="bg-amber-100 border-amber-300"
          label="Líquido < R$ 50/u — margem apertada"
        />
        <LegendItem
          swatch="bg-orange-100 border-orange-300"
          label="Consultor > líquido — você paga mais a ele do que ganha"
        />
        <LegendItem
          swatch="bg-red-100 border-red-300"
          label="Líquido ≤ 0 — campanha destrói margem"
        />
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        <strong>cap INV-4</strong>: comissão do consultor foi capada para não exceder a receita
        bruta da plataforma. <strong>cupom capado (INV-2)</strong>: o desconto bateu no piso e foi
        truncado (a plataforma não absorve mais que o piso permite).
      </p>
    </div>
  )
}

function LegendItem({ swatch, label }: { swatch: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block h-3 w-3 rounded border ${swatch}`} />
      <span>{label}</span>
    </div>
  )
}

function Cell({
  cell,
  baselineCents,
  isBaseline,
}: {
  cell: CouponMatrixCell | undefined
  baselineCents: number | undefined
  isBaseline: boolean
}) {
  if (!cell) {
    return <span className="text-slate-400">—</span>
  }
  if (cell.error) {
    return (
      <div className="text-xs text-amber-700">
        <AlertTriangle className="mr-1 inline-block h-3 w-3" />
        {cell.error.reason === 'no_active_profile' && 'Sem profile'}
        {cell.error.reason === 'no_tier_for_quantity' && 'Sem tier para esta qtd.'}
        {cell.error.reason === 'invalid_quantity' && 'Qtd. inválida'}
        {cell.error.reason === 'rpc_unavailable' && 'Erro RPC'}
      </div>
    )
  }
  if (!cell.breakdown) return <span className="text-slate-400">—</span>

  const b = cell.breakdown
  const platformCents = b.platform_commission_per_unit_cents
  const consultantCents = b.consultant_per_unit_cents
  const platformNetCents = platformCents - consultantCents

  const delta = !isBaseline && baselineCents != null ? b.final_unit_price_cents - baselineCents : 0
  const showDelta = !isBaseline && delta < 0

  // Sinaliza quando o consultor leva mais que o líquido da plataforma.
  // Não viola INV-4 (que garante consultor ≤ bruto), mas é uma red flag
  // operacional: você está pagando o consultor mais que ganhando líquido.
  // Threshold: quando consultor representa > 50% da receita bruta da
  // plataforma (i.e. consultor > líquido).
  const consultantOverNet = consultantCents > 0 && consultantCents > platformNetCents

  // Cor de fundo conforme receita LÍQUIDA da plataforma (descontado consultor).
  let bgClass = ''
  if (platformNetCents <= 0) bgClass = 'bg-red-50 border-red-200'
  else if (consultantOverNet) bgClass = 'bg-orange-50 border-orange-200'
  else if (platformNetCents < 5000)
    bgClass = 'bg-amber-50 border-amber-200' // < R$ 50/u
  else bgClass = 'bg-emerald-50 border-emerald-200'

  return (
    <div className={`space-y-1 rounded-md border p-2 ${bgClass}`}>
      <div className="flex items-baseline gap-1.5">
        <span className="text-base font-semibold text-slate-900">
          {formatCents(b.final_unit_price_cents)}
        </span>
        <span className="text-xs text-slate-500">/u</span>
        {showDelta && (
          <span className="ml-auto inline-flex items-center text-xs font-medium text-rose-600">
            <ArrowDown className="h-3 w-3" />
            {formatCents(Math.abs(delta))}
          </span>
        )}
      </div>

      <dl className="space-y-0.5 text-[11px] leading-tight">
        <Mini label="Farmácia" value={formatCents(b.pharmacy_cost_unit_cents)} />
        <Mini
          label="Plataforma"
          value={formatCents(platformCents)}
          tone={platformCents <= 0 ? 'warn' : 'ok'}
        />
        <Mini
          label="Consultor"
          value={formatCents(consultantCents)}
          badge={b.consultant_capped ? 'cap INV-4' : undefined}
        />
        <Mini
          label="Plataf. líq."
          value={formatCents(platformNetCents)}
          tone={platformNetCents <= 0 ? 'warn' : 'ok'}
          bold
        />
        {consultantOverNet && (
          <div
            className="mt-1 inline-flex items-center gap-1 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-800"
            title={`Consultor R$ ${(consultantCents / 100).toFixed(2)} > líquido R$ ${(platformNetCents / 100).toFixed(2)}`}
          >
            <AlertTriangle className="h-2.5 w-2.5" />
            consultor &gt; líquido
          </div>
        )}
        {b.coupon_capped && (
          <div className="mt-1 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
            <AlertTriangle className="h-2.5 w-2.5" />
            cupom capado (INV-2)
          </div>
        )}
      </dl>
    </div>
  )
}

function Mini({
  label,
  value,
  tone = 'neutral',
  badge,
  bold,
}: {
  label: string
  value: string
  tone?: 'neutral' | 'ok' | 'warn'
  badge?: string
  bold?: boolean
}) {
  const tonalClass =
    tone === 'warn' ? 'text-rose-700' : tone === 'ok' ? 'text-emerald-700' : 'text-slate-600'
  return (
    <div className="flex items-center gap-1">
      <dt className="text-slate-500">{label}:</dt>
      <dd className={`${tonalClass} ${bold ? 'font-semibold' : ''}`}>{value}</dd>
      {badge && (
        <span className="rounded bg-amber-100 px-1 text-[9px] font-medium text-amber-800">
          {badge}
        </span>
      )}
    </div>
  )
}

function CampaignCostSummary({
  variants,
  costsByVariant,
  monthlyVolumeByQty,
}: {
  variants: Array<{ idx: number; label: string }>
  costsByVariant: Map<number, number>
  monthlyVolumeByQty: Record<number, number>
}) {
  const totalVolume = Object.values(monthlyVolumeByQty).reduce((a, b) => a + b, 0)
  return (
    <div className="rounded-lg border bg-slate-50 p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-800">Projeção de custo da campanha</h3>
        <p className="text-xs text-slate-600">
          Estimado para volume mensal total de {totalVolume} unidade(s) — diferença vs baseline (sem
          cupom) acumulada.
        </p>
      </div>
      <ul className="space-y-2 text-sm">
        {variants
          .filter((v) => v.idx !== 0) // pular baseline
          .map((v) => {
            const cost = costsByVariant.get(v.idx) ?? 0
            return (
              <li
                key={v.idx}
                className="flex items-center justify-between rounded-md border bg-white px-3 py-2"
              >
                <span className="font-medium text-slate-700">{v.label}</span>
                <div className="flex items-baseline gap-1">
                  <span
                    className={`text-base font-semibold ${
                      cost > 0 ? 'text-rose-700' : 'text-slate-700'
                    }`}
                  >
                    {cost > 0 ? '−' : ''}
                    {formatCents(Math.abs(cost))}
                  </span>
                  <span className="text-xs text-slate-500">/mês</span>
                </div>
              </li>
            )
          })}
      </ul>
    </div>
  )
}
