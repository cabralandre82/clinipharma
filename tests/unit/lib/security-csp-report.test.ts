/**
 * Unit tests for `lib/security/csp-report` — the pure parsing helpers
 * that turn browser CSP violation payloads into a normalised shape.
 *
 * Coverage philosophy: this file is **mutation-tested** as part of the
 * security-critical surface (`stryker.config.mjs`). Every conditional,
 * every type guard, every regex branch is asserted explicitly so a
 * silent regression (e.g. swapping `===` for `!==`) is caught.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// `parseReports` calls `incCounter` on malformed payloads. We don't
// care about the metric body here — just stub it so the assertions
// stay focused on parsing semantics. The double-quote import path
// matches what the source uses internally.
vi.mock('@/lib/metrics', () => ({
  incCounter: vi.fn(),
  Metrics: {
    CSP_REPORT_INVALID_TOTAL: 'csp_report_invalid_total',
  },
}))

import { hostOf, parseReports, type NormalisedReport } from '@/lib/security/csp-report'
import * as metricsModule from '@/lib/metrics'

const incCounter = vi.mocked(metricsModule.incCounter)

beforeEach(() => {
  incCounter.mockClear()
})

describe('hostOf', () => {
  it('returns "unknown" for empty input', () => {
    expect(hostOf('')).toBe('unknown')
  })

  it.each(['inline', 'eval', 'wasm-eval', 'data', 'blob'])(
    'returns the keyword "%s" lowercased when value is exactly that keyword',
    (kw) => {
      expect(hostOf(kw)).toBe(kw)
    }
  )

  it.each(['INLINE', 'Eval', 'Wasm-Eval', 'DATA', 'Blob'])(
    'matches keyword "%s" case-insensitively and lowercases the result',
    (kw) => {
      expect(hostOf(kw)).toBe(kw.toLowerCase())
    }
  )

  it('does NOT match keywords that are merely a substring (anchored regex)', () => {
    // The regex must be anchored at both ends — "inline-something" must
    // be treated as a URL-or-token, not a keyword.  We verify by
    // passing a mixed-case value: if the keyword regex matched, the
    // result would be lowercased; the URL fallback preserves case.
    expect(hostOf('Inline-Script')).toBe('Inline-Script')
    // Raw fallback also keeps case; lowercasing only happens in the
    // keyword branch.
    expect(hostOf('Self')).toBe('Self')
  })

  it('does NOT match keywords with a leading prefix (anchored regex)', () => {
    // Mixed case: keyword branch would lowercase, URL fallback
    // preserves case — so case preservation proves we did NOT take
    // the keyword branch.
    expect(hostOf('Foo-Eval')).toBe('Foo-Eval')
    expect(hostOf('XINLINE')).toBe('XINLINE')
  })

  it('extracts host from an absolute URL', () => {
    expect(hostOf('https://evil.example.com/path?x=1')).toBe('evil.example.com')
    expect(hostOf('http://cdn.example.com:8080/asset.js')).toBe('cdn.example.com:8080')
  })

  it('returns "unknown" when the URL has an empty host (e.g. file://)', () => {
    expect(hostOf('file:///etc/passwd')).toBe('unknown')
  })

  it('returns the raw token (truncated) when the value is not a URL', () => {
    const long = 'self'.padEnd(80, 'x')
    expect(hostOf(long)).toBe(long.slice(0, 64))
    expect(hostOf(long).length).toBe(64)
  })

  it('handles short non-URL tokens without truncation', () => {
    expect(hostOf('self')).toBe('self')
  })
})

describe('parseReports — invalid input handling', () => {
  it('returns [] for empty body without touching the metrics counter', () => {
    expect(parseReports('')).toEqual([])
    expect(incCounter).not.toHaveBeenCalled()
  })

  it('returns [] and increments json_parse counter for non-JSON body', () => {
    expect(parseReports('not-json')).toEqual([])
    expect(incCounter).toHaveBeenCalledWith('csp_report_invalid_total', { reason: 'json_parse' })
  })

  it('returns [] and increments unknown_shape for an arbitrary object', () => {
    expect(parseReports(JSON.stringify({ foo: 'bar' }))).toEqual([])
    expect(incCounter).toHaveBeenCalledWith('csp_report_invalid_total', { reason: 'unknown_shape' })
  })

  it('returns [] and increments unknown_shape for a primitive (number)', () => {
    expect(parseReports('42')).toEqual([])
    expect(incCounter).toHaveBeenCalledWith('csp_report_invalid_total', { reason: 'unknown_shape' })
  })

  it('returns [] and increments empty_array when array contains no csp-violation entries', () => {
    expect(parseReports(JSON.stringify([{ type: 'deprecation' }, { type: 'crash' }]))).toEqual([])
    expect(incCounter).toHaveBeenCalledWith('csp_report_invalid_total', { reason: 'empty_array' })
  })

  it('returns [] and increments empty_array when array contains only nullish entries', () => {
    expect(parseReports(JSON.stringify([null, undefined, 0, '']))).toEqual([])
    expect(incCounter).toHaveBeenCalledWith('csp_report_invalid_total', { reason: 'empty_array' })
  })

  it('returns [] silently when "csp-report" key exists but inner is not an object', () => {
    expect(parseReports(JSON.stringify({ 'csp-report': 'not-an-object' }))).toEqual([])
    expect(parseReports(JSON.stringify({ 'csp-report': null }))).toEqual([])
    // These do NOT increment the counter — they hit the inner-object
    // guard which short-circuits before the unknown_shape branch.
  })
})

describe('parseReports — Reporting API format (Chromium 96+)', () => {
  function reportingApiPayload(overrides: Record<string, unknown> = {}) {
    return JSON.stringify([
      {
        type: 'csp-violation',
        body: {
          documentURL: 'https://app.example.com/page',
          blockedURL: 'https://evil.example.com/x.js',
          effectiveDirective: 'script-src',
          violatedDirective: 'script-src',
          originalPolicy: "default-src 'self'",
          disposition: 'enforce',
          statusCode: 200,
          sample: 'console.log(1)',
          sourceFile: 'https://app.example.com/page',
          lineNumber: 42,
          columnNumber: 7,
          ...overrides,
        },
      },
    ])
  }

  it('parses a fully-populated reporting-api entry', () => {
    const [r] = parseReports(reportingApiPayload())
    expect(r.format).toBe('reporting-api')
    expect(r.directive).toBe('script-src')
    expect(r.blockedUri).toBe('https://evil.example.com/x.js')
    expect(r.blockedHost).toBe('evil.example.com')
    expect(r.documentUri).toBe('https://app.example.com/page')
    expect(r.effectiveDirective).toBe('script-src')
    expect(r.violatedDirective).toBe('script-src')
    expect(r.originalPolicy).toBe("default-src 'self'")
    expect(r.disposition).toBe('enforce')
    expect(r.statusCode).toBe(200)
    expect(r.scriptSample).toBe('console.log(1)')
    expect(r.sourceFile).toBe('https://app.example.com/page')
    expect(r.lineNumber).toBe(42)
    expect(r.columnNumber).toBe(7)
  })

  it('skips entries whose type is not csp-violation', () => {
    const body = JSON.stringify([
      { type: 'deprecation', body: { directive: 'script-src' } },
      { type: 'csp-violation', body: { effectiveDirective: 'img-src' } },
    ])
    const out = parseReports(body)
    expect(out).toHaveLength(1)
    expect(out[0].directive).toBe('img-src')
  })

  it('falls back to violatedDirective when effectiveDirective is missing', () => {
    const [r] = parseReports(reportingApiPayload({ effectiveDirective: undefined }))
    expect(r.directive).toBe('script-src')
  })

  it('falls back to documentUri when documentURL is missing', () => {
    const [r] = parseReports(
      reportingApiPayload({ documentURL: undefined, documentUri: 'https://alt.example.com/' })
    )
    expect(r.documentUri).toBe('https://alt.example.com/')
  })

  it('falls back to blockedUri when blockedURL is missing', () => {
    const [r] = parseReports(
      reportingApiPayload({ blockedURL: undefined, blockedUri: 'https://other.example.com/' })
    )
    expect(r.blockedUri).toBe('https://other.example.com/')
  })

  it('keeps directive as the first space-separated token', () => {
    const [r] = parseReports(reportingApiPayload({ effectiveDirective: 'img-src https://cdn' }))
    expect(r.directive).toBe('img-src')
  })

  it('truncates originalPolicy to 512 characters', () => {
    const policy = 'a'.repeat(2000)
    const [r] = parseReports(reportingApiPayload({ originalPolicy: policy }))
    expect(r.originalPolicy).toHaveLength(512)
  })

  it('truncates script sample to 256 characters', () => {
    const sample = 'b'.repeat(2000)
    const [r] = parseReports(reportingApiPayload({ sample }))
    expect(r.scriptSample).toHaveLength(256)
  })

  it.each([
    ['effectiveDirective', 123, 'effectiveDirective'],
    ['violatedDirective', 123, 'violatedDirective'],
    ['originalPolicy', 123, 'originalPolicy'],
    ['disposition', 123, 'disposition'],
    ['sample', 123, 'scriptSample'],
    ['sourceFile', 123, 'sourceFile'],
  ])('drops %s when its type is not string', (key, badValue, outputKey) => {
    const [r] = parseReports(reportingApiPayload({ [key]: badValue }))
    expect(r[outputKey as keyof NormalisedReport]).toBeUndefined()
  })

  it.each([
    ['statusCode', 'not-a-number', 'statusCode'],
    ['lineNumber', '42', 'lineNumber'],
    ['columnNumber', null, 'columnNumber'],
  ])('drops %s when its type is not number', (key, badValue, outputKey) => {
    const [r] = parseReports(reportingApiPayload({ [key]: badValue }))
    expect(r[outputKey as keyof NormalisedReport]).toBeUndefined()
  })

  it('drops entries with no directive (empty body)', () => {
    // body missing → defaults to `{}` → directive resolves to empty
    // string → `if (!directive) return null` → entry is dropped.
    const body = JSON.stringify([{ type: 'csp-violation' }])
    const out = parseReports(body)
    expect(out).toEqual([])
    // Empty array fallback path also fires the empty_array counter.
    expect(incCounter).toHaveBeenCalledWith('csp_report_invalid_total', { reason: 'empty_array' })
  })

  it('still produces a report when only blocked-uri/document-uri are missing', () => {
    const body = JSON.stringify([
      {
        type: 'csp-violation',
        body: { effectiveDirective: 'img-src' },
      },
    ])
    const [r] = parseReports(body)
    expect(r.directive).toBe('img-src')
    expect(r.blockedUri).toBe('')
    expect(r.documentUri).toBe('')
    expect(r.blockedHost).toBe('unknown')
    expect(r.format).toBe('reporting-api')
  })
})

describe('parseReports — legacy report-uri format', () => {
  function legacyPayload(overrides: Record<string, unknown> = {}) {
    return JSON.stringify({
      'csp-report': {
        'document-uri': 'https://app.example.com/page',
        'blocked-uri': 'https://evil.example.com/x.js',
        'effective-directive': 'script-src',
        'violated-directive': 'script-src',
        'original-policy': "default-src 'self'",
        disposition: 'enforce',
        'status-code': 200,
        'script-sample': 'console.log(1)',
        'source-file': 'https://app.example.com/page',
        'line-number': 42,
        'column-number': 7,
        ...overrides,
      },
    })
  }

  it('parses a fully-populated legacy report', () => {
    const [r] = parseReports(legacyPayload())
    expect(r.format).toBe('legacy')
    expect(r.directive).toBe('script-src')
    expect(r.blockedUri).toBe('https://evil.example.com/x.js')
    expect(r.blockedHost).toBe('evil.example.com')
    expect(r.documentUri).toBe('https://app.example.com/page')
    expect(r.effectiveDirective).toBe('script-src')
    expect(r.violatedDirective).toBe('script-src')
    expect(r.originalPolicy).toBe("default-src 'self'")
    expect(r.disposition).toBe('enforce')
    expect(r.statusCode).toBe(200)
    expect(r.scriptSample).toBe('console.log(1)')
    expect(r.sourceFile).toBe('https://app.example.com/page')
    expect(r.lineNumber).toBe(42)
    expect(r.columnNumber).toBe(7)
  })

  it('falls back to violated-directive when effective-directive is missing', () => {
    const [r] = parseReports(legacyPayload({ 'effective-directive': undefined }))
    expect(r.directive).toBe('script-src')
  })

  it('keeps directive as the first space-separated token', () => {
    const [r] = parseReports(legacyPayload({ 'effective-directive': 'img-src https://cdn' }))
    expect(r.directive).toBe('img-src')
  })

  it('truncates original-policy to 512 characters', () => {
    const policy = 'a'.repeat(2000)
    const [r] = parseReports(legacyPayload({ 'original-policy': policy }))
    expect(r.originalPolicy).toHaveLength(512)
  })

  it('truncates script-sample to 256 characters', () => {
    const sample = 'b'.repeat(2000)
    const [r] = parseReports(legacyPayload({ 'script-sample': sample }))
    expect(r.scriptSample).toHaveLength(256)
  })

  it.each([
    ['original-policy', 123, 'originalPolicy'],
    ['disposition', 123, 'disposition'],
    ['script-sample', 123, 'scriptSample'],
    ['source-file', 123, 'sourceFile'],
  ])('drops %s when its type is not string', (key, badValue, outputKey) => {
    const [r] = parseReports(legacyPayload({ [key]: badValue }))
    expect(r[outputKey as keyof NormalisedReport]).toBeUndefined()
  })

  it.each([
    ['status-code', 'not-a-number', 'statusCode'],
    ['line-number', '42', 'lineNumber'],
    ['column-number', null, 'columnNumber'],
  ])('drops %s when its type is not number', (key, badValue, outputKey) => {
    const [r] = parseReports(legacyPayload({ [key]: badValue }))
    expect(r[outputKey as keyof NormalisedReport]).toBeUndefined()
  })

  it('coerces missing document-uri / blocked-uri to empty strings', () => {
    const [r] = parseReports(
      JSON.stringify({ 'csp-report': { 'violated-directive': 'script-src' } })
    )
    expect(r.documentUri).toBe('')
    expect(r.blockedUri).toBe('')
    expect(r.blockedHost).toBe('unknown')
  })
})
