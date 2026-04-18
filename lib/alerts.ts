/**
 * Alert dispatch — Wave 6.
 *
 * Lightweight wrapper that routes an alert to the appropriate channel
 * based on severity:
 *
 *   - `critical` / `error` (P1)     → PagerDuty Events API v2 + email
 *   - `warning`           (P2)      → email to OPS_ALERT_EMAIL
 *   - `info`              (P3)      → structured log only
 *
 * Why separate from `monitoring.ts`? monitoring captures anomalies that
 * Sentry will alert on via its own rules. `lib/alerts.ts` is called
 * when the server KNOWS something needs a human now (circuit breaker
 * opened, cron wedged for 2h, audit chain tampered). It is intentionally
 * thin so that a future swap of provider (PagerDuty → OpsGenie) touches
 * one file.
 *
 * Throttling & dedup. Every alert carries a `dedupKey`; the module
 * keeps a per-key cooldown window (default 15min) so repeated failures
 * do not translate to alert storms. Expired keys are GC'd lazily.
 *
 * Feature flags. `alerts.pagerduty_enabled` and `alerts.email_enabled`
 * (seeded in migration 048) act as master switches. When off, the
 * module still logs everything so operators can diagnose via the
 * server_logs panel. This lets us ship the module in shadow mode
 * before committing to PagerDuty spend.
 *
 * @module lib/alerts
 */

import 'server-only'
import { sendEmail } from '@/lib/email'
import { logger } from '@/lib/logger'
import { captureError } from '@/lib/monitoring'
import { isFeatureEnabled } from '@/lib/features'
import { incCounter } from '@/lib/metrics'

export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical'

export interface AlertPayload {
  severity: AlertSeverity
  /** Short human-readable title. Appears as the PagerDuty / email subject. */
  title: string
  /** Free-form explanation. Include runbook link when possible. */
  message: string
  /** Stable identifier used for dedup + resolve. Hash the component+symptom. */
  dedupKey: string
  /** Name of the component emitting the alert (lib/circuit-breaker, cron/guarded, etc.). */
  component: string
  /** Arbitrary structured details — shown in PagerDuty + email body. */
  customDetails?: Record<string, unknown>
}

export interface AlertResolvePayload {
  dedupKey: string
  component: string
  message?: string
}

/** Default cooldown window for the same `dedupKey`. */
const COOLDOWN_MS = 15 * 60 * 1000

/** Map of dedupKey → timestamp of last delivery. Module-level to survive
 *  across warm invocations; GC'd lazily when a key is re-used. */
const cooldowns = new Map<string, number>()

function inCooldown(dedupKey: string, now: number): boolean {
  const last = cooldowns.get(dedupKey)
  if (last === undefined) return false
  if (now - last > COOLDOWN_MS) {
    cooldowns.delete(dedupKey)
    return false
  }
  return true
}

function recordDelivery(dedupKey: string, now: number): void {
  cooldowns.set(dedupKey, now)
}

// ── PagerDuty Events API v2 ─────────────────────────────────────────────────

interface PagerDutyEventAction {
  routing_key: string
  event_action: 'trigger' | 'acknowledge' | 'resolve'
  dedup_key: string
  payload?: {
    summary: string
    source: string
    severity: AlertSeverity
    component?: string
    custom_details?: Record<string, unknown>
  }
}

async function sendPagerDuty(event: PagerDutyEventAction): Promise<boolean> {
  const routingKey = event.routing_key
  if (!routingKey) return false

  try {
    const res = await fetch('https://events.pagerduty.com/v2/enqueue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      logger.error('pagerduty enqueue failed', {
        module: 'alerts',
        status: res.status,
        body: body.slice(0, 500),
      })
      return false
    }
    return true
  } catch (err) {
    logger.error('pagerduty enqueue threw', {
      module: 'alerts',
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

// ── Email formatting ─────────────────────────────────────────────────────────

function formatEmailHtml(payload: AlertPayload): string {
  const details = payload.customDetails
    ? `<pre style="background:#f5f5f5;padding:12px;border-radius:6px;white-space:pre-wrap;word-wrap:break-word">${escapeHtml(
        JSON.stringify(payload.customDetails, null, 2)
      )}</pre>`
    : ''
  const color =
    payload.severity === 'critical'
      ? '#b91c1c'
      : payload.severity === 'error'
        ? '#c2410c'
        : payload.severity === 'warning'
          ? '#b45309'
          : '#1e40af'
  return `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto">
      <h2 style="color:${color}">[${payload.severity.toUpperCase()}] ${escapeHtml(payload.title)}</h2>
      <p><strong>Component:</strong> ${escapeHtml(payload.component)}</p>
      <p><strong>Dedup key:</strong> <code>${escapeHtml(payload.dedupKey)}</code></p>
      <p>${escapeHtml(payload.message)}</p>
      ${details}
      <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
      <p style="color:#999;font-size:12px">
        Sent by Clinipharma lib/alerts at ${new Date().toISOString()}.
      </p>
    </div>
  `
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Raise an alert. Always logs; routes to PagerDuty / email if the
 * corresponding feature flag is enabled AND we're not inside the
 * cooldown window for this `dedupKey`.
 *
 * Returns the channels the alert was actually delivered to — useful
 * for tests and for the caller to know if a human will be paged.
 */
export async function triggerAlert(payload: AlertPayload): Promise<{
  delivered: ('pagerduty' | 'email' | 'log')[]
  deduped: boolean
}> {
  const now = Date.now()

  logger.warn('alert triggered', {
    module: 'alerts',
    severity: payload.severity,
    title: payload.title,
    component: payload.component,
    dedupKey: payload.dedupKey,
    customDetails: payload.customDetails,
  })
  incCounter('alerts_triggered_total', {
    severity: payload.severity,
    component: payload.component,
  })

  if (inCooldown(payload.dedupKey, now)) {
    incCounter('alerts_deduped_total', {
      severity: payload.severity,
      component: payload.component,
    })
    return { delivered: ['log'], deduped: true }
  }

  const delivered: ('pagerduty' | 'email' | 'log')[] = ['log']

  const isUrgent = payload.severity === 'critical' || payload.severity === 'error'
  const emailAllowed = payload.severity !== 'info'

  // PagerDuty only for urgent severities.
  if (isUrgent) {
    const enabled = await isFeatureEnabled('alerts.pagerduty_enabled').catch(() => false)
    const routingKey = process.env.PAGERDUTY_ROUTING_KEY
    if (enabled && routingKey) {
      const ok = await sendPagerDuty({
        routing_key: routingKey,
        event_action: 'trigger',
        dedup_key: payload.dedupKey,
        payload: {
          summary: payload.title,
          source: process.env.VERCEL_URL ?? 'clinipharma.com.br',
          severity: payload.severity,
          component: payload.component,
          custom_details: payload.customDetails,
        },
      })
      if (ok) delivered.push('pagerduty')
    }
  }

  if (emailAllowed) {
    const enabled = await isFeatureEnabled('alerts.email_enabled').catch(() => false)
    const to = process.env.OPS_ALERT_EMAIL
    if (enabled && to) {
      try {
        await sendEmail({
          to,
          subject: `[${payload.severity.toUpperCase()}] ${payload.title}`,
          html: formatEmailHtml(payload),
        })
        delivered.push('email')
      } catch (err) {
        // Never let an email failure throw from the alert path —
        // that would cause cascading failures exactly when the
        // operator needs signal.
        captureError(err, {
          action: 'alerts.email_send_failed',
          extra: { dedupKey: payload.dedupKey, component: payload.component },
        })
      }
    }
  }

  if (delivered.length > 1) {
    recordDelivery(payload.dedupKey, now)
  }

  return { delivered, deduped: false }
}

/**
 * Mark an alert as resolved. Currently only reaches PagerDuty (email
 * resolution is manual — operators typically reply/archive).
 */
export async function resolveAlert(payload: AlertResolvePayload): Promise<boolean> {
  logger.info('alert resolved', {
    module: 'alerts',
    component: payload.component,
    dedupKey: payload.dedupKey,
    message: payload.message,
  })
  incCounter('alerts_resolved_total', { component: payload.component })

  // Resolving in PagerDuty doesn't need the flag check — if the alert
  // was ever sent, we always want to close it.
  const routingKey = process.env.PAGERDUTY_ROUTING_KEY
  if (!routingKey) return false

  const ok = await sendPagerDuty({
    routing_key: routingKey,
    event_action: 'resolve',
    dedup_key: payload.dedupKey,
  })

  cooldowns.delete(payload.dedupKey)
  return ok
}

/** Test-only. */
export const _internal = {
  cooldowns,
  COOLDOWN_MS,
  inCooldown,
  formatEmailHtml,
  escapeHtml,
}
