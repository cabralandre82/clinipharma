'use client'

/**
 * BuyerPriceSimulator — interactive quantity → price preview for
 * `TIERED_PROFILE` products on the buyer-side product detail page.
 *
 * Reusa o hook `useTieredPricePreview` (PR-D1). O hook chama
 * `/api/pricing/preview`, que respeita override por buyer (PR-B) e
 * cap INV-2 do cupom (PR-A). O simulator é só uma camada visual:
 *
 *   [- 1 +] [Solicitar pedido com 1 un]
 *      Total: R$ 1.500   (cupom XYZ aplicado, você economiza R$ 50)
 *      Faixa: 1 un / valor unitário R$ 1.500
 *
 * Não ESCREVE nada na DB — submeter o pedido vai pelo NewOrderForm
 * normal, que recalcula o preço final via trigger no INSERT.
 *
 * Tom suave: NÃO mostra "preço de tabela / desconto / margem". Só
 * o que o buyer precisa saber: "se eu pedir N, pago Y".
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Minus, Plus, ShoppingCart, Tag, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import { useTieredPricePreview } from '@/lib/orders/use-tiered-price-preview'
import {
  findTierForQuantity,
  formatTierRange,
  type BuyerTierRow,
} from '@/lib/pricing/buyer-tiers-shared'

interface BuyerPriceSimulatorProps {
  productId: string
  productSlug: string
  tiers: BuyerTierRow[]
  /** Coupon ID active for the buyer (already filtered by
   *  resolveBuyerCouponPreview). Null = no coupon. */
  couponId?: string | null
  /** Friendly coupon code shown in the chip. */
  couponCode?: string | null
  /** Bounds — UI clamps to [1, maxQuantity]. We default to the top
   *  tier's max_quantity (or 99 if open-ended), so a 1-3/4-10 product
   *  never lets the user type 50 just to see "no_tier_for_quantity". */
  maxQuantity?: number
  /** When true, the simulator highlights the matching row in the
   *  parent BuyerTierTable via `activeTierId` callback. The page
   *  passes a setter; the simulator notifies whenever the qty
   *  changes. */
  onActiveTierChange?: (tierId: string | null) => void
}

export function BuyerPriceSimulator({
  productId,
  productSlug,
  tiers,
  couponId = null,
  couponCode = null,
  maxQuantity,
  onActiveTierChange,
}: BuyerPriceSimulatorProps) {
  const router = useRouter()
  const [quantity, setQuantity] = useState(1)
  const [isNavigating, startNavigation] = useTransition()

  // Compute the upper bound. Top tier with `max_quantity = null`
  // (open-ended) → 99; otherwise = top-tier max.
  const effectiveMax = maxQuantity ?? tiers[tiers.length - 1]?.max_quantity ?? 99 // open top → arbitrary cap, the API handles it

  const cache = useTieredPricePreview([{ productId, quantity, couponId }])
  const entry = cache.get(productId, quantity, couponId)

  const activeTier = findTierForQuantity(tiers, quantity)
  // Notify parent on tier transitions so the table can highlight.
  // Effect runs after render — using a ref-like pattern would be
  // cleaner, but the callback is idempotent, so calling it here on
  // every render is fine and keeps the surface minimal.
  if (onActiveTierChange) onActiveTierChange(activeTier?.id ?? null)

  function dec() {
    setQuantity((q) => Math.max(1, q - 1))
  }
  function inc() {
    setQuantity((q) => Math.min(effectiveMax, q + 1))
  }
  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = parseInt(e.target.value, 10)
    if (Number.isNaN(v)) return
    setQuantity(Math.max(1, Math.min(effectiveMax, v)))
  }

  function goToOrder() {
    // Carry both the product and the chosen quantity so /orders/new
    // lands on the same row immediately — same shape as the doctor
    // round-trip cart param ("id:qty,id:qty").
    const cart = `${productId}:${quantity}`
    startNavigation(() => {
      router.push(`/orders/new?cart=${encodeURIComponent(cart)}`)
    })
  }

  // ── render branches ──────────────────────────────────────────────
  let priceLine: React.ReactNode
  let totalLine: React.ReactNode
  let canSubmit = true

  if (!entry || entry.state === 'pending') {
    priceLine = (
      <span className="inline-flex items-center gap-1 text-sm text-gray-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Calculando…
      </span>
    )
    totalLine = null
    canSubmit = false
  } else if (entry.state === 'error') {
    const friendly =
      entry.errorReason === 'no_tier_for_quantity'
        ? 'Quantidade fora das faixas cadastradas'
        : entry.errorReason === 'no_active_profile'
          ? 'Produto sem precificação ativa no momento'
          : 'Não foi possível calcular o valor agora'
    priceLine = <span className="text-sm font-medium text-amber-700">{friendly}</span>
    totalLine = null
    canSubmit = false
  } else if (entry.state === 'ok' && entry.breakdown) {
    const unit = entry.breakdown.final_unit_price_cents / 100
    const tierUnit = entry.breakdown.tier_unit_cents / 100
    const total = unit * quantity
    const perUnitDiscount = tierUnit - unit
    priceLine = (
      <div className="flex flex-col gap-0.5 text-sm">
        <span className="font-medium text-gray-900">
          {formatCurrency(unit)} <span className="font-normal text-gray-500">/un</span>
        </span>
        {activeTier && (
          <span className="text-xs text-gray-500">
            Faixa: <span className="font-medium">{formatTierRange(activeTier)}</span>
          </span>
        )}
      </div>
    )
    totalLine = (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-2xl font-bold text-gray-900">{formatCurrency(total)}</span>
        {perUnitDiscount > 0 && couponCode && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200"
            title={`Cupom ${couponCode}: economia de ${formatCurrency(perUnitDiscount)} por unidade`}
          >
            <Tag className="h-3 w-3" aria-hidden="true" />
            Cupom {couponCode}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3">
        <div className="space-y-1">
          <label
            htmlFor="qty-simulator"
            className="block text-xs font-medium tracking-wide text-gray-600 uppercase"
          >
            Quantidade
          </label>
          <div className="inline-flex items-center rounded-lg border border-gray-200 bg-white">
            <button
              type="button"
              onClick={dec}
              disabled={quantity <= 1}
              className="rounded-l-lg px-2.5 py-1.5 text-gray-500 hover:bg-gray-50 disabled:opacity-30"
              aria-label="Diminuir quantidade"
            >
              <Minus className="h-4 w-4" />
            </button>
            <input
              id="qty-simulator"
              type="number"
              min={1}
              max={effectiveMax}
              value={quantity}
              onChange={onChange}
              className="w-16 border-x border-gray-200 bg-transparent px-2 py-1.5 text-center text-sm tabular-nums focus:outline-none"
              aria-describedby="qty-simulator-help"
            />
            <button
              type="button"
              onClick={inc}
              disabled={quantity >= effectiveMax}
              className="rounded-r-lg px-2.5 py-1.5 text-gray-500 hover:bg-gray-50 disabled:opacity-30"
              aria-label="Aumentar quantidade"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex-1">{priceLine}</div>
      </div>

      {totalLine && (
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <p className="text-xs tracking-wide text-gray-500 uppercase">
            Total estimado · {quantity} un
          </p>
          <div className="mt-1">{totalLine}</div>
          <p id="qty-simulator-help" className="mt-1 text-[11px] leading-relaxed text-gray-400">
            Estimativa em tempo real. O valor final será confirmado pela farmácia ao receber a
            solicitação.
          </p>
        </div>
      )}

      <Button
        type="button"
        onClick={goToOrder}
        disabled={!canSubmit || isNavigating}
        size="lg"
        className="w-full text-base"
      >
        {isNavigating ? (
          <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
        ) : (
          <ShoppingCart className="mr-2 h-5 w-5" aria-hidden="true" />
        )}
        Solicitar pedido com {quantity} un
      </Button>
      <input type="hidden" data-testid="simulator-slug" value={productSlug} />
    </div>
  )
}
