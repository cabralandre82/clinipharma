// @vitest-environment node
/**
 * Unit tests for `GET /api/cron/money-reconcile` (Wave 8).
 *
 * Verifies the three contract properties of the drift reconciler:
 *
 *   1. Empty view → 200 + `driftCount:0`, no alert fired.
 *   2. Non-empty view → 500 (job failed so cron_runs is marked
 *      failed), counter incremented per row, alert dispatched with
 *      stable dedupKey.
 *   3. Query error → 500 with descriptive message, no alert.
 *
 * We mock the admin client, alerts module, and metrics so every
 * branch is observable without hitting Postgres. The cron guard
 * itself is covered by its own tests.
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
  return new NextRequest('http://localhost:3000/api/cron/money-reconcile', {
    method: 'GET',
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  })
}

function makeDriftStub(rows: Array<Record<string, unknown>>) {
  return {
    select: () => ({
      limit: () => Promise.resolve({ data: rows, error: null }),
    }),
  }
}

function makeErrorStub(message: string) {
  return {
    select: () => ({
      limit: () => Promise.resolve({ data: null, error: { message } }),
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', CRON_SECRET)
  vi.stubEnv('MONEY_RECONCILE_MAX_SAMPLES', '20')
  triggerAlertMock.mockClear()
})

describe('GET /api/cron/money-reconcile', () => {
  it('returns 401 without CRON_SECRET', async () => {
    const { GET } = await import('@/app/api/cron/money-reconcile/route')
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns 200 with driftCount=0 when view is empty', async () => {
    const { GET } = await import('@/app/api/cron/money-reconcile/route')
    const stub = attachCronGuard({
      from: (table) => (table === 'money_drift_view' ? makeDriftStub([]) : {}),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.result.driftCount).toBe(0)
    expect(body.result.sampleRows).toEqual([])

    // No alert fired on clean run.
    expect(triggerAlertMock).not.toHaveBeenCalled()
    // Metric bookkeeping still happens even on clean run.
    expect(observeHistogram).toHaveBeenCalledWith('money_reconcile_duration_ms', expect.any(Number))
    expect(setGauge).toHaveBeenCalledWith('money_reconcile_last_run_ts', expect.any(Number))
    // No per-row drift counter incremented.
    const driftIncs = incCounter.mock.calls.filter((c) => c[0] === 'money_drift_total')
    expect(driftIncs).toHaveLength(0)
  })

  it('returns 500 + fires alert when drift rows present', async () => {
    const driftRows = [
      {
        table_name: 'orders',
        row_id: '11111111-1111-1111-1111-111111111111',
        field: 'total_price',
        numeric_value: '100.00',
        cents_value: 10001,
        drift_cents: 1,
      },
      {
        table_name: 'payments',
        row_id: '22222222-2222-2222-2222-222222222222',
        field: 'gross_amount',
        numeric_value: '200.00',
        cents_value: 19999,
        drift_cents: 1,
      },
    ]
    const { GET } = await import('@/app/api/cron/money-reconcile/route')
    const stub = attachCronGuard({
      from: (table) => (table === 'money_drift_view' ? makeDriftStub(driftRows) : {}),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    // withCronGuard translates thrown errors to 500.
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/money_drift_view returned 2 row/)
    expect(body.error).toMatch(/money-drift\.md/)

    // Per-row counter incremented with correct labels.
    const driftIncs = incCounter.mock.calls.filter((c) => c[0] === 'money_drift_total')
    expect(driftIncs).toHaveLength(2)
    expect(driftIncs[0][1]).toEqual({ table: 'orders', field: 'total_price' })
    expect(driftIncs[1][1]).toEqual({ table: 'payments', field: 'gross_amount' })

    // Single alert with stable dedupKey.
    expect(triggerAlertMock).toHaveBeenCalledTimes(1)
    const alertArg = triggerAlertMock.mock.calls[0][0]
    expect(alertArg.severity).toBe('warning')
    expect(alertArg.dedupKey).toBe('money:reconcile:drift')
    expect(alertArg.component).toBe('cron/money-reconcile')
    expect(alertArg.title).toMatch(/2 row\(s\)/)
    expect(alertArg.message).toMatch(/runbook/)
    expect(alertArg.customDetails.driftCount).toBe(2)
    expect(alertArg.customDetails.sample).toHaveLength(2)
  })

  it('returns 500 when view query errors out, without firing alert', async () => {
    const { GET } = await import('@/app/api/cron/money-reconcile/route')
    const stub = attachCronGuard({
      from: (table) =>
        table === 'money_drift_view' ? makeErrorStub('relation does not exist') : {},
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/money_drift_view query failed/)

    // Query error is a different failure mode — do NOT page oncall
    // via alert (cron failure path already does that via withCronGuard).
    expect(triggerAlertMock).not.toHaveBeenCalled()
  })

  it('does not let alert dispatch failure mask the drift error', async () => {
    const driftRows = [
      {
        table_name: 'orders',
        row_id: 'id-1',
        field: 'total_price',
        numeric_value: '1.00',
        cents_value: 99,
        drift_cents: 1,
      },
    ]
    triggerAlertMock.mockRejectedValueOnce(new Error('pagerduty down'))

    const { GET } = await import('@/app/api/cron/money-reconcile/route')
    const stub = attachCronGuard({
      from: (table) => (table === 'money_drift_view' ? makeDriftStub(driftRows) : {}),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/money_drift_view returned 1 row/)
    // Counter still incremented despite alert failure.
    expect(incCounter.mock.calls.filter((c) => c[0] === 'money_drift_total')).toHaveLength(1)
  })
})
