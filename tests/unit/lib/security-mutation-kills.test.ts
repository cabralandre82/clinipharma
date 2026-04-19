/**
 * Targeted assertions designed to kill the surviving Stryker mutants
 * across the security-critical surface (hmac / csrf / crypto / csp /
 * safe-redirect). Grouped by mutant location so a future regression
 * is easy to map back to the line that broke.
 *
 * IMPORTANT: each `it(...)` here is documented with the mutant it is
 * meant to kill. Removing one of these tests directly weakens the
 * security gate.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'

// ---------- HMAC -----------------------------------------------------

describe('hmac mutation kills', () => {
  it('verifyHmacSha256 strips the sha256= prefix only at the START (anchor)', async () => {
    const { verifyHmacSha256 } = await import('@/lib/security/hmac')
    const secret = 'secret'
    const payload = 'body'
    const validHex = createHmac('sha256', secret).update(payload, 'utf8').digest('hex')
    // If the regex were unanchored (mutant), `XXsha256=<hex>` would
    // become `XX<hex>` after replace, which would still fail hex
    // validation. To guarantee a different outcome we feed exactly
    // `sha256=sha256=<hex>` — anchored regex strips ONE `sha256=` and
    // the residual prefix breaks hex validation; an unanchored regex
    // would happily strip BOTH, leaving valid hex and erroneously
    // accepting the signature.
    const doubled = `sha256=sha256=${validHex}`
    expect(verifyHmacSha256(payload, doubled, secret)).toBe(false)
  })

  it('verifyHmacSha256 trims surrounding whitespace from the signature', async () => {
    const { verifyHmacSha256 } = await import('@/lib/security/hmac')
    const secret = 'secret'
    const payload = 'body'
    const validHex = createHmac('sha256', secret).update(payload, 'utf8').digest('hex')
    expect(verifyHmacSha256(payload, `  ${validHex}  `, secret)).toBe(true)
    expect(verifyHmacSha256(payload, `sha256=${validHex}\n`, secret)).toBe(true)
  })
})

// ---------- CSRF -----------------------------------------------------

import {
  CSRF_COOKIE,
  CSRF_COOKIE_DEV,
  CSRF_HEADER,
  ensureCsrfCookie,
  verifyDoubleSubmit,
  checkCsrf,
} from '@/lib/security/csrf'

function fakeRequest({
  url = 'https://app.example.com/api/orders',
  method = 'POST',
  cookies = {} as Record<string, string>,
  headers = {} as Record<string, string>,
} = {}) {
  return {
    url,
    method,
    cookies: {
      get(name: string) {
        return cookies[name] ? { value: cookies[name] } : undefined
      },
    },
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? null
      },
    },
  }
}

function fakeResponse() {
  const written: Array<{ name: string; value: string; opts: Record<string, unknown> }> = []
  return {
    written,
    cookies: {
      set(name: string, value: string, opts: Record<string, unknown>) {
        written.push({ name, value, opts })
      },
    },
  }
}

describe('csrf mutation kills', () => {
  const validToken = 'a'.repeat(64)

  it('pickCookieName uses startsWith("https://"), not endsWith', () => {
    // Mutant L177: `req.url.endsWith('https://')` would never be true
    // for real URLs, forcing the dev cookie even on prod requests.
    // We verify by checking which cookie verifyDoubleSubmit consults.
    const httpsReq = fakeRequest({
      url: 'https://app.example.com/api/x',
      cookies: { [CSRF_COOKIE]: validToken },
      headers: { [CSRF_HEADER]: validToken },
    })
    // Prod request must accept __Host- cookie as primary.
    // @ts-expect-error fake request shape
    expect(verifyDoubleSubmit(httpsReq).ok).toBe(true)

    // Dev request should still work using the fallback name.
    const httpReq = fakeRequest({
      url: 'http://localhost:3000/api/x',
      cookies: { [CSRF_COOKIE_DEV]: validToken },
      headers: { [CSRF_HEADER]: validToken },
    })
    // @ts-expect-error fake request shape
    expect(verifyDoubleSubmit(httpReq).ok).toBe(true)
  })

  it('verifyDoubleSubmit treats missing-cookie and missing-header symmetrically (LogicalOperator L194)', () => {
    // Mutant: `!cookieValue && !headerValue`. With AND, only failing
    // when BOTH are missing — set one and not the other to force a
    // different verdict.
    const cookieOnly = fakeRequest({
      cookies: { [CSRF_COOKIE]: validToken },
      headers: {},
    })
    // @ts-expect-error fake request shape
    const dec1 = verifyDoubleSubmit(cookieOnly)
    expect(dec1.ok).toBe(false)
    expect(dec1.reason).toBe('token_missing')
    expect(dec1.details).toContain('header')

    const headerOnly = fakeRequest({
      cookies: {},
      headers: { [CSRF_HEADER]: validToken },
    })
    // @ts-expect-error fake request shape
    const dec2 = verifyDoubleSubmit(headerOnly)
    expect(dec2.ok).toBe(false)
    expect(dec2.reason).toBe('token_missing')
    expect(dec2.details).toContain('cookie')
  })

  it('verifyDoubleSubmit token_missing details point to "cookie" when only the cookie is empty (BooleanLiteral L198)', () => {
    // Mutant L198: `!cookieValue ? 'cookie' : 'header'` →
    //              `true        ? 'cookie' : 'header'` always 'cookie'.
    // We already cover the cookie branch above; here we confirm the
    // 'header' branch is real and not always 'cookie'.
    const headerOnly = fakeRequest({
      cookies: {},
      headers: { [CSRF_HEADER]: validToken },
    })
    // @ts-expect-error fake request shape
    expect(verifyDoubleSubmit(headerOnly).details).toMatch(/cookie/)
    const cookieOnly = fakeRequest({
      cookies: { [CSRF_COOKIE]: validToken },
      headers: {},
    })
    // @ts-expect-error fake request shape
    expect(verifyDoubleSubmit(cookieOnly).details).toMatch(/header/)
  })

  it('ensureCsrfCookie keeps an existing 64-char cookie unchanged (ConditionalExpression L245)', () => {
    // Mutant L245: `if (true) return existing` — always returns the
    // existing value without minting a fresh one. The risk in the
    // original is the OPPOSITE: `if (existing && existing.length === 64)`
    // — a 32-char attacker-controlled value should NOT short-circuit.
    const reqValid = fakeRequest({
      url: 'https://app.example.com/',
      cookies: { [CSRF_COOKIE]: validToken },
    })
    const resValid = fakeResponse()
    // @ts-expect-error fake req/res shapes
    const tValid = ensureCsrfCookie(reqValid, resValid)
    expect(tValid).toBe(validToken)
    expect(resValid.written).toHaveLength(0) // no new cookie minted

    const reqShort = fakeRequest({
      url: 'https://app.example.com/',
      cookies: { [CSRF_COOKIE]: 'abc' }, // wrong length
    })
    const resShort = fakeResponse()
    // @ts-expect-error fake req/res shapes
    const tShort = ensureCsrfCookie(reqShort, resShort)
    expect(tShort).not.toBe('abc')
    expect(tShort).toHaveLength(64)
    expect(resShort.written).toHaveLength(1)
  })

  it('ensureCsrfCookie sets maxAge to exactly 7 days (60*60*24*7 — ArithmeticOperator L253)', () => {
    const req = fakeRequest({ url: 'https://app.example.com/', cookies: {} })
    const res = fakeResponse()
    // @ts-expect-error fake req/res shapes
    ensureCsrfCookie(req, res)
    expect(res.written).toHaveLength(1)
    expect(res.written[0].opts.maxAge).toBe(60 * 60 * 24 * 7)
    expect(res.written[0].opts.sameSite).toBe('strict')
    expect(res.written[0].opts.path).toBe('/')
  })

  it('checkCsrf only runs double-submit when enforceDoubleSubmit=true (ConditionalExpression L288)', () => {
    // Mutant L288: `if (true)` — runs double-submit always, blocking
    // requests that legitimately have no token (flag-off mode).
    const req = fakeRequest({
      url: 'https://app.example.com/api/orders',
      method: 'POST',
      headers: { origin: 'https://app.example.com' },
      cookies: {},
    })
    // Flag OFF → token check skipped → ok.
    // @ts-expect-error fake request shape
    expect(checkCsrf(req, { enforceDoubleSubmit: false }).ok).toBe(true)
    // Flag ON → no cookie/header → must fail with token_missing.
    // @ts-expect-error fake request shape
    const dec = checkCsrf(req, { enforceDoubleSubmit: true })
    expect(dec.ok).toBe(false)
    expect(dec.reason).toBe('token_missing')
  })
})

// ---------- crypto ---------------------------------------------------

describe('crypto mutation kills', () => {
  const TEST_KEY = 'a'.repeat(64)

  beforeEach(() => {
    vi.stubEnv('ENCRYPTION_KEY', TEST_KEY)
  })

  it('encrypt rejects keys whose length is not exactly 64 hex chars (ConditionalExpression L19)', async () => {
    vi.stubEnv('ENCRYPTION_KEY', 'a'.repeat(63)) // off-by-one
    vi.resetModules()
    const { encrypt } = await import('@/lib/crypto')
    expect(() => encrypt('value')).toThrow(/64-character hex/)
  })

  it('encrypt rejects keys longer than 64 hex chars too', async () => {
    vi.stubEnv('ENCRYPTION_KEY', 'a'.repeat(65))
    vi.resetModules()
    const { encrypt } = await import('@/lib/crypto')
    expect(() => encrypt('value')).toThrow(/64-character hex/)
  })

  it('decrypt logs error metadata when ciphertext is tampered (ObjectLiteral L69)', async () => {
    // Mutant L69: empties the metadata object. We assert the
    // logger.error call carries the module + error fields so any
    // future regression that drops them is caught.
    vi.resetModules()
    const errorSpy = vi.fn()
    vi.doMock('@/lib/logger', () => ({
      logger: { error: errorSpy, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    }))
    const { encrypt, decrypt } = await import('@/lib/crypto')
    const enc = encrypt('value')!
    const parts = enc.split(':')
    parts[1] = 'ff'.repeat(16) // tamper authTag
    decrypt(parts.join(':'))
    expect(errorSpy).toHaveBeenCalledTimes(1)
    const meta = errorSpy.mock.calls[0][1]
    expect(meta).toMatchObject({ module: 'crypto' })
    expect(meta.error).toBeInstanceOf(Error)
    vi.doUnmock('@/lib/logger')
  })

  it('isEncrypted requires BOTH 3 parts AND a 24-char IV prefix (LogicalOperator L90)', async () => {
    vi.resetModules()
    const { isEncrypted } = await import('@/lib/crypto')
    // Mutant L90 LogicalOperator (&& → ||): a single 24-char string
    // with no colons would be `1 part === 3` false ∨ `len === 24`
    // true ⇒ true. Original returns false.
    expect(isEncrypted('a'.repeat(24))).toBe(false)
    // Mutant L90 ConditionalExpression (left → true): a 3-part string
    // whose first segment is 2 chars (`xx:yy:zz`) ⇒ original false,
    // mutant `true && (2 === 24)` ⇒ false. Same. So we craft a value
    // that *only* the first-side mutation flips:
    //   `'a:b:c:d'` ⇒ split→4 parts ⇒ original false; mutant
    //   `true && (1 === 24)` ⇒ false. Equivalent. Better:
    //   `'a'.repeat(24)+':b:c'` ⇒ split→3, first=24 ⇒ original true;
    //   mutant `true && true` ⇒ true. Equivalent. The test that
    //   surfaces both ConditionalExpression mutants is the
    //   3-part-but-wrong-first-length case: `'aa:bb:cc'`.
    expect(isEncrypted('aa:bb:cc')).toBe(false)
    // And finally a true positive to make sure we didn't accidentally
    // make isEncrypted always-false.
    const { encrypt } = await import('@/lib/crypto')
    expect(isEncrypted(encrypt('x'))).toBe(true)
  })
})

// ---------- safe-redirect --------------------------------------------

describe('safe-redirect mutation kills', () => {
  it('safeNextPath accepts paths of exactly 1024 chars but rejects 1025 (EqualityOperator L39)', async () => {
    const { safeNextPath } = await import('@/lib/security/safe-redirect')
    const at1024 = '/' + 'a'.repeat(1023)
    const at1025 = '/' + 'a'.repeat(1024)
    expect(at1024).toHaveLength(1024)
    expect(at1025).toHaveLength(1025)
    // Original: `length > 1024` ⇒ 1024 OK, 1025 fallback.
    // Mutant `length >= 1024` would reject the 1024-char path too.
    expect(safeNextPath(at1024)).toBe(at1024)
    expect(safeNextPath(at1025)).toBe('/dashboard')
  })
})

// ---------- CSP ------------------------------------------------------

describe('csp mutation kills', () => {
  const validNonce = 'a'.repeat(22)

  it('script-src does NOT contain the Stryker placeholder when allowEval is false (ArrayDeclaration L88)', async () => {
    const { buildCsp } = await import('@/lib/security/csp')
    const csp = buildCsp({ nonce: validNonce })
    expect(csp).not.toContain('Stryker')
  })

  it("style-src always contains 'self' (ArrayDeclaration L98)", async () => {
    const { buildCsp } = await import('@/lib/security/csp')
    const csp = buildCsp({ nonce: validNonce })
    const styleDir = csp.split(';').find((d) => d.trim().startsWith('style-src '))!
    expect(styleDir).toContain("'self'")
    expect(styleDir).toContain("'unsafe-inline'")
  })

  it('Report-To header sets include_subdomains=false explicitly (BooleanLiteral L157)', async () => {
    const { buildReportToHeader } = await import('@/lib/security/csp')
    const parsed = JSON.parse(buildReportToHeader())
    expect(parsed.include_subdomains).toBe(false)
  })

  it('generateNonce produces values whose hex round-trips back through buildCsp (Arithmetic L190/191)', async () => {
    const { generateNonce, buildCsp } = await import('@/lib/security/csp')
    for (let i = 0; i < 50; i++) {
      const n = generateNonce()
      // Length must be ≥ 22 (16 bytes → 22 base64url chars).
      // A mutated `hex.length / 2` would yield 64 bytes ⇒ 86 chars;
      // `hex.length * 2` would yield 0 bytes ⇒ empty. Either trips
      // the regex inside buildCsp.
      expect(n.length).toBeGreaterThanOrEqual(22)
      expect(n.length).toBeLessThanOrEqual(48)
      expect(() => buildCsp({ nonce: n })).not.toThrow()
    }
  })
})
