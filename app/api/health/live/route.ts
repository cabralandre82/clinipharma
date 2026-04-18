import { NextResponse } from 'next/server'

/**
 * GET /api/health/live — Kubernetes-style liveness probe.
 *
 * Purpose: answer the question "is the process alive and responding?"
 * WITHOUT touching the database or any external dependency. A failing
 * liveness probe is a signal to Vercel/load-balancer to restart the
 * instance, which is meaningless for a stateless Function but still
 * useful for synthetic availability dashboards.
 *
 * Contract:
 *   - 200 always, unless the route itself crashes.
 *   - Response body is intentionally tiny (< 100 bytes) so uptime
 *     monitors can hit it every 30s cheaply.
 *   - No caching (headers enforced).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      check: 'live',
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  )
}
