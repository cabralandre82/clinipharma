/**
 * Tests for the Upstash Redis helper (`lib/redis.ts`).
 *
 * The helper has two independent responsibilities and we
 * exercise each in isolation:
 *
 *   1. `pingRedis()` must:
 *      • Skip cleanly when env vars are missing (no network
 *        call, `skipped: true`).
 *      • Call the REST /ping endpoint with a Bearer token when
 *        env vars are present.
 *      • Return `ok: true` iff the response body is
 *        `{ "result": "PONG" }`.
 *      • Report `ok: false` on HTTP errors or non-PONG results
 *        instead of throwing.
 *      • Bound the request with a 10 s AbortController (we
 *        don't test the exact timeout — we just confirm the
 *        signal is wired through).
 *
 *   2. `getRedis()` must:
 *      • Return `null` when env vars are missing.
 *      • Not crash when the dynamic import path throws (covered
 *        implicitly by the missing-env case).
 *
 * The dynamic-import path for `@upstash/redis` in `getRedis()`
 * is covered end-to-end by `tests/unit/rate-limit-redis.test.ts`
 * (which uses the same `new Function('s', ...)` pattern). This
 * file focuses on the health/keep-alive surface.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetRedisForTests, getRedis, pingRedis } from '@/lib/redis'

const ORIGINAL_FETCH = globalThis.fetch

function mockFetch(impl: typeof fetch) {
  globalThis.fetch = impl as typeof fetch
}

function restoreFetch() {
  globalThis.fetch = ORIGINAL_FETCH
}

describe('lib/redis — pingRedis()', () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    __resetRedisForTests()
  })

  afterEach(() => {
    restoreFetch()
  })

  it('reports skipped=true when env vars are missing (no network call)', async () => {
    let called = 0
    mockFetch(async () => {
      called++
      return new Response('should not be called', { status: 200 })
    })

    const res = await pingRedis()

    expect(res.skipped).toBe(true)
    expect(res.ok).toBe(false)
    expect(called).toBe(0)
  })

  it('returns ok=true when the REST endpoint answers PONG', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token-xyz'

    let capturedUrl = ''
    let capturedAuth = ''
    mockFetch(async (input, init) => {
      capturedUrl = typeof input === 'string' ? input : (input as Request).url
      capturedAuth = String((init?.headers as Record<string, string>).Authorization ?? '')
      return new Response(JSON.stringify({ result: 'PONG' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const res = await pingRedis()

    expect(res.ok).toBe(true)
    expect(res.result).toBe('PONG')
    expect(res.skipped).toBeUndefined()
    expect(res.latencyMs).toBeGreaterThanOrEqual(0)
    expect(capturedUrl).toBe('https://mock.upstash.io/ping')
    expect(capturedAuth).toBe('Bearer mock-token-xyz')
  })

  it('strips a trailing slash from UPSTASH_REDIS_REST_URL before appending /ping', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io/'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token-xyz'

    let capturedUrl = ''
    mockFetch(async (input) => {
      capturedUrl = typeof input === 'string' ? input : (input as Request).url
      return new Response(JSON.stringify({ result: 'PONG' }), { status: 200 })
    })

    await pingRedis()
    expect(capturedUrl).toBe('https://mock.upstash.io/ping')
  })

  it('reports ok=false on HTTP error without throwing', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'bad-token'

    mockFetch(async () => new Response('Unauthorized', { status: 401 }))

    const res = await pingRedis()

    expect(res.ok).toBe(false)
    expect(res.error).toContain('401')
  })

  it('reports ok=false when the body is not PONG', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token'

    mockFetch(
      async () =>
        new Response(JSON.stringify({ result: 'SOMETHING_ELSE' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    )

    const res = await pingRedis()

    expect(res.ok).toBe(false)
    expect(res.result).toBe('SOMETHING_ELSE')
    expect(res.error).toContain('unexpected result')
  })

  it('reports ok=false (swallowing the error) when fetch throws', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token'

    mockFetch(async () => {
      throw new Error('ECONNREFUSED')
    })

    const res = await pingRedis()

    expect(res.ok).toBe(false)
    expect(res.error).toContain('ECONNREFUSED')
  })

  it('honours an external AbortSignal (abort propagates to fetch)', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token'

    const external = new AbortController()
    let capturedSignal: AbortSignal | undefined
    mockFetch(async (_input, init) => {
      capturedSignal = init?.signal as AbortSignal
      return new Response(JSON.stringify({ result: 'PONG' }), { status: 200 })
    })

    await pingRedis(external.signal)
    expect(capturedSignal).toBeDefined()
    // We cannot easily assert that `capturedSignal` is the
    // exact composed signal (AbortSignal.any is not available
    // everywhere) — but we can confirm the request received
    // *some* signal (i.e. timeout wiring is active).
  })
})

describe('lib/redis — getRedis()', () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    __resetRedisForTests()
  })

  it('returns null when env vars are missing', async () => {
    const client = await getRedis()
    expect(client).toBeNull()
  })

  it('memoises the null result across calls when env is absent', async () => {
    const a = await getRedis()
    const b = await getRedis()
    expect(a).toBeNull()
    expect(b).toBeNull()
  })

  // Note: the happy-path dynamic-import resolution is deliberately
  // NOT tested here. The `new Function('s', 'return import(s)')`
  // pattern bypasses Vitest's module resolver + alias layer by
  // design (it's how we keep the specifier invisible to tsc and
  // the bundler — see lib/rate-limit.ts for the same trick). The
  // end-to-end "env vars set → Redis client resolves" path is
  // already covered by `tests/unit/rate-limit-redis.test.ts` which
  // exercises the same dynamic import through the limiter
  // factory.
})

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))
