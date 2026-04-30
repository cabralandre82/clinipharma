import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as adminModule from '@/lib/db/admin'
import {
  computeUnitPrice,
  resolveEffectiveFloor,
  buildPricingMatrix,
} from '@/lib/services/pricing-engine.server'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))

const PRODUCT_ID = '22222222-2222-2222-2222-222222222222'
const CLINIC_ID = '33333333-3333-3333-3333-333333333333'

function mockRpc(impl: ReturnType<typeof vi.fn>) {
  vi.mocked(adminModule.createAdminClient).mockReturnValue({
    rpc: impl,
  } as unknown as ReturnType<typeof adminModule.createAdminClient>)
  return impl
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── computeUnitPrice ─────────────────────────────────────────────────────

describe('computeUnitPrice', () => {
  it('returns the breakdown on the happy path', async () => {
    const rpc = mockRpc(
      vi.fn().mockResolvedValue({
        data: {
          pricing_profile_id: 'p-1',
          tier_id: 't-1',
          tier_unit_cents: 150000,
          pharmacy_cost_unit_cents: 50000,
          effective_floor_cents: 50000,
          floor_breakdown: {
            floor_cents: 50000,
            source: 'product',
            profile_id: 'p-1',
            floor_abs_cents: 12000,
            floor_pct_cents: 12000,
          },
          coupon_id: null,
          coupon_disc_per_unit_raw_cents: 0,
          coupon_disc_per_unit_capped_cents: 0,
          coupon_capped: false,
          final_unit_price_cents: 150000,
          platform_commission_per_unit_cents: 100000,
          consultant_basis: 'TOTAL_PRICE',
          consultant_per_unit_raw_cents: 7500,
          consultant_per_unit_cents: 7500,
          consultant_capped: false,
          quantity: 1,
          final_total_cents: 150000,
          pharmacy_transfer_cents: 50000,
          platform_commission_total_cents: 100000,
          consultant_commission_total_cents: 7500,
        },
        error: null,
      })
    )

    const res = await computeUnitPrice({ productId: PRODUCT_ID, quantity: 1 })
    expect(res.error).toBeUndefined()
    expect(res.data?.final_unit_price_cents).toBe(150000)
    expect(rpc).toHaveBeenCalledWith('compute_unit_price', {
      p_product_id: PRODUCT_ID,
      p_quantity: 1,
      p_clinic_id: null,
      p_doctor_id: null,
      p_coupon_id: null,
      p_at: null,
    })
  })

  it('translates inline {error: no_active_profile} to a typed reason', async () => {
    mockRpc(
      vi.fn().mockResolvedValue({
        data: { error: 'no_active_profile' },
        error: null,
      })
    )

    const res = await computeUnitPrice({ productId: PRODUCT_ID, quantity: 1 })
    expect(res.data).toBeUndefined()
    expect(res.error?.reason).toBe('no_active_profile')
  })

  it('translates inline {error: no_tier_for_quantity}', async () => {
    mockRpc(
      vi.fn().mockResolvedValue({
        data: { error: 'no_tier_for_quantity', profile_id: 'p-1', quantity: 999 },
        error: null,
      })
    )

    const res = await computeUnitPrice({
      productId: PRODUCT_ID,
      quantity: 999,
      clinicId: CLINIC_ID,
    })
    expect(res.error?.reason).toBe('no_tier_for_quantity')
  })

  it('rejects invalid quantity client-side without hitting RPC', async () => {
    const rpc = mockRpc(vi.fn())
    const res = await computeUnitPrice({ productId: PRODUCT_ID, quantity: 0 })
    expect(res.error?.reason).toBe('invalid_quantity')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('maps Supabase RPC error to rpc_unavailable', async () => {
    mockRpc(
      vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'connection refused' },
      })
    )
    const res = await computeUnitPrice({ productId: PRODUCT_ID, quantity: 1 })
    expect(res.error?.reason).toBe('rpc_unavailable')
  })

  it('maps thrown RPC to rpc_unavailable', async () => {
    mockRpc(vi.fn().mockRejectedValue(new Error('boom')))
    const res = await computeUnitPrice({ productId: PRODUCT_ID, quantity: 1 })
    expect(res.error?.reason).toBe('rpc_unavailable')
  })
})

// ── resolveEffectiveFloor ────────────────────────────────────────────────

describe('resolveEffectiveFloor', () => {
  it('returns the floor breakdown jsonb', async () => {
    const rpc = mockRpc(
      vi.fn().mockResolvedValue({
        data: {
          floor_cents: 12000,
          source: 'product',
          profile_id: 'p-1',
          floor_abs_cents: 12000,
          floor_pct_cents: 10400,
        },
        error: null,
      })
    )

    const res = await resolveEffectiveFloor({
      productId: PRODUCT_ID,
      tierUnitCents: 130000,
      clinicId: CLINIC_ID,
    })
    expect(res.error).toBeUndefined()
    expect(res.data?.floor_cents).toBe(12000)
    expect(res.data?.source).toBe('product')
    expect(rpc).toHaveBeenCalledWith('resolve_effective_floor', {
      p_product_id: PRODUCT_ID,
      p_clinic_id: CLINIC_ID,
      p_doctor_id: null,
      p_tier_unit_cents: 130000,
      p_at: null,
    })
  })
})

// ── buildPricingMatrix ───────────────────────────────────────────────────

describe('buildPricingMatrix', () => {
  it('emits one cell per (quantity, coupon) combination in order', async () => {
    const calls: Array<{ qty: number; coupon: string | null }> = []
    mockRpc(
      vi.fn().mockImplementation(async (_rpc: string, params: Record<string, unknown>) => {
        calls.push({
          qty: params.p_quantity as number,
          coupon: (params.p_coupon_id as string | null) ?? null,
        })
        return {
          data: {
            final_unit_price_cents: 100000 + calls.length,
            pricing_profile_id: 'p-1',
            tier_id: 't-1',
            tier_unit_cents: 150000,
            pharmacy_cost_unit_cents: 50000,
            effective_floor_cents: 50000,
            floor_breakdown: { floor_cents: 50000, source: 'product' },
            coupon_id: null,
            coupon_disc_per_unit_raw_cents: 0,
            coupon_disc_per_unit_capped_cents: 0,
            coupon_capped: false,
            platform_commission_per_unit_cents: 50000,
            consultant_basis: 'TOTAL_PRICE',
            consultant_per_unit_raw_cents: 0,
            consultant_per_unit_cents: 0,
            consultant_capped: false,
            quantity: params.p_quantity,
            final_total_cents: 0,
            pharmacy_transfer_cents: 0,
            platform_commission_total_cents: 0,
            consultant_commission_total_cents: 0,
          },
          error: null,
        }
      })
    )

    const cells = await buildPricingMatrix({
      productId: PRODUCT_ID,
      quantities: [1, 2, 3],
      couponIds: ['c-A', 'c-B'],
    })

    expect(cells.length).toBe(6)
    // Order: q1×cA, q1×cB, q2×cA, q2×cB, q3×cA, q3×cB
    expect(calls.map((c) => `${c.qty}-${c.coupon}`)).toEqual([
      '1-c-A',
      '1-c-B',
      '2-c-A',
      '2-c-B',
      '3-c-A',
      '3-c-B',
    ])
    expect(cells[0]?.breakdown?.final_unit_price_cents).toBe(100001)
  })

  it('defaults to a single null-coupon column when couponIds omitted', async () => {
    const rpcCalls: Array<{ coupon: unknown }> = []
    mockRpc(
      vi.fn().mockImplementation(async (_rpc: string, params: Record<string, unknown>) => {
        rpcCalls.push({ coupon: params.p_coupon_id })
        return {
          data: {
            final_unit_price_cents: 150000,
            pricing_profile_id: 'p-1',
            tier_id: 't-1',
            tier_unit_cents: 150000,
            pharmacy_cost_unit_cents: 50000,
            effective_floor_cents: 50000,
            floor_breakdown: { floor_cents: 50000, source: 'product' },
            coupon_id: null,
            coupon_disc_per_unit_raw_cents: 0,
            coupon_disc_per_unit_capped_cents: 0,
            coupon_capped: false,
            platform_commission_per_unit_cents: 100000,
            consultant_basis: 'TOTAL_PRICE',
            consultant_per_unit_raw_cents: 0,
            consultant_per_unit_cents: 0,
            consultant_capped: false,
            quantity: params.p_quantity,
            final_total_cents: 0,
            pharmacy_transfer_cents: 0,
            platform_commission_total_cents: 0,
            consultant_commission_total_cents: 0,
          },
          error: null,
        }
      })
    )

    const cells = await buildPricingMatrix({
      productId: PRODUCT_ID,
      quantities: [1, 2],
    })
    expect(cells.length).toBe(2)
    expect(rpcCalls.every((c) => c.coupon === null)).toBe(true)
  })
})
