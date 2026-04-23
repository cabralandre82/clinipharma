/**
 * Upstash Redis helper — thin, production-safe wrapper.
 *
 * Two concerns live here:
 *
 *   1. `getRedis()` — returns a memoised `@upstash/redis` client
 *      when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
 *      are set. Returns `null` when they aren't (local dev /
 *      self-hosted) so callers can feature-detect and degrade.
 *
 *   2. `pingRedis()` — health probe that issues a single PING
 *      command against the REST API and reports `ok` + latency.
 *      Used by:
 *        • `/api/cron/synthetic-probe` — sends 1 PING every 5 min
 *          so the free-tier Upstash DB is never flagged
 *          "inactive" (see docs/runbooks/upstash-archival.md).
 *        • `/api/health/deep` — exposes Redis reachability to
 *          the internal status dashboard.
 *
 * Why the PING route instead of the typed client? The REST PING
 * is a single HTTP request with zero bundle cost and works
 * identically from any runtime. It also sidesteps any transient
 * type-level changes in `@upstash/redis` major versions — the
 * wire format `{ "result": "PONG" }` has been stable since
 * Upstash's REST API went GA.
 *
 * Both helpers never throw — they return structured results so
 * the caller (usually observability plumbing) can decide how to
 * surface failures without fighting with try/catch.
 */

import { logger } from '@/lib/logger'

let _clientPromise: Promise<unknown | null> | null = null

/**
 * Lazily resolves an Upstash Redis client. The return type is
 * intentionally `unknown` so this module does not leak the
 * `@upstash/redis` types into every consumer — rate-limit.ts
 * already handles the typed client path via dynamic import, and
 * the health-check path only needs `.ping()`. Consumers that
 * need the full typed surface should import `@upstash/redis`
 * directly.
 */
export async function getRedis(): Promise<unknown | null> {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null
  }
  if (_clientPromise) return _clientPromise
  _clientPromise = (async () => {
    try {
      const specifier = '@upstash/redis'
      // Keep the specifier behind a dynamic import so tsc and the
      // bundler can tree-shake it out when env vars are absent.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await (
        new Function('s', 'return import(s)') as (s: string) => Promise<unknown>
      )(specifier)
      return mod.Redis.fromEnv()
    } catch (err) {
      logger.warn('getRedis: failed to load @upstash/redis', {
        module: 'redis',
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  })()
  return _clientPromise
}

export interface RedisPingResult {
  ok: boolean
  latencyMs: number
  /** Raw wire response — `"PONG"` on success. */
  result?: string
  /** Present when the check was skipped because env vars are missing. */
  skipped?: boolean
  /** Present on network / auth failure. */
  error?: string
}

/**
 * Sends a single PING via the Upstash REST API.
 *
 * We hit the REST endpoint directly (not the typed client) for
 * three reasons:
 *
 *   • Zero dependency cost — no `@upstash/redis` needed for the
 *     health probe path (still used by rate-limit.ts via dynamic
 *     import, but this keeps /api/health/deep cheap).
 *   • Deterministic 10-second timeout via `AbortController` — we
 *     never block a serverless function waiting for a hung Redis.
 *   • Trivially testable — vitest can stub `fetch` globally.
 *
 * A single successful PING is enough to reset the Upstash
 * "inactive" archival timer; traffic volume does not matter for
 * the free-tier keep-alive policy.
 */
export async function pingRedis(signal?: AbortSignal): Promise<RedisPingResult> {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    return { ok: false, latencyMs: 0, skipped: true, error: 'UPSTASH env vars not set' }
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  const composedSignal = signal
    ? (AbortSignal.any?.([signal, controller.signal]) ?? controller.signal)
    : controller.signal
  const t0 = Date.now()
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/ping`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: composedSignal,
      cache: 'no-store',
    })
    const latencyMs = Date.now() - t0
    if (!res.ok) {
      return {
        ok: false,
        latencyMs,
        error: `HTTP ${res.status}`,
      }
    }
    const body = (await res.json().catch(() => ({}))) as { result?: unknown }
    const result = typeof body.result === 'string' ? body.result : undefined
    return {
      ok: result === 'PONG',
      latencyMs,
      result,
      ...(result !== 'PONG' ? { error: `unexpected result: ${JSON.stringify(body)}` } : {}),
    }
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    clearTimeout(timeout)
  }
}

/** Test-only: reset the memoised client promise. Exported for vitest. */
export function __resetRedisForTests(): void {
  _clientPromise = null
}
