/**
 * Buyer-side tier helpers — client-SAFE.
 *
 * This module is the share between server (page fetching tiers) and
 * client (BuyerPriceSimulator, BuyerTierTable). It MUST NOT import
 * `server-only` or anything that requires admin DB access. The
 * server-only DB reader lives in `./buyer-tiers.server`.
 */

/**
 * Buyer-safe view of a tier row.
 *
 * `PricingProfileTier` exposes operational/financial fields the
 * BUYER must NEVER see — `pharmacy_cost_unit_cents`,
 * `platform_min_unit_cents`, `platform_min_pct_bps`,
 * `consultant_*`. This shape is the projection the buyer is allowed
 * to learn: tier bracket + per-unit price.
 */
export interface BuyerTierRow {
  /** Tier id — only useful for React `key=` props. */
  id: string
  min_quantity: number
  /** null means "and above" (open-ended top tier). */
  max_quantity: number | null
  /** Tier unit price IN CENTS. The buyer-facing price BEFORE coupon. */
  unit_price_cents: number
}

export interface BuyerActiveProfile {
  profile_id: string
  /** When the profile became active. Useful for tooltips ("vigente desde…"). */
  effective_from: string
  tiers: BuyerTierRow[]
}

/**
 * Format a tier's quantity bracket for display.
 * - Single quantity: "1 un"
 * - Range: "2-3 un"
 * - Open top: "10+ un"
 *
 * Centralised so both the table and the simulator label agree.
 */
export function formatTierRange(tier: BuyerTierRow): string {
  if (tier.max_quantity === null) {
    return tier.min_quantity === 1 ? '1+ un' : `${tier.min_quantity}+ un`
  }
  if (tier.max_quantity === tier.min_quantity) {
    return `${tier.min_quantity} un`
  }
  return `${tier.min_quantity}-${tier.max_quantity} un`
}

/**
 * Find the tier that covers a given quantity (or null if outside all
 * brackets). Used by the simulator to show "you're in the X-Y un
 * tier" alongside the live preview.
 */
export function findTierForQuantity(tiers: BuyerTierRow[], quantity: number): BuyerTierRow | null {
  if (quantity < 1) return null
  return (
    tiers.find((t) => {
      if (quantity < t.min_quantity) return false
      if (t.max_quantity !== null && quantity > t.max_quantity) return false
      return true
    }) ?? null
  )
}
