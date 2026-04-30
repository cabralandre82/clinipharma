'use client'

/**
 * BuyerTierSection — composição cliente do par
 * <BuyerTierTable/> + <BuyerPriceSimulator/>.
 *
 * Existe porque o destaque do tier ativo (linha grifada na tabela)
 * depende da quantidade selecionada no simulator. Em vez de elevar
 * o estado para o ProductDetail (também client), encapsulamos os
 * dois aqui.
 */

import { useState } from 'react'
import { BuyerTierTable } from './buyer-tier-table'
import { BuyerPriceSimulator } from './buyer-price-simulator'
import type { BuyerTierRow } from '@/lib/pricing/buyer-tiers-shared'

interface BuyerTierSectionProps {
  productId: string
  productSlug: string
  isManipulated?: boolean
  tiers: BuyerTierRow[]
  couponId?: string | null
  couponCode?: string | null
}

export function BuyerTierSection({
  productId,
  productSlug,
  isManipulated = false,
  tiers,
  couponId = null,
  couponCode = null,
}: BuyerTierSectionProps) {
  const [activeTierId, setActiveTierId] = useState<string | null>(tiers[0]?.id ?? null)

  return (
    <div className="space-y-4">
      <BuyerTierTable tiers={tiers} activeTierId={activeTierId} isManipulated={isManipulated} />
      <BuyerPriceSimulator
        productId={productId}
        productSlug={productSlug}
        tiers={tiers}
        couponId={couponId}
        couponCode={couponCode}
        onActiveTierChange={setActiveTierId}
      />
    </div>
  )
}
