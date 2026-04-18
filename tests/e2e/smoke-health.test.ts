/**
 * Wave 6 health-endpoint smoke tests.
 *
 * Exercises the three-tier probe split:
 *   - /api/health/live  — always 200 (process alive, no DB).
 *   - /api/health/ready — 200 when DB + env OK.
 *   - /api/health/deep  — 403 when unauthenticated (CRON_SECRET gate).
 *   - /api/health       — legacy alias (200 on healthy stack).
 *
 * Keeps the bar low in smoke context: we only assert shape + auth,
 * not full behaviour (cron freshness, webhook backlog), because the
 * ephemeral test DB often lacks historical rows.
 *
 * Run locally:
 *   npx playwright test smoke-health --project=chromium
 */
import { test, expect } from '@playwright/test'

test.use({ storageState: { cookies: [], origins: [] } })

test.describe('Health: /api/health/live', () => {
  test('returns 200 with status=ok and check=live', async ({ request }) => {
    const res = await request.get('/api/health/live')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.check).toBe('live')
    expect(typeof body.timestamp).toBe('string')
  })

  test('does not require authentication', async ({ request }) => {
    const res = await request.get('/api/health/live', {
      headers: { 'x-unused': '1' },
    })
    expect(res.status()).toBe(200)
  })

  test('sets no-store cache headers', async ({ request }) => {
    const res = await request.get('/api/health/live')
    const cc = res.headers()['cache-control'] ?? ''
    expect(cc).toContain('no-store')
  })
})

test.describe('Health: /api/health/ready', () => {
  test('returns 200 (or 503) with status + checks shape', async ({ request }) => {
    const res = await request.get('/api/health/ready')
    // Accept 200 OR 503 — the test DB may be offline in ephemeral CI.
    expect([200, 503]).toContain(res.status())
    const body = await res.json()
    expect(body.check).toBe('ready')
    expect(body.checks).toBeTruthy()
    expect(body.checks.env).toBeTruthy()
    expect(body.checks.database).toBeTruthy()
    expect(body.checks.circuits).toBeTruthy()
  })
})

test.describe('Health: /api/health/deep', () => {
  test('rejects unauthenticated callers with 403', async ({ request }) => {
    const res = await request.get('/api/health/deep')
    expect(res.status()).toBe(403)
    const body = await res.json().catch(() => ({}))
    expect(body.error).toBe('forbidden')
  })
})

test.describe('Health: /api/health (legacy alias)', () => {
  test('still responds — used by pre-W6 uptime monitors', async ({ request }) => {
    const res = await request.get('/api/health')
    expect([200, 503]).toContain(res.status())
    const body = await res.json()
    expect(body.checks).toBeTruthy()
    expect(body.version).toBeTruthy()
  })
})
