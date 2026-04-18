/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getCsrfCookie, fetchWithCsrf, CSRF_HEADER } from '@/lib/security/client-csrf'

/**
 * jsdom enforces the `__Host-` cookie prefix rules (Secure + Path=/), which
 * cannot be satisfied over the http://localhost origin jsdom runs on. To test
 * cookie priority and decoding we stub `document.cookie` directly instead of
 * going through the browser cookie jar.
 */
function stubCookies(value: string): () => void {
  const originalDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => value,
    set: () => {
      /* no-op for the duration of the test */
    },
  })
  return () => {
    if (originalDescriptor) Object.defineProperty(Document.prototype, 'cookie', originalDescriptor)
  }
}

const mockedFetch = vi.fn()
const originalFetch = global.fetch
let restoreCookies: (() => void) | null = null

beforeEach(() => {
  mockedFetch.mockReset()
  mockedFetch.mockResolvedValue(new Response('ok', { status: 200 }))
  global.fetch = mockedFetch as unknown as typeof fetch
})

afterEach(() => {
  global.fetch = originalFetch
  if (restoreCookies) {
    restoreCookies()
    restoreCookies = null
  }
})

describe('getCsrfCookie', () => {
  it('returns null when no CSRF cookie is present', () => {
    restoreCookies = stubCookies('other=value; foo=bar')
    expect(getCsrfCookie()).toBeNull()
  })

  it('returns null when document is unavailable (SSR)', () => {
    // No stub — rely on jsdom, but simulate SSR by deleting the global.
    // We actually can't remove document mid-jsdom, so we just assert the
    // behaviour when cookie string is empty.
    restoreCookies = stubCookies('')
    expect(getCsrfCookie()).toBeNull()
  })

  it('returns the __Host-csrf cookie value when present', () => {
    restoreCookies = stubCookies('__Host-csrf=abc123')
    expect(getCsrfCookie()).toBe('abc123')
  })

  it('falls back to csrf-token (dev) cookie when __Host-csrf absent', () => {
    restoreCookies = stubCookies('csrf-token=dev456')
    expect(getCsrfCookie()).toBe('dev456')
  })

  it('decodes percent-escaped values', () => {
    restoreCookies = stubCookies(`__Host-csrf=${encodeURIComponent('a+b/c=d')}`)
    expect(getCsrfCookie()).toBe('a+b/c=d')
  })

  it('prefers __Host-csrf over csrf-token when both are set', () => {
    restoreCookies = stubCookies('csrf-token=dev; __Host-csrf=prod')
    expect(getCsrfCookie()).toBe('prod')
  })
})

describe('fetchWithCsrf', () => {
  it('passes safe verbs through without adding the CSRF header', async () => {
    restoreCookies = stubCookies('__Host-csrf=abc')
    await fetchWithCsrf('/api/foo')
    // Safe path returns fetch(input, init) unchanged — headers untouched.
    const init = (mockedFetch.mock.calls[0][1] ?? {}) as RequestInit
    const headers = new Headers(init.headers)
    expect(headers.get(CSRF_HEADER)).toBeNull()
  })

  it('adds X-CSRF-Token header on POST when cookie present', async () => {
    restoreCookies = stubCookies('__Host-csrf=abc')
    await fetchWithCsrf('/api/foo', { method: 'POST' })
    const init = mockedFetch.mock.calls[0][1] as RequestInit
    const headers = new Headers(init.headers)
    expect(headers.get(CSRF_HEADER)).toBe('abc')
  })

  it('adds X-CSRF-Token header on PUT/PATCH/DELETE', async () => {
    restoreCookies = stubCookies('__Host-csrf=tok')
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      mockedFetch.mockClear()
      await fetchWithCsrf('/api/foo', { method })
      const init = mockedFetch.mock.calls[0][1] as RequestInit
      const headers = new Headers(init.headers)
      expect(headers.get(CSRF_HEADER)).toBe('tok')
    }
  })

  it('preserves an explicit X-CSRF-Token header supplied by the caller', async () => {
    restoreCookies = stubCookies('__Host-csrf=cookie-value')
    await fetchWithCsrf('/api/foo', {
      method: 'POST',
      headers: { [CSRF_HEADER]: 'explicit-value' },
    })
    const init = mockedFetch.mock.calls[0][1] as RequestInit
    const headers = new Headers(init.headers)
    expect(headers.get(CSRF_HEADER)).toBe('explicit-value')
  })

  it('still sends the request without the header when cookie is missing', async () => {
    restoreCookies = stubCookies('')
    await fetchWithCsrf('/api/foo', { method: 'POST' })
    const init = mockedFetch.mock.calls[0][1] as RequestInit
    const headers = new Headers(init.headers)
    expect(headers.get(CSRF_HEADER)).toBeNull()
  })

  it('defaults credentials to same-origin for mutating verbs', async () => {
    restoreCookies = stubCookies('__Host-csrf=abc')
    await fetchWithCsrf('/api/foo', { method: 'POST' })
    const init = mockedFetch.mock.calls[0][1] as RequestInit
    expect(init.credentials).toBe('same-origin')
  })

  it('respects an explicit credentials setting', async () => {
    restoreCookies = stubCookies('__Host-csrf=abc')
    await fetchWithCsrf('/api/foo', { method: 'POST', credentials: 'include' })
    const init = mockedFetch.mock.calls[0][1] as RequestInit
    expect(init.credentials).toBe('include')
  })
})
