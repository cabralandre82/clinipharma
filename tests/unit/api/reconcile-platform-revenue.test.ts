// @vitest-environment node
/**
 * Unit tests for `GET /api/cron/reconcile-platform-revenue` (Wave 16).
 *
 * Verifies the contract of the platform-revenue reconciler:
 *
 *   1. Empty view → 200 + `gapCount:0`, no alert fired.
 *   2. Rows with |recon_gap| < threshold → 200 + `gapCount:0`. The
 *      cron must NOT alert on rounding noise.
 *   3. Rows with |recon_gap| >= threshold → 500 (cron_runs failed),
 *      counter incremented, alert dispatched with stable dedupKey.
 *   4. Query error → 500, no alert.
 *   5. Alert dispatch failure does not mask the gap-detection error.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import * as adminModule from '@/lib/db/admin'
import { attachCronGuard, loggerMock } from '@/tests/helpers/cron-guard-mock'

const CRON_SECRET = 'test-cron-secret'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => loggerMock())

const triggerAlertMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/alerts', () => ({
  triggerAlert: triggerAlertMock,
  resolveAlert: vi.fn(),
}))

const incCounter = vi.fn()
const setGauge = vi.fn()
const observeHistogram = vi.fn()
vi.mock('@/lib/metrics', async () => {
  const actual = await vi.importActual<typeof import('@/lib/metrics')>('@/lib/metrics')
  return {
    ...actual,
    incCounter: (...args: unknown[]) => incCounter(...args),
    setGauge: (...args: unknown[]) => setGauge(...args),
    observeHistogram: (...args: unknown[]) => observeHistogram(...args),
  }
})

function makeRequest(secret?: string) {
  return new NextRequest('http://localhost:3000/api/cron/reconcile-platform-revenue', {
    method: 'GET',
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  })
}

function makeViewStub(rows: Array<Record<string, unknown>>) {
  return {
    select: () => ({
      eq: () => Promise.resolve({ data: rows, error: null }),
    }),
  }
}

function makeErrorStub(message: string) {
  return {
    select: () => ({
      eq: () => Promise.resolve({ data: null, error: { message } }),
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', CRON_SECRET)
  vi.stubEnv('PLATFORM_REVENUE_RECON_MAX_SAMPLES', '20')
  vi.stubEnv('PLATFORM_REVENUE_RECON_THRESHOLD_CENTS', '1')
  triggerAlertMock.mockClear()
})

describe('GET /api/cron/reconcile-platform-revenue', () => {
  it('returns 401 without CRON_SECRET', async () => {
    const { GET } = await import('@/app/api/cron/reconcile-platform-revenue/route')
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns 200 with gapCount=0 when there are no paid orders', async () => {
    const { GET } = await import('@/app/api/cron/reconcile-platform-revenue/route')
    const stub = attachCronGuard({
      from: (table) => (table === 'platform_revenue_view' ? makeViewStub([]) : {}),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.result.gapCount).toBe(0)
    expect(body.result.totalGapCents).toBe(0)

    expect(triggerAlertMock).not.toHaveBeenCalled()
    expect(observeHistogram).toHaveBeenCalledWith(
      'platform_revenue_recon_duration_ms',
      expect.any(Number)
    )
    expect(setGauge).toHaveBeenCalledWith('platform_revenue_recon_last_run_ts', expect.any(Number))
  })

  it('does NOT alert when recon_gap is below the cents threshold', async () => {
    // 0.004 ≈ 0 cent — pure floating-point rounding noise. The cron must
    // shrug it off; otherwise every paid order with a coupon involving
    // odd-digit math would fire forever.
    const rows = [
      { order_id: 'a', order_code: 'CP-1', recon_gap: 0.004, payment_status: 'CONFIRMED' },
      { order_id: 'b', order_code: 'CP-2', recon_gap: -0.003, payment_status: 'CONFIRMED' },
    ]
    const { GET } = await import('@/app/api/cron/reconcile-platform-revenue/route')
    const stub = attachCronGuard({
      from: (table) => (table === 'platform_revenue_view' ? makeViewStub(rows) : {}),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.gapCount).toBe(0)
    expect(triggerAlertMock).not.toHaveBeenCalled()
  })

  it('returns 500 + fires alert when paid orders have a real gap', async () => {
    // Two coupon-bug victims: one R$ 9,50 phantom (the historical
    // CP-2026-000015 shape), one R$ 0,03 rounding gap that crosses the
    // 1 cent threshold and must still alert.
    const rows = [
      {
        order_id: 'aaaa',
        order_code: 'CP-2026-000015',
        gross_paid: '180.50',
        pharmacy_share: '100.00',
        consultant_share: '0',
        platform_net: '80.50',
        recorded_platform_commission: '90.00',
        recon_gap: 9.5,
        payment_status: 'CONFIRMED',
        transfer_status: 'PENDING',
      },
      {
        order_id: 'bbbb',
        order_code: 'CP-2026-000099',
        gross_paid: '50.00',
        pharmacy_share: '30.00',
        consultant_share: '0',
        platform_net: '20.00',
        recorded_platform_commission: '20.03',
        recon_gap: 0.03,
        payment_status: 'CONFIRMED',
        transfer_status: 'COMPLETED',
      },
    ]
    const { GET } = await import('@/app/api/cron/reconcile-platform-revenue/route')
    const stub = attachCronGuard({
      from: (table) => (table === 'platform_revenue_view' ? makeViewStub(rows) : {}),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/2 row\(s\) with \|recon_gap\|/)
    expect(body.error).toMatch(/953¢/) // 950 + 3 cents

    const gapIncs = incCounter.mock.calls.filter((c) => c[0] === 'platform_revenue_recon_gap_total')
    expect(gapIncs).toHaveLength(2)

    expect(triggerAlertMock).toHaveBeenCalledTimes(1)
    const alertArg = triggerAlertMock.mock.calls[0][0]
    expect(alertArg.severity).toBe('warning')
    expect(alertArg.dedupKey).toBe('platform-revenue:recon:gap')
    expect(alertArg.component).toBe('cron/reconcile-platform-revenue')
    expect(alertArg.title).toMatch(/2 pedido\(s\) com gap/)
    expect(alertArg.message).toMatch(/CP-2026-000015/)
    expect(alertArg.customDetails.gapCount).toBe(2)
    expect(alertArg.customDetails.totalGapCents).toBe(953)
  })

  it('returns 500 with descriptive error when view query fails', async () => {
    const { GET } = await import('@/app/api/cron/reconcile-platform-revenue/route')
    const stub = attachCronGuard({
      from: (table) =>
        table === 'platform_revenue_view' ? makeErrorStub('view does not exist') : {},
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/platform_revenue_view query failed/)
    expect(triggerAlertMock).not.toHaveBeenCalled()
  })

  it('does not let alert dispatch failure mask the gap error', async () => {
    const rows = [
      {
        order_id: 'aaaa',
        order_code: 'CP-1',
        recon_gap: 0.5,
        payment_status: 'CONFIRMED',
      },
    ]
    triggerAlertMock.mockRejectedValueOnce(new Error('pagerduty down'))

    const { GET } = await import('@/app/api/cron/reconcile-platform-revenue/route')
    const stub = attachCronGuard({
      from: (table) => (table === 'platform_revenue_view' ? makeViewStub(rows) : {}),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/1 row\(s\) with \|recon_gap\|/)
    const gapIncs = incCounter.mock.calls.filter((c) => c[0] === 'platform_revenue_recon_gap_total')
    expect(gapIncs).toHaveLength(1)
  })
})
