// @vitest-environment node
/**
 * Unit tests for `GET /api/cron/pricing-health-check` (PR-E of ADR-001).
 *
 * Pin the cron contract:
 *   1. Steady state (every TIERED has a profile) → returns
 *      missing=0, no alert, gauge=0.
 *   2. One or more TIERED products without profile → 200, alert
 *      fires (severity warning), gauge reflects the count, sample
 *      lists product slugs.
 *   3. Empty TIERED list (no TIERED products configured) → 200,
 *      missing=0, no alert.
 *   4. DB error on the products query → cron throws (cron-guard
 *      marks it failed, on-call is paged via the standard path).
 *   5. We DO NOT throw when missing>0. Throwing would page on-call
 *      for what is operationally a super-admin task.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import * as adminModule from '@/lib/db/admin'
import { attachCronGuard, loggerMock } from '@/tests/helpers/cron-guard-mock'

const CRON_SECRET = 'test-cron-secret'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => loggerMock())

const triggerAlertMock = vi.fn().mockResolvedValue({ delivered: ['log'], deduped: false })
vi.mock('@/lib/alerts', () => ({ triggerAlert: triggerAlertMock }))

interface FromBuilder {
  select: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  in: ReturnType<typeof vi.fn>
  is: ReturnType<typeof vi.fn>
}

function buildProductsBuilder(resolved: { data?: unknown; error?: unknown }): FromBuilder {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue(resolved),
  } as FromBuilder
  // Two .eq() calls chained: pricing_mode + active. Last `.eq()`
  // returns a thenable so awaiting `.eq()` returns the result.
  let eqCount = 0
  builder.eq = vi.fn().mockImplementation(() => {
    eqCount += 1
    if (eqCount >= 2) {
      // Second eq is the await target: return a thenable.
      return {
        then: (onResolve: (v: unknown) => unknown) => onResolve(resolved),
      }
    }
    return builder
  })
  return builder
}

function buildProfilesBuilder(resolved: { data?: unknown; error?: unknown }): FromBuilder {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue(resolved),
  } as FromBuilder
  return builder
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', CRON_SECRET)
})

function makeReq() {
  return new NextRequest('http://localhost/api/cron/pricing-health-check', {
    method: 'GET',
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  })
}

function attachAdmin(productsResult: unknown, profilesResult: unknown = { data: [], error: null }) {
  const productsBuilder = buildProductsBuilder(
    productsResult as { data?: unknown; error?: unknown }
  )
  const profilesBuilder = buildProfilesBuilder(
    profilesResult as { data?: unknown; error?: unknown }
  )

  const stub = attachCronGuard({
    from: (table) => {
      if (table === 'products') return productsBuilder
      if (table === 'pricing_profiles') return profilesBuilder
      return {}
    },
  })
  vi.mocked(adminModule.createAdminClient).mockReturnValue(
    stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
  )
}

describe('GET /api/cron/pricing-health-check', () => {
  it('returns missing=0 when there are no TIERED products', async () => {
    attachAdmin({ data: [], error: null })
    const { GET } = await import('@/app/api/cron/pricing-health-check/route')
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { result: { scanned: number; missing: number } }
    expect(body.result.scanned).toBe(0)
    expect(body.result.missing).toBe(0)
    expect(triggerAlertMock).not.toHaveBeenCalled()
  })

  it('returns missing=0 when every TIERED product has a profile', async () => {
    attachAdmin(
      {
        data: [
          { id: 'P1', slug: 'tirzepatida-60mg', name: 'Tirzepatida 60mg' },
          { id: 'P2', slug: 'tirzepatida-90mg', name: 'Tirzepatida 90mg' },
        ],
        error: null,
      },
      { data: [{ product_id: 'P1' }, { product_id: 'P2' }], error: null }
    )
    const { GET } = await import('@/app/api/cron/pricing-health-check/route')
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { result: { scanned: number; missing: number } }
    expect(body.result.scanned).toBe(2)
    expect(body.result.missing).toBe(0)
    expect(triggerAlertMock).not.toHaveBeenCalled()
  })

  it('fires a warning alert when one or more TIERED products lack a profile', async () => {
    attachAdmin(
      {
        data: [
          { id: 'P1', slug: 'tirzepatida-60mg', name: 'Tirzepatida 60mg' },
          { id: 'P2', slug: 'tirzepatida-90mg', name: 'Tirzepatida 90mg' },
          { id: 'P3', slug: 'semaglutida-15mg', name: 'Semaglutida 15mg' },
        ],
        error: null,
      },
      { data: [{ product_id: 'P1' }], error: null }
    )
    const { GET } = await import('@/app/api/cron/pricing-health-check/route')
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      result: { scanned: number; missing: number; sample: Array<{ slug: string }> }
    }
    expect(body.result.scanned).toBe(3)
    expect(body.result.missing).toBe(2)
    expect(body.result.sample.map((s) => s.slug).sort()).toEqual([
      'semaglutida-15mg',
      'tirzepatida-90mg',
    ])
    expect(triggerAlertMock).toHaveBeenCalledTimes(1)
    const alertArg = triggerAlertMock.mock.calls[0][0] as {
      severity: string
      dedupKey: string
      title: string
    }
    expect(alertArg.severity).toBe('warning')
    expect(alertArg.dedupKey).toBe('pricing-health:profiles-missing')
    expect(alertArg.title).toMatch(/2 produto\(s\)/)
  })

  it('does NOT throw when missing>0 (operational, not data-integrity)', async () => {
    attachAdmin(
      {
        data: [{ id: 'P1', slug: 'orphan', name: 'Orphan TIERED' }],
        error: null,
      },
      { data: [], error: null }
    )
    const { GET } = await import('@/app/api/cron/pricing-health-check/route')
    // Should resolve, not reject.
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { result: { missing: number } }
    expect(body.result.missing).toBe(1)
  })

  it('throws when the products query fails (cron-guard marks failure)', async () => {
    attachAdmin({ data: null, error: { message: 'boom' } }, { data: [], error: null })
    const { GET } = await import('@/app/api/cron/pricing-health-check/route')
    const res = await GET(makeReq())
    // cron-guard catches the throw and returns 500 + body
    // { ok:false, error } — same shape every other failing cron uses.
    expect(res.status).toBe(500)
    const body = (await res.json()) as { ok: boolean; error?: string }
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/products query failed/i)
  })
})
