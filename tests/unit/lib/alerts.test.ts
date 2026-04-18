import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/features', () => ({
  isFeatureEnabled: vi.fn(),
}))

vi.mock('@/lib/monitoring', () => ({
  captureError: vi.fn(),
}))

import { triggerAlert, resolveAlert, _internal } from '@/lib/alerts'
import { sendEmail } from '@/lib/email'
import { isFeatureEnabled } from '@/lib/features'

const mockedFetch = vi.fn()
// Preserve the original for restoration.
const originalFetch = global.fetch

beforeEach(() => {
  _internal.cooldowns.clear()
  vi.mocked(sendEmail).mockClear()
  vi.mocked(isFeatureEnabled).mockReset()
  mockedFetch.mockReset()
  mockedFetch.mockResolvedValue(new Response('ok', { status: 202 }))
  global.fetch = mockedFetch as unknown as typeof fetch
})

afterEach(() => {
  global.fetch = originalFetch
  delete process.env.PAGERDUTY_ROUTING_KEY
  delete process.env.OPS_ALERT_EMAIL
})

describe('triggerAlert — PagerDuty routing', () => {
  it('does NOT call PagerDuty when flag disabled', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false)
    process.env.PAGERDUTY_ROUTING_KEY = 'routing-xyz'
    const res = await triggerAlert({
      severity: 'critical',
      title: 'Test',
      message: 'Body',
      dedupKey: 'k1',
      component: 'test',
    })
    expect(res.delivered).toEqual(['log'])
    expect(mockedFetch).not.toHaveBeenCalled()
  })

  it('does NOT call PagerDuty for warning severity even if enabled', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true)
    process.env.PAGERDUTY_ROUTING_KEY = 'routing-xyz'
    const res = await triggerAlert({
      severity: 'warning',
      title: 'warn-only',
      message: 'Body',
      dedupKey: 'k-warn',
      component: 'test',
    })
    expect(mockedFetch).not.toHaveBeenCalled()
    expect(res.delivered).toContain('log')
  })

  it('calls PagerDuty for critical severity when enabled AND routing key set', async () => {
    vi.mocked(isFeatureEnabled).mockImplementation(async (k) => k === 'alerts.pagerduty_enabled')
    process.env.PAGERDUTY_ROUTING_KEY = 'routing-xyz'
    const res = await triggerAlert({
      severity: 'critical',
      title: 'Outage',
      message: 'DB down',
      dedupKey: 'k-pd',
      component: 'db',
    })
    expect(mockedFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockedFetch.mock.calls[0]
    expect(url).toBe('https://events.pagerduty.com/v2/enqueue')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.event_action).toBe('trigger')
    expect(body.dedup_key).toBe('k-pd')
    expect(body.routing_key).toBe('routing-xyz')
    expect(res.delivered).toContain('pagerduty')
  })

  it('does NOT deliver to PagerDuty when routing key missing', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true)
    // No PAGERDUTY_ROUTING_KEY
    const res = await triggerAlert({
      severity: 'critical',
      title: 'Outage',
      message: 'DB down',
      dedupKey: 'k-no-key',
      component: 'db',
    })
    expect(mockedFetch).not.toHaveBeenCalled()
    expect(res.delivered).not.toContain('pagerduty')
  })
})

describe('triggerAlert — email routing', () => {
  it('sends email for warning when flag + OPS_ALERT_EMAIL set', async () => {
    vi.mocked(isFeatureEnabled).mockImplementation(async (k) => k === 'alerts.email_enabled')
    process.env.OPS_ALERT_EMAIL = 'ops@example.com'
    const res = await triggerAlert({
      severity: 'warning',
      title: 'slow query',
      message: 'avg > 2s',
      dedupKey: 'k-email',
      component: 'db',
    })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const call = vi.mocked(sendEmail).mock.calls[0][0]
    expect(call.to).toBe('ops@example.com')
    expect(call.subject).toContain('[WARNING]')
    expect(call.html).toContain('slow query')
    expect(res.delivered).toContain('email')
  })

  it('does NOT send email for info severity', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true)
    process.env.OPS_ALERT_EMAIL = 'ops@example.com'
    const res = await triggerAlert({
      severity: 'info',
      title: 'heartbeat',
      message: 'noop',
      dedupKey: 'k-info',
      component: 'x',
    })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(res.delivered).toEqual(['log'])
  })
})

describe('triggerAlert — dedup', () => {
  it('skips duplicate alerts within the cooldown window', async () => {
    vi.mocked(isFeatureEnabled).mockImplementation(async (k) => k === 'alerts.email_enabled')
    process.env.OPS_ALERT_EMAIL = 'ops@example.com'

    const payload = {
      severity: 'warning' as const,
      title: 'flap',
      message: 'repeated',
      dedupKey: 'k-dedup',
      component: 'x',
    }
    const first = await triggerAlert(payload)
    const second = await triggerAlert(payload)

    expect(first.deduped).toBe(false)
    expect(second.deduped).toBe(true)
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })
})

describe('triggerAlert — safety', () => {
  it('does not throw when email delivery fails', async () => {
    vi.mocked(isFeatureEnabled).mockImplementation(async (k) => k === 'alerts.email_enabled')
    process.env.OPS_ALERT_EMAIL = 'ops@example.com'
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error('smtp down'))
    await expect(
      triggerAlert({
        severity: 'error',
        title: 'x',
        message: 'y',
        dedupKey: 'k-safe',
        component: 'c',
      })
    ).resolves.toBeDefined()
  })
})

describe('resolveAlert', () => {
  it('calls PagerDuty with event_action=resolve when routing key set', async () => {
    process.env.PAGERDUTY_ROUTING_KEY = 'pd-key'
    _internal.cooldowns.set('k-resolve', Date.now())
    const ok = await resolveAlert({ dedupKey: 'k-resolve', component: 'db' })
    expect(ok).toBe(true)
    expect(mockedFetch).toHaveBeenCalled()
    const body = JSON.parse((mockedFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body.event_action).toBe('resolve')
    expect(body.dedup_key).toBe('k-resolve')
    expect(_internal.cooldowns.has('k-resolve')).toBe(false)
  })

  it('returns false when routing key absent (no-op)', async () => {
    const ok = await resolveAlert({ dedupKey: 'k-no', component: 'db' })
    expect(ok).toBe(false)
  })
})

describe('alerts — escape HTML', () => {
  it('escapes angle brackets, ampersands, and quotes', () => {
    const s = _internal.escapeHtml('<script>alert("x&y")</script>')
    expect(s).not.toContain('<script>')
    expect(s).toContain('&lt;script&gt;')
    expect(s).toContain('&amp;')
    expect(s).toContain('&quot;')
  })
})
