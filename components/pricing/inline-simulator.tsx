'use client'

/**
 * Simulador interativo de preço para uma combinação (qtd, cupom).
 * Usado nas páginas super-admin de pricing como sanity-check antes
 * de publicar uma nova versão.
 *
 * Lê via fetch GET (`/api/pricing/preview`) — server component
 * passaria props mas fica menos vivo. Aqui o operador muda a quantidade
 * e o cupom, vê o breakdown atualizar em real-time. A rota de API é
 * cercada por requireRolePage no server.
 *
 * O componente NÃO escreve nada — é puro read.
 */

import { useEffect, useState, useTransition } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatCents } from '@/lib/money'
import { AlertTriangle, Loader2 } from 'lucide-react'
import type { PricingBreakdown } from '@/types'

interface CouponOption {
  id: string
  code: string
  buyer_label: string
}

interface Props {
  productId: string
  /** Optional: simulating for a specific clinic/doctor — used to apply
   *  buyer-specific overrides + their cupons. */
  clinicId?: string | null
  doctorId?: string | null
  coupons: CouponOption[]
}

interface ApiOk {
  ok: true
  breakdown: PricingBreakdown
}
interface ApiErr {
  ok: false
  reason: string
}
type ApiResponse = ApiOk | ApiErr

export function InlineSimulator({ productId, clinicId, doctorId, coupons }: Props) {
  const [quantity, setQuantity] = useState('1')
  const [couponId, setCouponId] = useState<string>('__none__')
  const [breakdown, setBreakdown] = useState<PricingBreakdown | null>(null)
  const [errorReason, setErrorReason] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    const qty = Number(quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      setBreakdown(null)
      setErrorReason('invalid_quantity')
      return
    }

    const params = new URLSearchParams({
      product_id: productId,
      quantity: String(qty),
    })
    if (clinicId) params.set('clinic_id', clinicId)
    if (doctorId) params.set('doctor_id', doctorId)
    if (couponId !== '__none__') params.set('coupon_id', couponId)

    startTransition(async () => {
      try {
        const r = await fetch(`/api/pricing/preview?${params.toString()}`, {
          method: 'GET',
          cache: 'no-store',
        })
        const json: ApiResponse = await r.json()
        if (!json.ok) {
          setBreakdown(null)
          setErrorReason(json.reason)
        } else {
          setBreakdown(json.breakdown)
          setErrorReason(null)
        }
      } catch {
        setBreakdown(null)
        setErrorReason('network')
      }
    })
  }, [productId, quantity, couponId, clinicId, doctorId])

  return (
    <div className="space-y-4 rounded-lg border bg-white p-6">
      <div>
        <h3 className="font-semibold text-slate-900">Simulador interativo</h3>
        <p className="text-xs text-slate-500">
          Use para conferir o impacto de tiers e cupons antes de publicar. Apenas leitura — não cria
          pedido.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="sim_qty">Quantidade</Label>
          <Input
            id="sim_qty"
            type="number"
            min="1"
            step="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="sim_coupon">Cupom (opcional)</Label>
          <Select value={couponId} onValueChange={(v) => setCouponId(v ?? '__none__')}>
            <SelectTrigger id="sim_coupon">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Sem cupom</SelectItem>
              {coupons.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.code} · {c.buyer_label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {pending && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Calculando...
        </div>
      )}

      {!pending && errorReason && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            {errorReason === 'no_active_profile' && (
              <p>Nenhum pricing profile ativo. Cadastre antes de simular.</p>
            )}
            {errorReason === 'no_tier_for_quantity' && (
              <p>Não existe tier cadastrado para esta quantidade.</p>
            )}
            {errorReason === 'invalid_quantity' && <p>Quantidade inválida.</p>}
            {!['no_active_profile', 'no_tier_for_quantity', 'invalid_quantity'].includes(
              errorReason
            ) && <p>Erro ao calcular ({errorReason}).</p>}
          </div>
        </div>
      )}

      {!pending && breakdown && <BreakdownPanel breakdown={breakdown} />}
    </div>
  )
}

function BreakdownPanel({ breakdown }: { breakdown: PricingBreakdown }) {
  const floorSrc =
    breakdown.floor_breakdown?.source === 'buyer_override'
      ? 'override de buyer'
      : breakdown.floor_breakdown?.source === 'product'
        ? 'profile do produto'
        : 'sem profile'

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Stat
          label="Tier ativo"
          value={formatCents(breakdown.tier_unit_cents)}
          hint={`qtd ${breakdown.quantity}`}
        />
        <Stat
          label="Preço final ao cliente"
          value={formatCents(breakdown.final_unit_price_cents)}
          hint={`total ${formatCents(breakdown.final_total_cents)}`}
          accent
        />
        <Stat
          label="Piso da plataforma"
          value={formatCents(breakdown.effective_floor_cents)}
          hint={floorSrc}
        />
      </div>

      <div className="rounded-md border bg-slate-50 p-4 text-sm">
        <p className="mb-2 font-medium text-slate-700">Distribuição da unidade</p>
        <dl className="grid gap-2 md:grid-cols-2">
          <Row
            label="Repasse à farmácia (por unid.)"
            value={formatCents(breakdown.pharmacy_cost_unit_cents)}
          />
          <Row
            label="Receita da plataforma (por unid.)"
            value={formatCents(breakdown.platform_commission_per_unit_cents)}
            tone={breakdown.platform_commission_per_unit_cents <= 0 ? 'warn' : 'ok'}
          />
          <Row
            label="Comissão do consultor (por unid.)"
            value={formatCents(breakdown.consultant_per_unit_cents)}
            hint={
              breakdown.consultant_capped
                ? '⚠ teto INV-4: cap aplicado para não exceder a receita da plataforma'
                : undefined
            }
            tone={breakdown.consultant_capped ? 'warn' : 'ok'}
          />
          <Row
            label="Desconto efetivo do cupom (por unid.)"
            value={formatCents(breakdown.coupon_disc_per_unit_capped_cents)}
            hint={
              breakdown.coupon_capped
                ? '⚠ teto INV-2: desconto reduzido para preservar o piso'
                : undefined
            }
            tone={breakdown.coupon_capped ? 'warn' : 'ok'}
          />
        </dl>
      </div>

      <div className="rounded-md border bg-slate-50 p-4 text-sm">
        <p className="mb-2 font-medium text-slate-700">Totais do pedido</p>
        <dl className="grid gap-2 md:grid-cols-3">
          <Row label="Total ao cliente" value={formatCents(breakdown.final_total_cents)} />
          <Row label="Total à farmácia" value={formatCents(breakdown.pharmacy_transfer_cents)} />
          <Row
            label="Total receita plataforma (líq. consultor)"
            value={formatCents(
              breakdown.platform_commission_total_cents -
                breakdown.consultant_commission_total_cents
            )}
          />
        </dl>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string
  value: string
  hint?: string
  accent?: boolean
}) {
  return (
    <div
      className={`rounded-md border p-3 ${accent ? 'border-primary/30 bg-primary/5' : 'bg-white'}`}
    >
      <p className="text-xs tracking-wide text-slate-500 uppercase">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${accent ? 'text-primary' : 'text-slate-900'}`}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

function Row({
  label,
  value,
  hint,
  tone = 'ok',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'ok' | 'warn'
}) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd
        className={`text-sm font-medium ${tone === 'warn' ? 'text-amber-700' : 'text-slate-800'}`}
      >
        {value}
      </dd>
      {hint && <p className="text-xs text-amber-600">{hint}</p>}
    </div>
  )
}
