// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { File } from 'node:buffer'
import { NextRequest } from 'next/server'
import * as adminModule from '@/lib/db/admin'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({
  registrationLimiter: {
    check: vi.fn().mockResolvedValue({ ok: true, resetAt: 0 }),
  },
}))
vi.mock('resend', () => {
  function MockResend() {
    return { emails: { send: vi.fn().mockResolvedValue({ data: {}, error: null }) } }
  }
  return { Resend: MockResend }
})
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFormData(overrides: Record<string, string> = {}) {
  const fd = new FormData()
  fd.append('type', overrides.type ?? 'CLINIC')
  fd.append(
    'form_data',
    JSON.stringify({
      email: overrides.email ?? 'test@clinic.com',
      password: overrides.password ?? 'Senha@1234',
      full_name: overrides.full_name ?? 'Clínica Teste',
      trade_name: 'Clínica Teste',
      cnpj: '11.222.333/0001-81',
    })
  )
  if (overrides.draft_id) fd.append('draft_id', overrides.draft_id)
  return fd
}

function makeFormDataWithDoc(overrides: Record<string, string> = {}) {
  const fd = makeFormData(overrides)
  const blob = new Blob(['%PDF-fake'], { type: 'application/pdf' })
  fd.append('doc_CNPJ_CARD', new File([blob], 'cnpj.pdf', { type: 'application/pdf' }))
  fd.append('doc_CNPJ_CARD_label', 'Cartão CNPJ')
  return fd
}

function makeRequest(fd: FormData) {
  return new NextRequest('http://localhost:3000/api/registration/submit', {
    method: 'POST',
    body: fd,
  })
}

interface AdminOptions {
  createUserError?: unknown
  profileUpsertError?: unknown
  roleInsertError?: unknown
  registrationRequestError?: unknown
  captureProfileUpsert?: (args: unknown) => void
  captureRequestInsert?: (args: unknown) => void
  draftDeleteCalled?: { value: boolean }
}

function makeAdminClient({
  createUserError = null,
  profileUpsertError = null,
  roleInsertError = null,
  registrationRequestError = null,
  captureProfileUpsert,
  captureRequestInsert,
  draftDeleteCalled,
}: AdminOptions = {}) {
  const userId = 'user-new-1'

  return {
    auth: {
      admin: {
        createUser: vi.fn().mockResolvedValue({
          data: { user: createUserError ? null : { id: userId } },
          error: createUserError ?? null,
        }),
        deleteUser: vi.fn().mockResolvedValue({ error: null }),
      },
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          upsert: vi.fn().mockImplementation((args: unknown) => {
            captureProfileUpsert?.(args)
            return Promise.resolve({ error: profileUpsertError ?? null })
          }),
        }
      }
      if (table === 'user_roles') {
        return {
          insert: vi.fn().mockResolvedValue({ error: roleInsertError ?? null }),
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }
      }
      if (table === 'registration_requests') {
        return {
          insert: vi.fn().mockImplementation((args: unknown) => {
            captureRequestInsert?.(args)
            return {
              select: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: registrationRequestError ? null : { id: 'req-1' },
                error: registrationRequestError ?? null,
              }),
            }
          }),
        }
      }
      if (table === 'registration_drafts') {
        return {
          delete: vi.fn().mockImplementation(() => {
            if (draftDeleteCalled) draftDeleteCalled.value = true
            return {
              eq: vi.fn().mockResolvedValue({ error: null }),
            }
          }),
        }
      }
      if (table === 'notifications') {
        return { insert: vi.fn().mockResolvedValue({ error: null }) }
      }
      // Default fallback (profiles for admin lookup, etc.)
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ data: [], error: null }),
        insert: vi.fn().mockResolvedValue({ error: null }),
        upsert: vi.fn().mockResolvedValue({ error: null }),
      }
    }),
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'http://test.com/doc' } }),
      }),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Validation ────────────────────────────────────────────────────────────────

describe('POST /api/registration/submit — validation', () => {
  it('returns 400 when type or form_data is missing', async () => {
    const { POST } = await import('@/app/api/registration/submit/route')
    const fd = new FormData()
    fd.append('type', 'CLINIC')
    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(400)
  })
})

// ── Rollback on error ─────────────────────────────────────────────────────────

describe('POST /api/registration/submit — rollback on error', () => {
  it('returns 500 and rolls back auth user when profile upsert fails', async () => {
    const { POST } = await import('@/app/api/registration/submit/route')
    const admin = makeAdminClient({ profileUpsertError: { message: 'upsert failed' } })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await POST(makeRequest(makeFormData()))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Erro ao criar perfil')
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith('user-new-1')
  })

  it('returns 500 and rolls back auth user when user_roles insert fails', async () => {
    const { POST } = await import('@/app/api/registration/submit/route')
    const admin = makeAdminClient({ roleInsertError: { message: 'role failed' } })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await POST(makeRequest(makeFormData()))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Erro ao atribuir papel')
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith('user-new-1')
  })

  it('returns 500 and rolls back auth user when registration_requests insert fails', async () => {
    const { POST } = await import('@/app/api/registration/submit/route')
    const admin = makeAdminClient({ registrationRequestError: { message: 'req failed' } })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await POST(makeRequest(makeFormData()))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Erro ao registrar solicitação')
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith('user-new-1')
  })
})

// ── Status logic (PENDING vs PENDING_DOCS) ────────────────────────────────────

describe('POST /api/registration/submit — PENDING vs PENDING_DOCS', () => {
  it('creates registration with PENDING when docs are attached', async () => {
    const { POST } = await import('@/app/api/registration/submit/route')

    let capturedRequest: unknown = null
    let capturedProfile: unknown = null

    const admin = makeAdminClient({
      captureProfileUpsert: (args) => {
        capturedProfile = args
      },
      captureRequestInsert: (args) => {
        capturedRequest = args
      },
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await POST(makeRequest(makeFormDataWithDoc()))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.status).toBe('PENDING')
    expect((capturedProfile as Record<string, unknown>)?.registration_status).toBe('PENDING')
    expect((capturedRequest as Record<string, unknown>)?.status).toBe('PENDING')
  })

  it('creates registration with PENDING_DOCS when no docs are attached', async () => {
    const { POST } = await import('@/app/api/registration/submit/route')

    let capturedRequest: unknown = null
    let capturedProfile: unknown = null

    const admin = makeAdminClient({
      captureProfileUpsert: (args) => {
        capturedProfile = args
      },
      captureRequestInsert: (args) => {
        capturedRequest = args
      },
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await POST(makeRequest(makeFormData()))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.status).toBe('PENDING_DOCS')
    expect((capturedProfile as Record<string, unknown>)?.registration_status).toBe('PENDING_DOCS')
    expect((capturedRequest as Record<string, unknown>)?.status).toBe('PENDING_DOCS')
  })
})

// ── Draft cleanup ─────────────────────────────────────────────────────────────

describe('POST /api/registration/submit — draft cleanup', () => {
  it('deletes draft when draft_id is provided and submit succeeds', async () => {
    const { POST } = await import('@/app/api/registration/submit/route')

    const draftDeleteCalled = { value: false }
    const admin = makeAdminClient({ draftDeleteCalled })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const fd = makeFormData({ draft_id: 'draft-xyz-999' })
    const res = await POST(makeRequest(fd))

    expect(res.status).toBe(200)
    expect(draftDeleteCalled.value).toBe(true)
  })

  it('does NOT call draft delete when no draft_id is provided', async () => {
    const { POST } = await import('@/app/api/registration/submit/route')

    const draftDeleteCalled = { value: false }
    const admin = makeAdminClient({ draftDeleteCalled })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await POST(makeRequest(makeFormData()))

    expect(res.status).toBe(200)
    expect(draftDeleteCalled.value).toBe(false)
  })
})

// ── Doctor registration ───────────────────────────────────────────────────────

describe('POST /api/registration/submit — doctor type', () => {
  it('assigns DOCTOR role and creates request for DOCTOR type', async () => {
    const { POST } = await import('@/app/api/registration/submit/route')

    const admin = makeAdminClient()
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const fd = new FormData()
    fd.append('type', 'DOCTOR')
    fd.append(
      'form_data',
      JSON.stringify({
        email: 'dr@test.com',
        password: 'Senha@1234',
        full_name: 'Dr. João',
        crm: '123456',
        crm_state: 'SP',
        specialty: 'Dermatologia',
      })
    )

    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })
})
