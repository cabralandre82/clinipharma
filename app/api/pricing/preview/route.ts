/**
 * GET /api/pricing/preview
 * ─────────────────────────────────────────────────────────────────
 * Pure read-only RPC pass-through to `compute_unit_price` (mig-071).
 *
 * Used by the super-admin inline simulator and by the (future) clinic
 * catalog. The route never writes anything — it's safe to expose to
 * SUPER_ADMIN, PLATFORM_ADMIN, and any authenticated buyer (clinic
 * member, doctor self) for their own buyer scope.
 *
 * Auth model
 * ----------
 * - Authenticated user required.
 * - Super-admin and platform admin can preview ANY (product, buyer)
 *   combo; passing `clinic_id`/`doctor_id` simulates that buyer.
 * - Non-admin can only preview against their own buyer scope; we
 *   IGNORE incoming clinic_id/doctor_id from the URL and resolve
 *   them server-side from the user's identity. This prevents a
 *   curious clinic member from probing whether a competitor has a
 *   buyer override (info leak).
 *
 * Response shape
 * --------------
 *   200 { ok: true, breakdown: PricingBreakdown }
 *   200 { ok: false, reason: 'no_active_profile' | 'no_tier_for_quantity' | ... }
 *   401 { error: 'Não autenticado' }
 *   400 { error: 'Parâmetros inválidos' }
 *   429 { error: 'Muitas requisições' }
 *
 * Note: errors that are PRICING errors (no profile, no tier) come
 * back with 200 + ok:false because they're a normal answer to the
 * question "what's the price for this?". HTTP errors (4xx/5xx) are
 * reserved for protocol/auth failures.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/db/admin'
import { apiLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { computeUnitPrice } from '@/lib/services/pricing-engine.server'

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const rl = await apiLimiter.check(ip)
  if (!rl.ok) {
    return NextResponse.json({ error: 'Muitas requisições' }, { status: 429 })
  }

  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  const sp = req.nextUrl.searchParams
  const productId = sp.get('product_id')
  const quantityRaw = sp.get('quantity')
  const couponId = sp.get('coupon_id')

  if (!productId) {
    return NextResponse.json({ error: 'product_id é obrigatório' }, { status: 400 })
  }
  const quantity = Number(quantityRaw)
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return NextResponse.json({ error: 'quantity inválida' }, { status: 400 })
  }

  const isAdmin = user.roles.includes('SUPER_ADMIN') || user.roles.includes('PLATFORM_ADMIN')

  let clinicId: string | null = null
  let doctorId: string | null = null

  if (isAdmin) {
    // Trust the URL: super-admin uses this to simulate any buyer.
    clinicId = sp.get('clinic_id') || null
    doctorId = sp.get('doctor_id') || null
  } else {
    // Non-admin: derive from session identity, ignoring URL params.
    const admin = createAdminClient()
    if (user.roles.includes('CLINIC_ADMIN')) {
      const { data: membership } = await admin
        .from('clinic_members')
        .select('clinic_id')
        .eq('user_id', user.id)
        .maybeSingle()
      clinicId = (membership as { clinic_id: string } | null)?.clinic_id ?? null
    } else if (user.roles.includes('DOCTOR')) {
      const { data: doctor } = await admin
        .from('doctors')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle()
      doctorId = (doctor as { id: string } | null)?.id ?? null
    }
  }

  const { data, error } = await computeUnitPrice({
    productId,
    quantity,
    clinicId,
    doctorId,
    couponId: couponId ?? null,
  })

  if (error) {
    // Pricing errors come as 200 with ok:false (see contract).
    if (
      error.reason === 'no_active_profile' ||
      error.reason === 'no_tier_for_quantity' ||
      error.reason === 'invalid_quantity'
    ) {
      return NextResponse.json({ ok: false, reason: error.reason })
    }
    logger.warn('[pricing/preview] rpc_unavailable', { productId, error })
    return NextResponse.json({ ok: false, reason: 'rpc_unavailable' }, { status: 502 })
  }

  return NextResponse.json({ ok: true, breakdown: data })
}
