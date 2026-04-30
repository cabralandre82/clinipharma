/**
 * Server-side wrapper for the SQL pricing engine installed in PR-A/B.
 *
 * Three RPC entry points:
 *   - resolvePricingProfile(productId, at)
 *   - resolveEffectiveFloor(productId, clinicId, doctorId, tierUnitCents, at)
 *   - computeUnitPrice(productId, quantity, clinicId, doctorId, couponId, at)
 *
 * Why a wrapper at all
 * --------------------
 * * Type discipline: the SQL functions return raw jsonb. Without a TS
 *   layer the call site juggles unknown payloads. Here we coerce once
 *   and surface `PricingBreakdown` (declared in `types/index.ts`) to
 *   every caller.
 * * Metrics: counter on success/error + latency histogram, same shape
 *   the atomic RPC wrapper uses (so the dashboard already shows them).
 * * Error normalisation: structured `error.reason` so UI code can map
 *   a small set of strings, not raw Postgres messages.
 * * Cache: every call hits Supabase. UI surfaces (catalog, simulator)
 *   call this many times per render — we add a per-request memoization
 *   so that the same input within a single React Server Component
 *   render only runs once.
 *
 * What this is NOT
 * ----------------
 * * Not a pricing oracle for trusted writes. The trigger
 *   `freeze_order_item_price` is the source of truth at order time;
 *   THIS module is read-only (preview / simulator).
 * * No coupon counters are touched here. Use this wrapper to *show*
 *   the buyer a number; freeze the actual order via createOrderAtomic.
 *
 * @module lib/services/pricing-engine.server
 */

import 'server-only'

import { createAdminClient } from '@/lib/db/admin'
import { logger } from '@/lib/logger'
import { incCounter, observeHistogram, Metrics } from '@/lib/metrics'
import type { PricingBreakdown } from '@/types'

// ── Reasons surfaced by the SQL functions ────────────────────────────────
//
// These match exact strings either set in the JSON `error` field by
// compute_unit_price OR the Postgres exception messages we re-raise
// (e.g. "no_active_profile", "no_tier_for_quantity"). UI can branch on
// this enum-like type for actionable messaging.

export type PricingEngineReason =
  | 'no_active_profile'
  | 'no_tier_for_quantity'
  | 'invalid_quantity'
  | 'rpc_unavailable'

export interface PricingEngineError {
  reason: PricingEngineReason
  raw?: unknown
}

// ── Internal: call helper ─────────────────────────────────────────────────

async function callPricingRpc<T>(
  rpcName: string,
  params: Record<string, unknown>
): Promise<{ data?: T; error?: PricingEngineError }> {
  const started = Date.now()
  const admin = createAdminClient()
  try {
    const { data, error } = await admin.rpc(rpcName, params)
    const duration = Date.now() - started
    observeHistogram(Metrics.ATOMIC_RPC_DURATION_MS, duration, { flow: 'pricing' })

    if (error) {
      const reason = mapPricingError(error.message)
      incCounter(Metrics.ATOMIC_RPC_TOTAL, { flow: 'pricing', outcome: reason })
      logger.warn('[pricing-engine] rpc returned error', {
        rpc: rpcName,
        reason,
        raw: error.message,
      })
      return { error: { reason, raw: error } }
    }

    // The SQL function may also return `{ error: '...' }` as data
    // when the input is structurally fine but pricing isn't (no
    // active profile, no tier for the quantity, etc). Detect that
    // shape and translate to PricingEngineError so the call site
    // doesn't need to peek inside.
    if (data && typeof data === 'object' && 'error' in (data as object)) {
      const inlineReason = mapPricingError(String((data as { error: unknown }).error))
      incCounter(Metrics.ATOMIC_RPC_TOTAL, { flow: 'pricing', outcome: inlineReason })
      return { error: { reason: inlineReason, raw: data } }
    }

    incCounter(Metrics.ATOMIC_RPC_TOTAL, { flow: 'pricing', outcome: 'success' })
    return { data: data as T }
  } catch (err) {
    incCounter(Metrics.ATOMIC_RPC_TOTAL, { flow: 'pricing', outcome: 'rpc_unavailable' })
    logger.error('[pricing-engine] rpc threw', { rpc: rpcName, error: err })
    return { error: { reason: 'rpc_unavailable', raw: err } }
  }
}

function mapPricingError(message: string | undefined | null): PricingEngineReason {
  const m = (message ?? '').toLowerCase()
  if (m.includes('no_active_profile')) return 'no_active_profile'
  if (m.includes('no_tier_for_quantity')) return 'no_tier_for_quantity'
  if (m.includes('quantity must be > 0') || m.includes('invalid_quantity')) {
    return 'invalid_quantity'
  }
  return 'rpc_unavailable'
}

// ── Public API ────────────────────────────────────────────────────────────

export interface ComputeUnitPriceArgs {
  productId: string
  quantity: number
  clinicId?: string | null
  doctorId?: string | null
  couponId?: string | null
  /** ISO timestamp; defaults to "now" inside the RPC. */
  at?: string | null
}

/**
 * Pure preview of the pricing breakdown for an item. No write side-effects.
 * Use to render the simulator, the coupon-impact matrix, or to show
 * the clinic the dynamic price after they pick a quantity.
 *
 * Returns `error.reason='no_active_profile'` when the product is in
 * `pricing_mode='TIERED_PROFILE'` but no live profile exists yet (a
 * configuration bug the UI should call out clearly so the operator
 * can finish setting up the product).
 *
 * Returns `error.reason='no_tier_for_quantity'` when the requested
 * quantity falls outside any tier — UI should ask the buyer to revise
 * the quantity or contact support.
 */
export async function computeUnitPrice(
  args: ComputeUnitPriceArgs
): Promise<{ data?: PricingBreakdown; error?: PricingEngineError }> {
  if (!args.productId) {
    return { error: { reason: 'rpc_unavailable', raw: 'missing productId' } }
  }
  if (!Number.isFinite(args.quantity) || args.quantity <= 0) {
    return { error: { reason: 'invalid_quantity', raw: args.quantity } }
  }

  return callPricingRpc<PricingBreakdown>('compute_unit_price', {
    p_product_id: args.productId,
    p_quantity: args.quantity,
    p_clinic_id: args.clinicId ?? null,
    p_doctor_id: args.doctorId ?? null,
    p_coupon_id: args.couponId ?? null,
    p_at: args.at ?? null,
  })
}

export interface ResolveFloorArgs {
  productId: string
  clinicId?: string | null
  doctorId?: string | null
  /** Tier price per unit, in cents — required for the pct floor branch. */
  tierUnitCents: number
  at?: string | null
}

export interface FloorBreakdown {
  floor_cents: number | null
  source: 'product' | 'buyer_override' | 'no_profile'
  profile_id?: string
  override_id?: string
  floor_abs_cents: number | null
  floor_pct_cents: number | null
}

/**
 * Resolve the per-unit platform-revenue floor for a (product, buyer,
 * tier price) combination. PR-B: prefers `buyer_pricing_overrides`
 * over the product profile.
 */
export async function resolveEffectiveFloor(
  args: ResolveFloorArgs
): Promise<{ data?: FloorBreakdown; error?: PricingEngineError }> {
  return callPricingRpc<FloorBreakdown>('resolve_effective_floor', {
    p_product_id: args.productId,
    p_clinic_id: args.clinicId ?? null,
    p_doctor_id: args.doctorId ?? null,
    p_tier_unit_cents: args.tierUnitCents,
    p_at: args.at ?? null,
  })
}

// ── Matrix preview helper ────────────────────────────────────────────────
//
// Used by PR-C2's super-admin "coupon impact preview" page and by
// PR-D's clinic-side simulator. Computes a 2-D matrix of breakdowns
// for an array of quantities and an optional list of coupon IDs.
// Caller can then aggregate into a heatmap / table.

export interface MatrixCell {
  quantity: number
  couponId: string | null
  /** undefined when the engine returned an error for this cell. */
  breakdown?: PricingBreakdown
  error?: PricingEngineError
}

export interface MatrixArgs {
  productId: string
  quantities: number[]
  couponIds?: Array<string | null>
  clinicId?: string | null
  doctorId?: string | null
  at?: string | null
}

/**
 * Build a 2-D matrix `quantities × coupons`. Sequential because the
 * underlying RPC is cheap (`STABLE`, all indexed lookups) and we want
 * deterministic ordering for the UI. If a future profiling shows this
 * is the bottleneck, switch to `Promise.all` with a small concurrency
 * cap — the function is pure read.
 */
export async function buildPricingMatrix(args: MatrixArgs): Promise<MatrixCell[]> {
  const couponSet = args.couponIds && args.couponIds.length > 0 ? args.couponIds : [null]
  const cells: MatrixCell[] = []

  for (const qty of args.quantities) {
    for (const couponId of couponSet) {
      const { data, error } = await computeUnitPrice({
        productId: args.productId,
        quantity: qty,
        clinicId: args.clinicId,
        doctorId: args.doctorId,
        couponId: couponId ?? null,
        at: args.at,
      })
      cells.push({
        quantity: qty,
        couponId: couponId ?? null,
        breakdown: data,
        error,
      })
    }
  }

  return cells
}
