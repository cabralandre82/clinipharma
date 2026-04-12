// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import * as adminModule from '@/lib/db/admin'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}))

const CRON_SECRET = 'test-cron-secret'

function makeRequest(secret?: string) {
  return new NextRequest('http://localhost:3000/api/cron/purge-drafts', {
    method: 'GET',
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  })
}

function makePurgeAdmin({ deleteError = null, deletedIds = ['d1', 'd2'] } = {}) {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'registration_drafts') {
        return {
          delete: vi.fn().mockReturnThis(),
          lt: vi.fn().mockReturnThis(),
          select: vi.fn().mockResolvedValue({
            data: deleteError ? null : deletedIds.map((id) => ({ id })),
            error: deleteError ?? null,
          }),
        }
      }
      return {}
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', CRON_SECRET)
})

describe('GET /api/cron/purge-drafts', () => {
  it('returns 401 when authorization header is missing', async () => {
    const { GET } = await import('@/app/api/cron/purge-drafts/route')
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 401 when secret is wrong', async () => {
    const { GET } = await import('@/app/api/cron/purge-drafts/route')
    const res = await GET(makeRequest('wrong-secret'))
    expect(res.status).toBe(401)
  })

  it('returns ok:true with purged count when drafts are deleted', async () => {
    const { GET } = await import('@/app/api/cron/purge-drafts/route')
    const admin = makePurgeAdmin({ deletedIds: ['d1', 'd2', 'd3'] })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.purged).toBe(3)
    expect(body.ran_at).toBeDefined()
  })

  it('returns ok:true with purged:0 when no expired drafts exist', async () => {
    const { GET } = await import('@/app/api/cron/purge-drafts/route')
    const admin = makePurgeAdmin({ deletedIds: [] })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.purged).toBe(0)
  })

  it('returns 500 when DB delete fails', async () => {
    const { GET } = await import('@/app/api/cron/purge-drafts/route')
    const admin = makePurgeAdmin({ deleteError: { message: 'db error' } })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })
})
