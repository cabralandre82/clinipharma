/**
 * Simple in-memory rate limiter for API routes.
 *
 * NOTE: This works per-instance (serverless) — for multi-instance production,
 * replace with Upstash Redis: https://upstash.com/docs/redis/sdks/ratelimit
 *
 * Usage:
 *   const rl = rateLimit({ windowMs: 60_000, max: 5 })
 *   const result = rl.check(identifier)
 *   if (!result.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
 */

interface RateLimitStore {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitStore>()

// Cleanup stale entries every 5 minutes
if (typeof globalThis !== 'undefined' && !('_rlCleanup' in globalThis)) {
  ;(globalThis as Record<string, unknown>)._rlCleanup = setInterval(
    () => {
      const now = Date.now()
      for (const [key, val] of store.entries()) {
        if (val.resetAt <= now) store.delete(key)
      }
    },
    5 * 60 * 1000
  )
}

export interface RateLimitOptions {
  /** Window in milliseconds */
  windowMs: number
  /** Max requests per window */
  max: number
}

export interface RateLimitResult {
  ok: boolean
  remaining: number
  resetAt: number
}

export function rateLimit(opts: RateLimitOptions) {
  return {
    check(identifier: string): RateLimitResult {
      const now = Date.now()
      const existing = store.get(identifier)

      if (!existing || existing.resetAt <= now) {
        const resetAt = now + opts.windowMs
        store.set(identifier, { count: 1, resetAt })
        return { ok: true, remaining: opts.max - 1, resetAt }
      }

      if (existing.count >= opts.max) {
        return { ok: false, remaining: 0, resetAt: existing.resetAt }
      }

      existing.count++
      return { ok: true, remaining: opts.max - existing.count, resetAt: existing.resetAt }
    },
  }
}

/** Pre-configured limiters for common use cases */
export const authLimiter = rateLimit({ windowMs: 60_000, max: 5 }) // 5/min per IP
export const registrationLimiter = rateLimit({ windowMs: 60_000 * 10, max: 3 }) // 3/10min per IP
export const apiLimiter = rateLimit({ windowMs: 60_000, max: 60 }) // 60/min per user
