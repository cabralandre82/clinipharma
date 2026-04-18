// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import * as adminModule from '@/lib/db/admin'
import { attachCronGuard, loggerMock } from '@/tests/helpers/cron-guard-mock'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => loggerMock())

const CRON_SECRET = 'test-cron-secret'

function makeRequest(secret?: string) {
  return new NextRequest('http://localhost:3000/api/cron/verify-audit-chain', {
    method: 'GET',
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', CRON_SECRET)
  vi.stubEnv('AUDIT_CHAIN_VERIFY_LOOKBACK_HOURS', '48')
  vi.stubEnv('AUDIT_CHAIN_VERIFY_MAX_ROWS', '1000')
})

describe('GET /api/cron/verify-audit-chain', () => {
  it('returns 401 without CRON_SECRET', async () => {
    const { GET } = await import('@/app/api/cron/verify-audit-chain/route')
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns 200 with scanned=0 when audit_logs window is empty', async () => {
    const { GET } = await import('@/app/api/cron/verify-audit-chain/route')
    const stub = attachCronGuard({
      from: () => ({}),
      rpcHandlers: {
        verify_audit_chain: () =>
          Promise.resolve({
            data: [
              {
                scanned_rows: 0,
                inconsistent_count: 0,
                first_broken_seq: null,
                first_broken_id: null,
                verified_from: '2026-04-16T00:00:00Z',
                verified_to: '2026-04-18T00:00:00Z',
              },
            ],
            error: null,
          }),
      },
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.result.scanned).toBe(0)
    expect(body.result.inconsistent).toBe(0)
    expect(body.result.lookbackHours).toBe(48)
  })

  it('returns 200 when all rows hash-verify cleanly', async () => {
    const { GET } = await import('@/app/api/cron/verify-audit-chain/route')
    const stub = attachCronGuard({
      from: () => ({}),
      rpcHandlers: {
        verify_audit_chain: () =>
          Promise.resolve({
            data: [
              {
                scanned_rows: 42,
                inconsistent_count: 0,
                first_broken_seq: null,
                first_broken_id: null,
                verified_from: '2026-04-16T00:00:00Z',
                verified_to: '2026-04-18T00:00:00Z',
              },
            ],
            error: null,
          }),
      },
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.result.scanned).toBe(42)
    expect(body.result.inconsistent).toBe(0)
  })

  it('returns 500 (job failed) when tampering is detected', async () => {
    const { GET } = await import('@/app/api/cron/verify-audit-chain/route')
    const stub = attachCronGuard({
      from: () => ({}),
      rpcHandlers: {
        verify_audit_chain: () =>
          Promise.resolve({
            data: [
              {
                scanned_rows: 42,
                inconsistent_count: 2,
                first_broken_seq: 1337,
                first_broken_id: '11111111-1111-1111-1111-111111111111',
                verified_from: '2026-04-16T00:00:00Z',
                verified_to: '2026-04-18T00:00:00Z',
              },
            ],
            error: null,
          }),
      },
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/tampered/)
    expect(body.error).toMatch(/1337/)
  })

  it('returns 500 (job failed) when RPC itself errors', async () => {
    const { GET } = await import('@/app/api/cron/verify-audit-chain/route')
    const stub = attachCronGuard({
      from: () => ({}),
      rpcHandlers: {
        verify_audit_chain: () =>
          Promise.resolve({
            data: null,
            error: { message: 'server overloaded', code: '53300' },
          }),
      },
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/verify_audit_chain RPC failed/)
  })

  it('honors AUDIT_CHAIN_VERIFY_LOOKBACK_HOURS env override', async () => {
    vi.stubEnv('AUDIT_CHAIN_VERIFY_LOOKBACK_HOURS', '24')
    vi.resetModules() // re-evaluate module-level LOOKBACK_HOURS

    const captured: Array<{ p_start?: string; p_end?: string; p_max_rows?: number }> = []
    const { GET } = await import('@/app/api/cron/verify-audit-chain/route')
    const stub = attachCronGuard({
      from: () => ({}),
      rpcHandlers: {
        verify_audit_chain: (args) => {
          captured.push(args as (typeof captured)[number])
          return Promise.resolve({
            data: [
              {
                scanned_rows: 0,
                inconsistent_count: 0,
                first_broken_seq: null,
                first_broken_id: null,
                verified_from: '',
                verified_to: '',
              },
            ],
            error: null,
          })
        },
      },
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.lookbackHours).toBe(24)

    expect(captured).toHaveLength(1)
    const startMs = Date.parse(captured[0].p_start ?? '')
    const endMs = Date.parse(captured[0].p_end ?? '')
    const deltaHours = (endMs - startMs) / 3600_000
    expect(Math.round(deltaHours)).toBe(24)
    expect(captured[0].p_max_rows).toBe(1000)
  })
})
