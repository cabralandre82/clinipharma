// @vitest-environment node
/**
 * Unit tests for lib/turnstile.ts — the Cloudflare Turnstile
 * server-side verifier (Wave 10).
 *
 * Fetches to `challenges.cloudflare.com` are intercepted via
 * `global.fetch` mocks so no network traffic leaves the test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const isFeatureEnabledMock = vi.fn().mockResolvedValue(false)
vi.mock('@/lib/features', () => ({ isFeatureEnabled: isFeatureEnabledMock }))

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

let mod: typeof import('@/lib/turnstile')

beforeEach(async () => {
  vi.resetModules()
  isFeatureEnabledMock.mockResolvedValue(false)
  incCounterMock.mockClear()
  observeHistogramMock.mockClear()
  // Clean env between tests.
  delete process.env.TURNSTILE_SECRET_KEY
  mod = await import('@/lib/turnstile')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('verifyTurnstile — bypass path (flag OFF)', () => {
  it('returns ok:true bypass:flag-off without hitting the network', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }))
    const result = await mod.verifyTurnstile({
      token: 'cf-token-abc',
      bucket: 'auth.forgot',
    })
    expect(result.ok).toBe(true)
    expect(result.bypass).toBe('flag-off')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('emits bypass_flag metric', async () => {
    await mod.verifyTurnstile({ token: 't', bucket: 'lgpd.deletion' })
    expect(incCounterMock).toHaveBeenCalledWith('turnstile_verify_total', {
      bucket: 'lgpd.deletion',
      outcome: 'bypass_flag',
    })
  })
})

describe('verifyTurnstile — flag ON with missing secret', () => {
  it('returns ok:false with missing-input-secret when flag on but env missing', async () => {
    isFeatureEnabledMock.mockResolvedValue(true)
    const result = await mod.verifyTurnstile({ token: 'abc', bucket: 'auth.forgot' })
    expect(result.ok).toBe(false)
    expect(result.errorCodes).toEqual(['missing-input-secret'])
  })
})

describe('verifyTurnstile — enforcement path', () => {
  beforeEach(() => {
    isFeatureEnabledMock.mockResolvedValue(true)
    vi.stubEnv('TURNSTILE_SECRET_KEY', '1x000000-secret')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rejects a missing or too-short token', async () => {
    const result = await mod.verifyTurnstile({ token: '', bucket: 'auth.forgot' })
    expect(result.ok).toBe(false)
    expect(result.errorCodes).toEqual(['missing-input-response'])
  })

  it('rejects a clearly too-short token', async () => {
    const result = await mod.verifyTurnstile({ token: 'abc', bucket: 'auth.forgot' })
    expect(result.ok).toBe(false)
    expect(result.errorCodes).toEqual(['missing-input-response'])
  })

  it('accepts success=true from Cloudflare', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true, action: 'login' }), { status: 200 })
      )
    const result = await mod.verifyTurnstile({
      token: 'a'.repeat(40),
      remoteIp: '203.0.113.5',
      bucket: 'auth.forgot',
    })
    expect(result.ok).toBe(true)
    expect(result.action).toBe('login')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const call = fetchSpy.mock.calls[0]
    expect(call[0]).toContain('challenges.cloudflare.com')
    const body = String((call[1] as RequestInit).body)
    expect(body).toContain('secret=1x000000-secret')
    expect(body).toContain(`response=${'a'.repeat(40)}`)
    expect(body).toContain('remoteip=203.0.113.5')
  })

  it('returns ok:false with error-codes on a Cloudflare failure', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          'error-codes': ['invalid-input-response'],
        }),
        { status: 200 }
      )
    )
    const result = await mod.verifyTurnstile({ token: 'a'.repeat(40), bucket: 'auth.forgot' })
    expect(result.ok).toBe(false)
    expect(result.errorCodes).toEqual(['invalid-input-response'])
    expect(result.softFailure).toBe(false)
  })

  it('flags softFailure on timeout-or-duplicate', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          'error-codes': ['timeout-or-duplicate'],
        }),
        { status: 200 }
      )
    )
    const result = await mod.verifyTurnstile({ token: 'a'.repeat(40), bucket: 'auth.forgot' })
    expect(result.ok).toBe(false)
    expect(result.softFailure).toBe(true)
    expect(incCounterMock).toHaveBeenCalledWith('turnstile_verify_total', {
      bucket: 'auth.forgot',
      outcome: 'soft_fail',
    })
  })

  it('returns internal-error on non-2xx response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('boom', { status: 502 }))
    const result = await mod.verifyTurnstile({ token: 'a'.repeat(40), bucket: 'auth.forgot' })
    expect(result.ok).toBe(false)
    expect(result.errorCodes).toEqual(['internal-error'])
  })

  it('returns internal-error when fetch throws', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network'))
    const result = await mod.verifyTurnstile({ token: 'a'.repeat(40), bucket: 'auth.forgot' })
    expect(result.ok).toBe(false)
    expect(result.errorCodes).toEqual(['internal-error'])
  })
})

describe('verifyTurnstile — required override', () => {
  it('enforces even when flag is OFF if required:true', async () => {
    isFeatureEnabledMock.mockResolvedValue(false)
    // No secret — we want to see the fail-closed path.
    const result = await mod.verifyTurnstile({
      token: 'a'.repeat(40),
      bucket: 'webhook.admin',
      required: true,
    })
    expect(result.ok).toBe(false)
    // We expect "missing secret" because env has no
    // TURNSTILE_SECRET_KEY, and required:true bypasses the flag OFF.
    expect(result.errorCodes).toEqual(['missing-input-secret'])
  })
})

describe('extractTurnstileToken', () => {
  it('reads x-turnstile-token header first', async () => {
    const req = new Request('http://x/', { headers: { 'x-turnstile-token': 'header-token' } })
    expect(await mod.extractTurnstileToken(req)).toBe('header-token')
  })

  it('reads JSON body `turnstileToken`', async () => {
    const req = new Request('http://x/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ turnstileToken: 'json-token' }),
    })
    expect(await mod.extractTurnstileToken(req)).toBe('json-token')
  })

  it('reads JSON body `cf-turnstile-response`', async () => {
    const req = new Request('http://x/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ 'cf-turnstile-response': 'cf-json' }),
    })
    expect(await mod.extractTurnstileToken(req)).toBe('cf-json')
  })

  it('reads form data cf-turnstile-response', async () => {
    const fd = new FormData()
    fd.set('cf-turnstile-response', 'form-token')
    const req = new Request('http://x/', { method: 'POST', body: fd })
    expect(await mod.extractTurnstileToken(req)).toBe('form-token')
  })

  it('returns null when no token can be found', async () => {
    const req = new Request('http://x/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ unrelated: 1 }),
    })
    expect(await mod.extractTurnstileToken(req)).toBeNull()
  })
})
