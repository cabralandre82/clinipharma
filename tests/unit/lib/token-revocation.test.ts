import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as adminModule from '@/lib/db/admin'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))

function makeAdminMock(selectResult: unknown, upsertResult = { error: null }) {
  const selectChain = {
    or: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(selectResult),
  }
  const deleteChain = {
    lt: vi.fn().mockReturnThis(),
    select: vi.fn().mockResolvedValue({ data: [{ jti: 'old' }], error: null }),
  }
  const fromFn = vi.fn().mockImplementation((table: string) => {
    if (table === 'revoked_tokens') {
      return {
        upsert: vi.fn().mockResolvedValue(upsertResult),
        select: vi.fn().mockReturnValue(selectChain),
        delete: vi.fn().mockReturnValue(deleteChain),
      }
    }
    return {}
  })
  return {
    from: fromFn,
    auth: {
      admin: {
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('isTokenRevoked', () => {
  it('returns false when token is not in blacklist', async () => {
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdminMock({ data: [], error: null }) as unknown as ReturnType<
        typeof adminModule.createAdminClient
      >
    )
    const { isTokenRevoked } = await import('@/lib/token-revocation')
    const result = await isTokenRevoked('jti-abc', 'user-1')
    expect(result).toBe(false)
  })

  it('returns true when specific jti is revoked', async () => {
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdminMock({ data: [{ jti: 'jti-abc' }], error: null }) as unknown as ReturnType<
        typeof adminModule.createAdminClient
      >
    )
    const { isTokenRevoked } = await import('@/lib/token-revocation')
    const result = await isTokenRevoked('jti-abc', 'user-1')
    expect(result).toBe(true)
  })

  it('returns true when user sentinel exists', async () => {
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdminMock({ data: [{ jti: 'user:user-1:all' }], error: null }) as unknown as ReturnType<
        typeof adminModule.createAdminClient
      >
    )
    const { isTokenRevoked } = await import('@/lib/token-revocation')
    const result = await isTokenRevoked('any-jti', 'user-1')
    expect(result).toBe(true)
  })

  it('returns false (fail open) when admin client throws', async () => {
    vi.mocked(adminModule.createAdminClient).mockImplementation(() => {
      throw new Error('DB unavailable')
    })
    const { isTokenRevoked } = await import('@/lib/token-revocation')
    const result = await isTokenRevoked('jti-xyz', 'user-2')
    expect(result).toBe(false)
  })
})

describe('revokeToken', () => {
  it('upserts a token entry into revoked_tokens', async () => {
    const mock = makeAdminMock({ data: [], error: null })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      mock as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const { revokeToken } = await import('@/lib/token-revocation')
    const exp = new Date(Date.now() + 3600_000)
    await revokeToken('jti-123', 'user-1', exp)

    expect(mock.from).toHaveBeenCalledWith('revoked_tokens')
  })
})

describe('revokeAllUserTokens', () => {
  it('calls signOut global and upserts user sentinel', async () => {
    const mock = makeAdminMock({ data: [], error: null })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      mock as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const { revokeAllUserTokens } = await import('@/lib/token-revocation')
    await revokeAllUserTokens('user-42')

    expect(mock.auth.admin.signOut).toHaveBeenCalledWith('user-42', 'global')
    expect(mock.from).toHaveBeenCalledWith('revoked_tokens')
  })
})

describe('purgeExpiredTokens', () => {
  it('deletes rows older than now and returns count', async () => {
    const mock = makeAdminMock({ data: [], error: null })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      mock as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const { purgeExpiredTokens } = await import('@/lib/token-revocation')
    const result = await purgeExpiredTokens()

    expect(result.deleted).toBe(1) // mock returns [{ jti: 'old' }]
  })

  it('throws when delete returns error', async () => {
    const mock = makeAdminMock({ data: [], error: null })
    // Override delete chain to return error
    mock.from = vi.fn().mockReturnValue({
      delete: vi.fn().mockReturnValue({
        lt: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
      }),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      mock as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const { purgeExpiredTokens } = await import('@/lib/token-revocation')
    await expect(purgeExpiredTokens()).rejects.toThrow('purgeExpiredTokens failed')
  })
})
