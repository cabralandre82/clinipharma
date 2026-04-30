import 'server-only'
import { createAdminClient } from '@/lib/db/admin'
import { logger } from '@/lib/logger'
import type { BuyerActiveProfile, BuyerTierRow } from './buyer-tiers-shared'

// Re-export the shared shapes so existing imports continue to work
// (`import { BuyerTierRow } from '@/lib/pricing/buyer-tiers'` — the
// shape is here as a type, the helpers in `buyer-tiers-shared`).
export type { BuyerActiveProfile, BuyerTierRow } from './buyer-tiers-shared'
export { formatTierRange, findTierForQuantity } from './buyer-tiers-shared'

/**
 * Returns the currently-active pricing profile for a product, in a
 * buyer-safe shape. Never throws — returns `null` for any failure
 * mode (no active profile, RLS error, missing row).
 *
 * Authorisation
 * -------------
 * This function does NOT call `requireRole`. It is intentionally
 * accessible to any authenticated user — the data it returns is the
 * same data the buyer sees on the product detail page (catalog
 * price, tier brackets). RLS on `pricing_profiles` /
 * `pricing_profile_tiers` is permissive for read, restrictive for
 * write.
 *
 * Use {@link getActivePricingProfile} (in services/pricing) for the
 * super-admin surface that includes the operational fields.
 */
export async function getActiveBuyerTiers(productId: string): Promise<BuyerActiveProfile | null> {
  const admin = createAdminClient()

  const { data: profile, error: profileErr } = await admin
    .from('pricing_profiles')
    .select('id, effective_from')
    .eq('product_id', productId)
    .is('effective_until', null)
    .maybeSingle()

  if (profileErr) {
    logger.warn('[pricing] getActiveBuyerTiers profile read failed', {
      productId,
      code: profileErr.code,
      message: profileErr.message,
    })
    return null
  }
  if (!profile) return null

  const { data: tiers, error: tiersErr } = await admin
    .from('pricing_profile_tiers')
    .select('id, min_quantity, max_quantity, unit_price_cents')
    .eq('pricing_profile_id', profile.id)
    .order('min_quantity', { ascending: true })

  if (tiersErr) {
    logger.warn('[pricing] getActiveBuyerTiers tiers read failed', {
      productId,
      code: tiersErr.code,
      message: tiersErr.message,
    })
    return null
  }
  if (!tiers || tiers.length === 0) return null

  return {
    profile_id: profile.id as string,
    effective_from: profile.effective_from as string,
    tiers: tiers as BuyerTierRow[],
  }
}
