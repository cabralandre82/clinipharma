import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { getCircuitStates } from '@/lib/circuit-breaker'
import { withDbSpan } from '@/lib/tracing'
import { incCounter, observeHistogram, Metrics } from '@/lib/metrics'

/**
 * GET /api/health/ready — Kubernetes-style readiness probe.
 *
 * Purpose: answer the question "can this instance serve traffic right
 * now?" We check the three things a request MUST have to succeed:
 *
 *   1. Critical env vars present (SUPABASE URL/keys).
 *   2. Database reachable via a cheap `select id from sla_configs`.
 *   3. No circuit breaker in OPEN state (if one is open the downstream
 *      path is dead and we'd rather return 503 than serve errors).
 *
 * Returns 200 when all checks pass, 503 otherwise. Used by UptimeRobot,
 * Vercel uptime, and the external status page.
 *
 * This is intentionally a superset of `/api/health/live` and a subset of
 * `/api/health/deep` — it's the "production load-balancer" probe.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const start = Date.now()
  const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {}

  // ── Env vars ────────────────────────────────────────────────────────────
  const requiredEnvs = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]
  const missingEnvs = requiredEnvs.filter((k) => !process.env[k])
  checks.env = { ok: missingEnvs.length === 0 }
  if (missingEnvs.length > 0) checks.env.error = `Missing: ${missingEnvs.join(', ')}`

  // ── Database connectivity ──────────────────────────────────────────────
  try {
    const t0 = Date.now()
    const admin = createAdminClient()
    const { error } = await withDbSpan('sla_configs', 'select', async () =>
      admin.from('sla_configs').select('id').limit(1)
    )
    checks.database = { ok: !error, latencyMs: Date.now() - t0 }
    if (error) checks.database.error = error.message
  } catch (err) {
    checks.database = { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  // ── Circuit breakers ───────────────────────────────────────────────────
  const circuits = getCircuitStates()
  const openCircuits = Object.entries(circuits).filter(([, v]) => v.state === 'OPEN')
  checks.circuits =
    openCircuits.length === 0
      ? { ok: true }
      : { ok: false, error: `Open: ${openCircuits.map(([k]) => k).join(', ')}` }

  const allOk = Object.values(checks).every((c) => c.ok)
  const totalMs = Date.now() - start
  observeHistogram(Metrics.HEALTH_CHECK_DURATION_MS, totalMs, { endpoint: 'ready' })
  incCounter('health_check_total', { endpoint: 'ready', status: allOk ? 'ok' : 'degraded' })

  return NextResponse.json(
    {
      status: allOk ? 'ok' : 'degraded',
      check: 'ready',
      version: process.env.npm_package_version ?? '2.4.0',
      timestamp: new Date().toISOString(),
      totalLatencyMs: totalMs,
      checks,
    },
    {
      status: allOk ? 200 : 503,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  )
}
