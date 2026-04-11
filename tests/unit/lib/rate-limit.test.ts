/**
 * Unit tests for lib/rate-limit.ts
 * Tests the in-memory backend (Redis path tested via integration).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Ensure UPSTASH env vars are not set — force in-memory backend
vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')

// Import after env stubs so the module sees the correct env
let rateLimit: typeof import('@/lib/rate-limit').rateLimit
let authLimiter: typeof import('@/lib/rate-limit').authLimiter

beforeEach(async () => {
  vi.resetModules()
  const mod = await import('@/lib/rate-limit')
  rateLimit = mod.rateLimit
  authLimiter = mod.authLimiter
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('rateLimit — in-memory backend', () => {
  it('allows requests below the limit', async () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 5 })
    const result = await limiter.check('test:ip:1')
    expect(result.ok).toBe(true)
    expect(result.remaining).toBe(4)
  })

  it('blocks requests once limit is reached', async () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 3 })
    const key = `test:block:${Date.now()}`

    await limiter.check(key)
    await limiter.check(key)
    await limiter.check(key)
    const blocked = await limiter.check(key)

    expect(blocked.ok).toBe(false)
    expect(blocked.remaining).toBe(0)
  })

  it('tracks remaining count correctly', async () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 5 })
    const key = `test:remaining:${Date.now()}`

    const r1 = await limiter.check(key)
    expect(r1.remaining).toBe(4)

    const r2 = await limiter.check(key)
    expect(r2.remaining).toBe(3)

    const r3 = await limiter.check(key)
    expect(r3.remaining).toBe(2)
  })

  it('resets after window expires', async () => {
    const limiter = rateLimit({ windowMs: 50, max: 1 })
    const key = `test:reset:${Date.now()}`

    await limiter.check(key)
    const blocked = await limiter.check(key)
    expect(blocked.ok).toBe(false)

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 60))

    const after = await limiter.check(key)
    expect(after.ok).toBe(true)
  })

  it('isolates different identifiers', async () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 1 })

    const a = await limiter.check(`key-a:${Date.now()}`)
    const b = await limiter.check(`key-b:${Date.now()}`)

    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
  })

  it('provides resetAt timestamp in the future', async () => {
    const before = Date.now()
    const limiter = rateLimit({ windowMs: 60_000, max: 5 })
    const result = await limiter.check(`test:resetat:${Date.now()}`)
    expect(result.resetAt).toBeGreaterThan(before)
  })

  it('returns cached limiter for same options', async () => {
    const l1 = rateLimit({ windowMs: 60_000, max: 10 })
    const l2 = rateLimit({ windowMs: 60_000, max: 10 })
    // Should be the same object (cached)
    expect(l1).toBe(l2)
  })

  it('authLimiter allows up to max requests', async () => {
    const key = `auth:${Date.now()}`
    let lastResult = await authLimiter.check(key)
    expect(lastResult.ok).toBe(true)

    // Exhaust the limit
    for (let i = 1; i < 5; i++) {
      lastResult = await authLimiter.check(key)
    }

    // 6th request should be blocked
    const blocked = await authLimiter.check(key)
    expect(blocked.ok).toBe(false)
  })
})
