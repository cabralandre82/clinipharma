// @vitest-environment node
/**
 * Unit tests for the Wave 10 additions to lib/rate-limit.ts —
 * `guard()`, `hashIp()`, `extractClientIp()`, and
 * `recordViolation()`.
 *
 * The pre-existing in-memory sliding-window behaviour is covered
 * by tests/unit/lib/rate-limit.test.ts; these specs focus on the
 * HTTP contract, the IP-hashing LGPD invariant, and the fail-open
 * guarantee.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')

const adminRpcMock = vi.fn().mockResolvedValue({ data: 'row-1', error: null })
vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => ({ rpc: adminRpcMock }),
}))

// Intercept metric emissions so we can assert the right labels
// were passed without pulling in the whole metrics module.
const incCounterMock = vi.fn()
const observeHistogramMock = vi.fn()
vi.mock('@/lib/metrics', async () => {
  const actual = await vi.importActual<typeof import('@/lib/metrics')>('@/lib/metrics')
  return {
    ...actual,
    incCounter: (...args: unknown[]) => incCounterMock(...args),
    observeHistogram: (...args: unknown[]) => observeHistogramMock(...args),
  }
})

let mod: typeof import('@/lib/rate-limit')

beforeEach(async () => {
  vi.resetModules()
  adminRpcMock.mockClear()
  incCounterMock.mockClear()
  observeHistogramMock.mockClear()
  vi.stubEnv('RATE_LIMIT_IP_SALT', 'test-salt-at-least-24-chars-long!!')
  mod = await import('@/lib/rate-limit')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

function makeReq(opts?: { ip?: string; path?: string; ua?: string }): Request {
  const headers = new Headers()
  if (opts?.ip) headers.set('x-forwarded-for', opts.ip)
  if (opts?.ua) headers.set('user-agent', opts.ua)
  // `nextUrl` is only present on NextRequest, but guard() tolerates
  // its absence; we keep the plain Request to test the graceful-
  // degradation path.
  return new Request(`http://localhost${opts?.path ?? '/'}`, { headers })
}

describe('extractClientIp', () => {
  it('prefers x-forwarded-for leftmost value', () => {
    const req = new Request('http://localhost/', {
      headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
    })
    expect(mod.extractClientIp(req)).toBe('203.0.113.5')
  })

  it('falls back to x-real-ip', () => {
    const req = new Request('http://localhost/', { headers: { 'x-real-ip': '198.51.100.2' } })
    expect(mod.extractClientIp(req)).toBe('198.51.100.2')
  })

  it('returns "unknown" when no headers are set', () => {
    const req = new Request('http://localhost/')
    expect(mod.extractClientIp(req)).toBe('unknown')
  })

  it('trims whitespace around each candidate', () => {
    const req = new Request('http://localhost/', {
      headers: { 'x-forwarded-for': '   203.0.113.5   , 10.0.0.1' },
    })
    expect(mod.extractClientIp(req)).toBe('203.0.113.5')
  })
})

describe('hashIp', () => {
  it('produces a 64-char lowercase hex SHA-256', () => {
    const h = mod.hashIp('203.0.113.5')
    expect(h).toHaveLength(64)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic for the same ip+salt', () => {
    const a = mod.hashIp('203.0.113.5')
    const b = mod.hashIp('203.0.113.5')
    expect(a).toBe(b)
  })

  it('changes when the salt changes (simulated by re-importing)', async () => {
    const firstHash = mod.hashIp('203.0.113.5')
    vi.resetModules()
    vi.stubEnv('RATE_LIMIT_IP_SALT', 'totally-different-salt-value-abcdef')
    const mod2 = await import('@/lib/rate-limit')
    const secondHash = mod2.hashIp('203.0.113.5')
    expect(firstHash).not.toBe(secondHash)
  })

  it('uses the sentinel salt when env is missing (warns once)', async () => {
    vi.resetModules()
    vi.stubEnv('RATE_LIMIT_IP_SALT', '')
    const mod2 = await import('@/lib/rate-limit')
    // Explicitly delete the env var because stubEnv('') keeps it defined-but-empty.
    delete process.env.RATE_LIMIT_IP_SALT
    const g = globalThis as Record<string, unknown>
    delete g.__rate_limit_salt_warned
    const h = mod2.hashIp('203.0.113.5')
    expect(h).toHaveLength(64)
    // Second call does NOT warn again (guarded by global flag).
    mod2.hashIp('203.0.113.5')
    expect(g.__rate_limit_salt_warned).toBe(true)
  })
})

describe('guard', () => {
  it('returns null when under the limit and emits `allowed` counter', async () => {
    const limiter = mod.rateLimit({ windowMs: 60_000, max: 3 })
    const req = makeReq({ ip: '203.0.113.5' })
    const res = await mod.guard(req, limiter, 'test.bucket')
    expect(res).toBeNull()
    const outcomes = incCounterMock.mock.calls.filter((c) => c[0] === 'rate_limit_hits_total')
    expect(outcomes.at(-1)?.[1]).toMatchObject({
      bucket: 'test.bucket',
      outcome: 'allowed',
    })
  })

  it('returns 429 with Retry-After + X-RateLimit-* headers on deny', async () => {
    const limiter = mod.rateLimit({ windowMs: 60_000, max: 1 })
    const req = makeReq({ ip: '203.0.113.99' })

    // First call drains the budget.
    await mod.guard(req, limiter, 'test.deny')
    const denied = await mod.guard(req, limiter, 'test.deny')
    expect(denied).not.toBeNull()
    expect(denied!.status).toBe(429)
    expect(denied!.headers.get('Retry-After')).toBeTruthy()
    expect(denied!.headers.get('X-RateLimit-Limit')).toBe('1')
    expect(denied!.headers.get('X-RateLimit-Remaining')).toBe('0')
    expect(denied!.headers.get('X-RateLimit-Reset')).toMatch(/^\d+$/)

    const body = (await denied!.json()) as { status: number; bucket: string }
    expect(body.status).toBe(429)
    expect(body.bucket).toBe('test.deny')
  })

  it('persists violation row via recordViolation (best-effort)', async () => {
    const limiter = mod.rateLimit({ windowMs: 60_000, max: 1 })
    const req = makeReq({ ip: '198.51.100.44', ua: 'AcmeBot/1.0', path: '/api/sensitive' })
    await mod.guard(req, limiter, { bucket: 'test.persist', userId: 'user-xyz' })
    const denied = await mod.guard(req, limiter, { bucket: 'test.persist', userId: 'user-xyz' })
    expect(denied).not.toBeNull()

    // RPC is fired via a `void` promise inside guard(), so wait a
    // tick for the microtask to flush.
    await new Promise((r) => setTimeout(r, 10))
    expect(adminRpcMock).toHaveBeenCalledWith(
      'rate_limit_record',
      expect.objectContaining({
        p_bucket: 'test.persist',
        p_user_id: 'user-xyz',
        p_ip_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      })
    )

    const payload = adminRpcMock.mock.calls.at(-1)![1] as { p_metadata: Record<string, unknown> }
    expect(payload.p_metadata).toMatchObject({ ua: 'AcmeBot/1.0' })
  })

  it('uses identifier override when provided', async () => {
    const limiter = mod.rateLimit({ windowMs: 60_000, max: 1 })
    // Same IP but different user-scoped identifiers shouldn't collide.
    const a = await mod.guard(makeReq({ ip: '203.0.113.10' }), limiter, {
      bucket: 'test.iso',
      identifier: 'user:A',
    })
    const b = await mod.guard(makeReq({ ip: '203.0.113.10' }), limiter, {
      bucket: 'test.iso',
      identifier: 'user:B',
    })
    expect(a).toBeNull()
    expect(b).toBeNull()
  })

  it('fails open if the limiter throws (returns null, emits `error` outcome)', async () => {
    const throwingLimiter = {
      windowMs: 60_000,
      limit: 5,
      async check() {
        throw new Error('redis down')
      },
    }
    const req = makeReq({ ip: '203.0.113.55' })
    const res = await mod.guard(req, throwingLimiter, 'test.fail-open')
    expect(res).toBeNull()
    const outcomes = incCounterMock.mock.calls.filter((c) => c[0] === 'rate_limit_hits_total')
    expect(outcomes.at(-1)?.[1]).toMatchObject({
      bucket: 'test.fail-open',
      outcome: 'error',
    })
  })

  it('swallows rate_limit_record RPC errors silently', async () => {
    adminRpcMock.mockResolvedValueOnce({ data: null, error: { message: 'db down' } })
    const limiter = mod.rateLimit({ windowMs: 60_000, max: 1 })
    const req = makeReq({ ip: '198.51.100.77' })
    await mod.guard(req, limiter, 'test.silent-fail')
    const denied = await mod.guard(req, limiter, 'test.silent-fail')
    // Still returns the 429 — RPC failure is observability, not
    // request-flow critical.
    expect(denied!.status).toBe(429)
  })

  it('accepts a bare bucket string (shorthand)', async () => {
    const limiter = mod.rateLimit({ windowMs: 60_000, max: 1 })
    const req = makeReq({ ip: '203.0.113.88' })
    const res = await mod.guard(req, limiter, 'bare.bucket')
    expect(res).toBeNull()
  })
})

describe('Bucket', () => {
  it('exposes stable canonical bucket names', () => {
    expect(mod.Bucket.LGPD_DELETION).toBe('lgpd.deletion_request')
    expect(mod.Bucket.LGPD_EXPORT).toBe('lgpd.export')
    expect(mod.Bucket.AUTH_FORGOT).toBe('auth.forgot_password')
    expect(mod.Bucket.REGISTER_SUBMIT).toBe('register.submit')
  })
})
