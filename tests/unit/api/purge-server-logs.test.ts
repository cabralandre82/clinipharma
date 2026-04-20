// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import * as adminModule from '@/lib/db/admin'
import { attachCronGuard, loggerMock } from '@/tests/helpers/cron-guard-mock'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => loggerMock())

const CRON_SECRET = 'cron-test-secret'

function makeRequest(secret?: string) {
  return new NextRequest('http://localhost:3000/api/cron/purge-server-logs', {
    method: 'GET',
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  })
}

function serverLogsFrom(opts: { deleteError?: { message: string } | null; deletedCount?: number }) {
  const { deleteError = null, deletedCount = 0 } = opts
  return (table: string) => {
    if (table === 'server_logs') {
      return {
        delete: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue({
          data: deleteError ? null : Array(deletedCount).fill({ id: 'x' }),
          error: deleteError,
        }),
      }
    }
    return {}
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', CRON_SECRET)
})

describe('GET /api/cron/purge-server-logs', () => {
  it('returns 401 when authorization header is missing', async () => {
    const { GET } = await import('@/app/api/cron/purge-server-logs/route')
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Unauthorized')
  })

  it('returns 401 for wrong secret', async () => {
    const { GET } = await import('@/app/api/cron/purge-server-logs/route')
    const res = await GET(makeRequest('bad-secret'))
    expect(res.status).toBe(401)
  })

  it('purges both server_logs and cron_runs and returns the combined count', async () => {
    const { GET } = await import('@/app/api/cron/purge-server-logs/route')
    const stub = attachCronGuard({
      from: serverLogsFrom({ deletedCount: 42 }),
      cronRunsDelete: { data: Array(7).fill({ id: 1 }) },
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.result.purged).toBe(49)
    expect(body.result.serverLogsPurged).toBe(42)
    expect(body.result.cronRunsPurged).toBe(7)
    expect(body.result.cutoff).toBeTruthy()
  })

  it('returns purged:0 when nothing to delete on either table', async () => {
    const { GET } = await import('@/app/api/cron/purge-server-logs/route')
    const stub = attachCronGuard({ from: serverLogsFrom({}) })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(200)
    expect((await res.json()).result.purged).toBe(0)
  })

  it('returns 500 when server_logs delete fails (fatal — first step)', async () => {
    const { GET } = await import('@/app/api/cron/purge-server-logs/route')
    const stub = attachCronGuard({
      from: serverLogsFrom({ deleteError: { message: 'connection error' } }),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(500)
    expect((await res.json()).ok).toBe(false)
  })

  it('cron_runs delete failure is non-fatal — server_logs count is still returned', async () => {
    const { GET } = await import('@/app/api/cron/purge-server-logs/route')
    const stub = attachCronGuard({
      from: serverLogsFrom({ deletedCount: 10 }),
      cronRunsDelete: { data: null, error: { message: 'pg timeout' } },
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.serverLogsPurged).toBe(10)
    expect(body.result.cronRunsPurged).toBe(0)
    expect(body.result.purged).toBe(10)
  })

  it('cutoff is approximately 90 days ago', async () => {
    const { GET } = await import('@/app/api/cron/purge-server-logs/route')
    const stub = attachCronGuard({ from: serverLogsFrom({}) })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const before = Date.now()
    const res = await GET(makeRequest(CRON_SECRET))
    const { result } = await res.json()
    const cutoffMs = new Date(result.cutoff).getTime()
    const expectedMs = before - 90 * 24 * 60 * 60 * 1000

    expect(Math.abs(cutoffMs - expectedMs)).toBeLessThan(5000)
  })
})
