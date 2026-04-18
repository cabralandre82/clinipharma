import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { getCircuitStates } from '@/lib/circuit-breaker'
import { withDbSpan } from '@/lib/tracing'
import { incCounter, observeHistogram, Metrics } from '@/lib/metrics'

/**
 * GET /api/health — legacy alias of `/api/health/ready`.
 *
 * Preserved for backward compatibility with UptimeRobot / Vercel
 * dashboards that were configured before the W6 split. New probes
 * should use `/api/health/live`, `/api/health/ready`, or
 * `/api/health/deep` directly.
 *
 * Implementation intentionally duplicates `ready/route.ts` rather than
 * re-exporting so that a regression in one file cannot cascade into
 * the other (and because Next.js handler re-exports have historically
 * been finicky across runtimes).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const start = Date.now()
  const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {}

  try {
    const t0 = Date.now()
    const admin = createAdminClient()
    const { error } = await withDbSpan('sla_configs', 'select', async () =>
      admin.from('sla_configs').select('id').limit(1)
    )
    checks.database = { ok: !error, latencyMs: Date.now() - t0 }
    if (error) checks.database.error = error.message
  } catch (err) {
    checks.database = { ok: false, error: String(err) }
  }

  const requiredEnvs = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]
  const missingEnvs = requiredEnvs.filter((k) => !process.env[k])
  checks.env = { ok: missingEnvs.length === 0 }
  if (missingEnvs.length > 0) checks.env.error = `Missing: ${missingEnvs.join(', ')}`

  const circuits = getCircuitStates()
  const openCircuits = Object.entries(circuits).filter(([, v]) => v.state !== 'CLOSED')
  checks.circuits =
    openCircuits.length === 0
      ? { ok: true }
      : {
          ok: false,
          error: `Open circuits: ${openCircuits.map(([k]) => k).join(', ')}`,
        }

  const allOk = Object.values(checks).every((c) => c.ok)
  const totalMs = Date.now() - start
  observeHistogram(Metrics.HEALTH_CHECK_DURATION_MS, totalMs, { endpoint: 'legacy' })
  incCounter('health_check_total', { endpoint: 'legacy', status: allOk ? 'ok' : 'degraded' })

  return NextResponse.json(
    {
      status: allOk ? 'ok' : 'degraded',
      version: process.env.npm_package_version ?? '2.4.0',
      timestamp: new Date().toISOString(),
      totalLatencyMs: totalMs,
      checks,
      circuitStatus: openCircuits.length === 0 ? 'ok' : `${openCircuits.length} open`,
    },
    {
      status: allOk ? 200 : 503,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  )
}
