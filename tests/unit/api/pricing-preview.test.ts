// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/session', () => ({ getCurrentUser: vi.fn() }))
vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({
  apiLimiter: { check: vi.fn().mockResolvedValue({ ok: true, resetAt: 0 }) },
}))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))
vi.mock('@/lib/services/pricing-engine.server', () => ({
  computeUnitPrice: vi.fn(),
}))

import * as sessionModule from '@/lib/auth/session'
import * as adminModule from '@/lib/db/admin'
import * as engineModule from '@/lib/services/pricing-engine.server'
import * as rlModule from '@/lib/rate-limit'
import { GET } from '@/app/api/pricing/preview/route'

const PRODUCT_ID = '22222222-2222-2222-2222-222222222222'
const CLINIC_ID = '33333333-3333-3333-3333-333333333333'

function buildReq(qs: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/pricing/preview')
  for (const [k, v] of Object.entries(qs)) url.searchParams.set(k, v)
  return new NextRequest(url, {
    method: 'GET',
    headers: { 'x-forwarded-for': '127.0.0.1' },
  })
}

const SUPER_ADMIN_USER = {
  id: 'admin-1',
  roles: ['SUPER_ADMIN'] as const,
  full_name: 'Admin',
  email: 'a@x.com',
  is_active: true,
  registration_status: 'APPROVED' as const,
  notification_preferences: {},
  created_at: '2026',
  updated_at: '2026',
}

const CLINIC_USER = {
  id: 'clinic-user-1',
  roles: ['CLINIC_ADMIN'] as const,
  full_name: 'Clinic Admin',
  email: 'c@x.com',
  is_active: true,
  registration_status: 'APPROVED' as const,
  notification_preferences: {},
  created_at: '2026',
  updated_at: '2026',
}

const HAPPY_BREAKDOWN = {
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
  final_unit_price_cents: 150000,
  platform_commission_per_unit_cents: 100000,
  consultant_basis: 'TOTAL_PRICE',
  consultant_per_unit_raw_cents: 0,
  consultant_per_unit_cents: 0,
  consultant_capped: false,
  quantity: 1,
  final_total_cents: 150000,
  pharmacy_transfer_cents: 50000,
  platform_commission_total_cents: 100000,
  consultant_commission_total_cents: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(rlModule.apiLimiter.check).mockResolvedValue({ ok: true, resetAt: 0 })
})

describe('/api/pricing/preview', () => {
  it('401 when no user', async () => {
    vi.mocked(sessionModule.getCurrentUser).mockResolvedValue(null)
    const r = await GET(buildReq({ product_id: PRODUCT_ID, quantity: '1' }))
    expect(r.status).toBe(401)
  })

  it('429 when rate-limited', async () => {
    vi.mocked(rlModule.apiLimiter.check).mockResolvedValue({ ok: false, resetAt: 0 })
    const r = await GET(buildReq({ product_id: PRODUCT_ID, quantity: '1' }))
    expect(r.status).toBe(429)
  })

  it('400 when product_id missing', async () => {
    vi.mocked(sessionModule.getCurrentUser).mockResolvedValue(SUPER_ADMIN_USER)
    const r = await GET(buildReq({ quantity: '1' }))
    expect(r.status).toBe(400)
  })

  it('400 when quantity invalid', async () => {
    vi.mocked(sessionModule.getCurrentUser).mockResolvedValue(SUPER_ADMIN_USER)
    const r = await GET(buildReq({ product_id: PRODUCT_ID, quantity: '0' }))
    expect(r.status).toBe(400)
  })

  it('returns ok:true breakdown for super-admin (clinic_id from URL trusted)', async () => {
    vi.mocked(sessionModule.getCurrentUser).mockResolvedValue(SUPER_ADMIN_USER)
    vi.mocked(engineModule.computeUnitPrice).mockResolvedValue({
      data: HAPPY_BREAKDOWN,
      error: undefined,
    })

    const r = await GET(buildReq({ product_id: PRODUCT_ID, quantity: '2', clinic_id: CLINIC_ID }))
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.ok).toBe(true)
    expect(body.breakdown.final_unit_price_cents).toBe(150000)
    const args = vi.mocked(engineModule.computeUnitPrice).mock.calls[0]?.[0]
    expect(args?.clinicId).toBe(CLINIC_ID)
  })

  it('non-admin cannot pass clinic_id via URL — server resolves from session', async () => {
    vi.mocked(sessionModule.getCurrentUser).mockResolvedValue(CLINIC_USER)
    const eqMock = vi.fn().mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue({
        data: { clinic_id: 'clinic-from-session' },
        error: null,
      }),
    })
    const fromMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ eq: eqMock }),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: fromMock,
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)
    vi.mocked(engineModule.computeUnitPrice).mockResolvedValue({
      data: HAPPY_BREAKDOWN,
      error: undefined,
    })

    // Even though URL says clinic_id=other-clinic, server must IGNORE it.
    const r = await GET(
      buildReq({
        product_id: PRODUCT_ID,
        quantity: '1',
        clinic_id: 'attacker-target-clinic',
      })
    )
    expect(r.status).toBe(200)
    const args = vi.mocked(engineModule.computeUnitPrice).mock.calls[0]?.[0]
    expect(args?.clinicId).toBe('clinic-from-session')
    expect(args?.doctorId).toBeNull()
  })

  it('returns ok:false reason on no_active_profile (200)', async () => {
    vi.mocked(sessionModule.getCurrentUser).mockResolvedValue(SUPER_ADMIN_USER)
    vi.mocked(engineModule.computeUnitPrice).mockResolvedValue({
      data: undefined,
      error: { reason: 'no_active_profile' },
    })

    const r = await GET(buildReq({ product_id: PRODUCT_ID, quantity: '1' }))
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.ok).toBe(false)
    expect(body.reason).toBe('no_active_profile')
  })

  it('returns ok:false reason on no_tier_for_quantity (200)', async () => {
    vi.mocked(sessionModule.getCurrentUser).mockResolvedValue(SUPER_ADMIN_USER)
    vi.mocked(engineModule.computeUnitPrice).mockResolvedValue({
      data: undefined,
      error: { reason: 'no_tier_for_quantity' },
    })

    const r = await GET(buildReq({ product_id: PRODUCT_ID, quantity: '999' }))
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.ok).toBe(false)
    expect(body.reason).toBe('no_tier_for_quantity')
  })

  it('returns 502 on rpc_unavailable', async () => {
    vi.mocked(sessionModule.getCurrentUser).mockResolvedValue(SUPER_ADMIN_USER)
    vi.mocked(engineModule.computeUnitPrice).mockResolvedValue({
      data: undefined,
      error: { reason: 'rpc_unavailable' },
    })

    const r = await GET(buildReq({ product_id: PRODUCT_ID, quantity: '1' }))
    expect(r.status).toBe(502)
    const body = await r.json()
    expect(body.ok).toBe(false)
    expect(body.reason).toBe('rpc_unavailable')
  })
})
