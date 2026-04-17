/**
 * Next.js Instrumentation Hook — OpenTelemetry
 *
 * Runs once per Node.js worker on startup (server-side only).
 * Registers @vercel/otel which auto-instruments:
 *   - HTTP incoming requests (all API routes and page SSR)
 *   - fetch() outgoing calls (Supabase, Clicksign, Zenvia, Asaas, OpenAI)
 *   - DNS lookups and TCP connections
 *
 * Traces are exported to Vercel's built-in OTLP collector when deployed
 * on Vercel (no extra env vars needed). Locally, traces are emitted to
 * the console when OTEL_LOG_LEVEL=debug is set.
 *
 * Docs: https://nextjs.org/docs/app/building-your-application/optimizing/open-telemetry
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerOTel } = await import('@vercel/otel')

    registerOTel({
      serviceName: 'clinipharma',
    })
  }
}
