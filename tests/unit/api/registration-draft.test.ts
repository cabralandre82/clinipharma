// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import * as adminModule from '@/lib/db/admin'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({
  registrationLimiter: {
    check: vi.fn().mockResolvedValue({ ok: true, resetAt: 0 }),
  },
}))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}))

function makeRequest(body: object, ip = '1.2.3.4') {
  return new NextRequest('http://localhost:3000/api/registration/draft', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}

function makeDraftAdmin({ insertError = null }: { insertError?: unknown } = {}) {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'registration_drafts') {
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: insertError ? null : { id: 'draft-abc-123' },
            error: insertError ?? null,
          }),
        }
      }
      return {}
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/registration/draft', () => {
  it('returns draft_id on valid clinic request', async () => {
    const { POST } = await import('@/app/api/registration/draft/route')
    const admin = makeDraftAdmin()
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await POST(
      makeRequest({
        type: 'CLINIC',
        form_data: { email: 'clinica@test.com', full_name: 'Clínica Teste', trade_name: 'CT' },
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.draft_id).toBe('draft-abc-123')
  })

  it('returns draft_id on valid doctor request', async () => {
    const { POST } = await import('@/app/api/registration/draft/route')
    const admin = makeDraftAdmin()
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await POST(
      makeRequest({
        type: 'DOCTOR',
        form_data: { email: 'dr@test.com', full_name: 'Dr. Teste', crm: '123456' },
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.draft_id).toBe('draft-abc-123')
  })

  it('returns 400 when type is missing', async () => {
    const { POST } = await import('@/app/api/registration/draft/route')

    const res = await POST(
      makeRequest({ form_data: { email: 'test@test.com', full_name: 'Teste' } })
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Dados inválidos')
  })

  it('returns 400 when form_data has no email', async () => {
    const { POST } = await import('@/app/api/registration/draft/route')

    const res = await POST(makeRequest({ type: 'CLINIC', form_data: { full_name: 'Sem Email' } }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Dados inválidos')
  })

  it('returns 400 when form_data is absent', async () => {
    const { POST } = await import('@/app/api/registration/draft/route')

    const res = await POST(makeRequest({ type: 'CLINIC' }))
    expect(res.status).toBe(400)
  })

  it('returns 429 when rate-limited', async () => {
    const { registrationLimiter } = await import('@/lib/rate-limit')
    vi.mocked(registrationLimiter.check).mockResolvedValueOnce({
      ok: false,
      resetAt: Date.now() + 60_000,
      remaining: 0,
      limit: 3,
    })

    const { POST } = await import('@/app/api/registration/draft/route')
    const res = await POST(
      makeRequest({ type: 'CLINIC', form_data: { email: 'x@test.com', full_name: 'X' } })
    )
    expect(res.status).toBe(429)
  })

  it('returns 500 when DB insert fails', async () => {
    const { POST } = await import('@/app/api/registration/draft/route')
    const admin = makeDraftAdmin({ insertError: { message: 'db error' } })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await POST(
      makeRequest({
        type: 'CLINIC',
        form_data: { email: 'fail@test.com', full_name: 'Fail Teste' },
      })
    )
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Erro ao salvar rascunho')
  })
})
