import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSupabaseClient } from '../setup'

vi.mock('@/lib/db/server', () => ({
  createClient: vi.fn(),
}))

describe('getCurrentUser', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns null when auth.getUser returns no user', async () => {
    const { createClient } = await import('@/lib/db/server')
    vi.mocked(createClient).mockResolvedValue(
      mockSupabaseClient({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
          getSession: vi.fn(),
        },
      }) as ReturnType<typeof mockSupabaseClient>
    )

    const { getCurrentUser } = await import('@/lib/auth/session')
    const result = await getCurrentUser()
    expect(result).toBeNull()
  })

  it('returns null when getUser returns an error', async () => {
    const { createClient } = await import('@/lib/db/server')
    vi.mocked(createClient).mockResolvedValue(
      mockSupabaseClient({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'Error' } }),
          getSession: vi.fn(),
        },
      }) as ReturnType<typeof mockSupabaseClient>
    )

    const { getCurrentUser } = await import('@/lib/auth/session')
    const result = await getCurrentUser()
    expect(result).toBeNull()
  })

  it('returns null when profile is not found', async () => {
    const { createClient } = await import('@/lib/db/server')
    const fakeClient = mockSupabaseClient()
    const qb = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    fakeClient.from = vi.fn().mockReturnValue(qb)
    vi.mocked(createClient).mockResolvedValue(fakeClient as ReturnType<typeof mockSupabaseClient>)

    const { getCurrentUser } = await import('@/lib/auth/session')
    const result = await getCurrentUser()
    expect(result).toBeNull()
  })

  it('returns profile with roles when user exists', async () => {
    const { createClient } = await import('@/lib/db/server')
    const fakeClient = mockSupabaseClient()
    const profileData = {
      id: 'user-123',
      full_name: 'André',
      email: 'andre@test.com',
      is_active: true,
      registration_status: 'APPROVED',
      notification_preferences: {},
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    }

    let callCount = 0
    fakeClient.from = vi.fn().mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) return Promise.resolve({ data: profileData, error: null })
        return Promise.resolve({ data: null, error: null })
      }),
    }))

    vi.mocked(createClient).mockResolvedValue(fakeClient as ReturnType<typeof mockSupabaseClient>)

    const { getCurrentUser } = await import('@/lib/auth/session')
    const result = await getCurrentUser()
    expect(result).not.toBeNull()
    expect(result?.email).toBe('andre@test.com')
    expect(Array.isArray(result?.roles)).toBe(true)
  })
})

describe('requireAuth', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('throws UNAUTHORIZED when getCurrentUser returns null', async () => {
    const { createClient } = await import('@/lib/db/server')
    vi.mocked(createClient).mockResolvedValue(
      mockSupabaseClient({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
          getSession: vi.fn(),
        },
      }) as ReturnType<typeof mockSupabaseClient>
    )

    const { requireAuth } = await import('@/lib/auth/session')
    await expect(requireAuth()).rejects.toThrow('UNAUTHORIZED')
  })
})

describe('getSession (deprecated)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns null when no session', async () => {
    const { createClient } = await import('@/lib/db/server')
    vi.mocked(createClient).mockResolvedValue(
      mockSupabaseClient() as ReturnType<typeof mockSupabaseClient>
    )

    const { getSession } = await import('@/lib/auth/session')
    const result = await getSession()
    expect(result).toBeNull()
  })
})
