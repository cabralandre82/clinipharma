/**
 * Cloudflare Turnstile — server-side verification (Wave 10).
 *
 * Turnstile is Cloudflare's privacy-preserving CAPTCHA (the
 * replacement for reCAPTCHA). Flow:
 *
 *   1. Client renders the widget. On success it produces a
 *      short-lived token (~300 chars) that the server must
 *      verify within 5 minutes, single-use.
 *
 *   2. Server POSTs `{secret, response, remoteip}` to Cloudflare
 *      (`/turnstile/v0/siteverify`). Cloudflare responds with
 *      `{success: bool, error-codes: string[]}`.
 *
 * ### Fail-open policy
 *
 * When `TURNSTILE_SECRET_KEY` is missing or the feature flag
 * `security.turnstile_enforce` is OFF, `verifyTurnstile()`
 * returns `{ ok: true, bypass: 'disabled' }`. This is deliberate:
 *   • While we're rolling out, half the public forms don't
 *     render the widget yet, and we don't want to 403 everyone.
 *   • Cloudflare itself has outages; failing open keeps the
 *     site usable. Brute-force protection still lives in the
 *     sliding-window rate limiter (Wave 10), so Turnstile is a
 *     second layer, not a single point of failure.
 *
 * ### Flip to enforce
 *
 * Once rate-limit metrics show a stable false-positive baseline
 * (<0.1% denied legit traffic), set the feature flag to ON in
 * production and the verifier returns `{ ok: false }` when no
 * token is present. Route handlers must then 403.
 *
 * @module lib/turnstile
 */

import 'server-only'
import { logger } from '@/lib/logger'
import { incCounter, observeHistogram } from '@/lib/metrics'
import { Metrics } from '@/lib/metrics'
import { isFeatureEnabled } from '@/lib/features'

/**
 * Cloudflare-published testing secrets. Using these in dev/CI
 * lets us exercise the full HTTP round-trip without real keys.
 *
 * Ref: https://developers.cloudflare.com/turnstile/troubleshooting/testing/
 *
 *   1x0000000000000000000000000000000AA → always passes
 *   2x0000000000000000000000000000000AA → always fails
 *   3x0000000000000000000000000000000AA → always returns "token-already-spent"
 */
export const TURNSTILE_DUMMY_SECRET_PASS = '1x0000000000000000000000000000000AA'

const VERIFY_ENDPOINT = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export interface TurnstileVerifyResult {
  ok: boolean
  /** Why the caller was accepted without a real check ('disabled' =
   *  feature flag off, 'no-secret' = no TURNSTILE_SECRET_KEY). */
  bypass?: 'disabled' | 'no-secret' | 'flag-off'
  /** Cloudflare-returned error codes on failure (for logging, not for UI). */
  errorCodes?: string[]
  /** 'timeout-or-duplicate' events raise noise, not errors. */
  softFailure?: boolean
  /** The idempotent action name submitted from the widget (optional). */
  action?: string
}

export interface VerifyArgs {
  /** The `cf-turnstile-response` value posted by the widget. */
  token: string | null | undefined
  /** Client IP. Cloudflare scores it against the token's issuing geo. */
  remoteIp?: string | null
  /** Route-stable label so metrics can slice by form. */
  bucket: string
  /** Force enforce regardless of feature flag (used for webhook-like
   *  endpoints that must never auto-bypass). Default false. */
  required?: boolean
}

/**
 * Verify a Turnstile token with Cloudflare.
 *
 * Never throws — network/Cloudflare errors result in
 * `{ ok: false, errorCodes: ['internal-error'] }` so callers
 * don't need try/catch noise. A missing token + disabled flag
 * returns `{ ok: true, bypass: 'flag-off' }`.
 */
export async function verifyTurnstile(args: VerifyArgs): Promise<TurnstileVerifyResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  const enforced =
    args.required === true ||
    (await isFeatureEnabled('security.turnstile_enforce').catch(() => false))

  // Bypass path: if the feature flag is OFF AND `required` is
  // not forced, we skip the network round-trip entirely. This
  // is both a dev convenience and a production safety valve.
  if (!enforced) {
    incCounter(Metrics.TURNSTILE_VERIFY_TOTAL, { bucket: args.bucket, outcome: 'bypass_flag' })
    return { ok: true, bypass: 'flag-off' }
  }

  if (!secret) {
    // Flag is ON but no secret — this is a misconfiguration; we
    // log and fail CLOSED because someone explicitly turned on
    // the flag so they expect enforcement.
    logger.error('TURNSTILE_SECRET_KEY missing with flag ON', {
      module: 'turnstile',
      bucket: args.bucket,
    })
    incCounter(Metrics.TURNSTILE_VERIFY_TOTAL, { bucket: args.bucket, outcome: 'no_secret' })
    return { ok: false, errorCodes: ['missing-input-secret'] }
  }

  if (!args.token || typeof args.token !== 'string' || args.token.length < 20) {
    incCounter(Metrics.TURNSTILE_VERIFY_TOTAL, { bucket: args.bucket, outcome: 'missing_token' })
    return { ok: false, errorCodes: ['missing-input-response'] }
  }

  const form = new URLSearchParams()
  form.set('secret', secret)
  form.set('response', args.token)
  if (args.remoteIp) form.set('remoteip', args.remoteIp)

  const t0 = Date.now()
  try {
    // 5s timeout so a Cloudflare brownout doesn't hold request
    // threads open. Using AbortController because global
    // `fetch` in Node 20 respects it and Edge does too.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    const resp = await fetch(VERIFY_ENDPOINT, {
      method: 'POST',
      body: form,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!resp.ok) {
      logger.warn('turnstile siteverify non-2xx', {
        module: 'turnstile',
        bucket: args.bucket,
        status: resp.status,
      })
      incCounter(Metrics.TURNSTILE_VERIFY_TOTAL, { bucket: args.bucket, outcome: 'http_error' })
      return { ok: false, errorCodes: ['internal-error'] }
    }

    const data = (await resp.json()) as {
      success: boolean
      'error-codes'?: string[]
      action?: string
      challenge_ts?: string
      hostname?: string
    }

    observeHistogram(Metrics.TURNSTILE_VERIFY_DURATION_MS, Date.now() - t0, {
      bucket: args.bucket,
    })

    const codes = data['error-codes'] ?? []
    // "timeout-or-duplicate" is not a security failure; it
    // means the user clicked submit twice after a stale token.
    // We still return ok:false but flag softFailure so the
    // route can show a gentle "please try again" message
    // instead of incrementing an abuse counter.
    const softFailure = codes.length === 1 && codes[0] === 'timeout-or-duplicate'

    incCounter(Metrics.TURNSTILE_VERIFY_TOTAL, {
      bucket: args.bucket,
      outcome: data.success ? 'ok' : softFailure ? 'soft_fail' : 'hard_fail',
    })

    return {
      ok: data.success === true,
      errorCodes: data.success ? undefined : codes,
      action: data.action,
      softFailure,
    }
  } catch (err) {
    observeHistogram(Metrics.TURNSTILE_VERIFY_DURATION_MS, Date.now() - t0, {
      bucket: args.bucket,
    })
    logger.warn('turnstile verify threw', {
      module: 'turnstile',
      bucket: args.bucket,
      error: err instanceof Error ? err.message : String(err),
    })
    incCounter(Metrics.TURNSTILE_VERIFY_TOTAL, { bucket: args.bucket, outcome: 'exception' })
    return { ok: false, errorCodes: ['internal-error'] }
  }
}

/**
 * Shortcut that extracts the token from common request shapes.
 *
 *   • JSON: `{ turnstileToken: "..." }` or `{ "cf-turnstile-response": "..." }`
 *   • FormData: `cf-turnstile-response`
 *
 * Returns null if no token could be found.
 */
export async function extractTurnstileToken(req: Request): Promise<string | null> {
  const h = req.headers.get('x-turnstile-token')
  if (h) return h

  // Cloning because the caller usually needs the body too.
  try {
    const clone = req.clone()
    const ct = clone.headers.get('content-type') ?? ''
    if (ct.includes('application/json')) {
      const body = (await clone.json()) as Record<string, unknown>
      const t =
        (body.turnstileToken as string | undefined) ??
        (body['cf-turnstile-response'] as string | undefined) ??
        null
      return typeof t === 'string' ? t : null
    }
    if (ct.includes('multipart/form-data') || ct.includes('application/x-www-form-urlencoded')) {
      const fd = await clone.formData()
      const t = fd.get('cf-turnstile-response')
      return typeof t === 'string' ? t : null
    }
  } catch {
    // Body already consumed by caller — that's OK, they can
    // pass the token explicitly via `verifyTurnstile({ token })`.
  }
  return null
}
