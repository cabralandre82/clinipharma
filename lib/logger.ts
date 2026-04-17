/**
 * Structured logger for Clinipharma (Wave 1).
 *
 * Responsibilities:
 *
 *  1. **Emit JSON one-line-per-entry** to stdout (captured by Vercel), with
 *     stable keys so downstream tooling (logtail, vector, grep) can parse.
 *
 *  2. **Auto-enrich** every entry with the active request context
 *     (`requestId`, `traceId`, `spanId`, `userId`, `path`, `method`) pulled
 *     from AsyncLocalStorage — no more manual `logger.child({ requestId })`
 *     threading through every service.
 *
 *  3. **Redact PII** via `lib/logger/redact.ts` before serialization — CPF,
 *     CNPJ, emails, phones, JWTs, bearer tokens, service-role keys, card
 *     numbers, and any value under a sensitive key (password, secret,
 *     access_token, cookie, …) are replaced with opaque placeholders.
 *
 *  4. **Persist `warn` and `error`** to `public.server_logs` in production
 *     for admin visibility in the UI (90-day retention via cron).
 *
 *  5. **Enrich Sentry scope** so errors captured by Sentry's global
 *     handlers automatically carry the same requestId/userId/path that
 *     appear in the log line — correlated cross-tool debugging.
 *
 * Non-goals:
 *
 *  - Log shipping beyond stdout + server_logs (Vercel already ships stdout
 *    to their log drain; Sentry already ships errors).
 *  - Sampling. Volume is low enough today.
 *  - Formatters. JSON-only is the contract.
 *
 * This module is import-side-effect free: loading it does NOT open a DB
 * connection nor hit Sentry. All expensive work is deferred to first call.
 */

import { redact } from './logger/redact'
import { getRequestContext } from './logger/context'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogContext {
  requestId?: string
  traceId?: string
  spanId?: string
  userId?: string
  action?: string
  entityType?: string
  entityId?: string
  durationMs?: number
  statusCode?: number
  path?: string
  method?: string
  [key: string]: unknown
}

interface LogEntry extends LogContext {
  level: LogLevel
  message: string
  timestamp: string
  env: string
}

function buildEntry(level: LogLevel, message: string, context?: LogContext): LogEntry {
  const ctx = getRequestContext()
  const ambient: LogContext = ctx
    ? {
        requestId: ctx.requestId,
        traceId: ctx.traceId,
        spanId: ctx.spanId,
        userId: ctx.userId,
        path: ctx.path,
        method: ctx.method,
      }
    : {}

  // Strip undefined so JSON output stays clean.
  const merged: LogContext = {}
  for (const src of [ambient, context ?? {}]) {
    for (const [k, v] of Object.entries(src)) {
      if (v !== undefined) merged[k] = v
    }
  }

  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV ?? 'development',
    ...merged,
  }

  return redact(entry as unknown as Record<string, unknown>) as unknown as LogEntry
}

function output(entry: LogEntry): void {
  const line = JSON.stringify(entry)
  switch (entry.level) {
    case 'error':
      console.error(line)
      break
    case 'warn':
      console.warn(line)
      break
    case 'debug':
      if (process.env.NODE_ENV !== 'production') console.debug(line)
      break
    default:
      console.log(line)
  }

  if (
    (entry.level === 'error' || entry.level === 'warn') &&
    process.env.NODE_ENV === 'production'
  ) {
    persistLog(entry).catch(() => null)
  }

  // Breadcrumb into Sentry for every warn/error so the run-up to an
  // exception is visible in the Sentry trace. Loaded lazily and wrapped
  // in try/catch to avoid any feedback loop if Sentry itself is the
  // source of the error we're logging.
  if (entry.level === 'error' || entry.level === 'warn') {
    reportToSentry(entry).catch(() => null)
  }
}

async function persistLog(entry: LogEntry): Promise<void> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) return

    const { requestId, path, traceId, spanId, ...context } = entry as LogEntry & {
      requestId?: string
      path?: string
      traceId?: string
      spanId?: string
    }
    await fetch(`${url}/rest/v1/server_logs`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        level: entry.level,
        message: entry.message,
        route: path ?? null,
        request_id: requestId ?? null,
        // `context` is already redacted (redact() ran in buildEntry); the
        // only non-PII fields we peel off are the top-level correlation ids.
        context: {
          ...context,
          traceId,
          spanId,
        },
      }),
    })
  } catch {
    // Never throw from logger — fail silently
  }
}

async function reportToSentry(entry: LogEntry): Promise<void> {
  try {
    // Skip in tests and when Sentry DSN isn't set (no-op mode).
    if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return
    const Sentry = await import('@sentry/nextjs').catch(() => null)
    if (!Sentry) return

    Sentry.withScope((scope) => {
      scope.setLevel(entry.level === 'error' ? 'error' : 'warning')
      if (entry.requestId) scope.setTag('request_id', String(entry.requestId))
      if (entry.traceId) scope.setTag('trace_id', String(entry.traceId))
      if (entry.userId) scope.setUser({ id: String(entry.userId) })
      if (entry.path) scope.setTag('route', String(entry.path))
      scope.setContext('log_entry', entry as unknown as Record<string, unknown>)
      if (entry.level === 'error') {
        Sentry.captureMessage(entry.message, 'error')
      } else {
        Sentry.addBreadcrumb({
          category: 'log',
          level: 'warning',
          message: entry.message,
          data: entry as unknown as Record<string, unknown>,
        })
      }
    })
  } catch {
    // Swallow — the logger must never fail the request.
  }
}

export const logger = {
  debug(message: string, context?: LogContext): void {
    output(buildEntry('debug', message, context))
  },

  info(message: string, context?: LogContext): void {
    output(buildEntry('info', message, context))
  },

  warn(message: string, context?: LogContext): void {
    output(buildEntry('warn', message, context))
  },

  error(message: string, context?: LogContext & { error?: unknown }): void {
    const { error, ...rest } = context ?? {}
    const errorContext: LogContext = { ...rest }

    if (error instanceof Error) {
      errorContext.errorMessage = error.message
      errorContext.errorStack = error.stack
      errorContext.errorName = error.name
    } else if (error !== undefined) {
      errorContext.errorRaw = String(error)
    }

    output(buildEntry('error', message, errorContext))
  },

  /**
   * Returns a child logger with fixed context. Rarely needed after Wave 1 —
   * the ambient request context already covers the common case — but still
   * useful for per-iteration context in batch jobs (e.g. `child({ orderId })`
   * inside a loop over 10k orders).
   */
  child(fixedContext: LogContext) {
    return {
      debug: (message: string, ctx?: LogContext) =>
        logger.debug(message, { ...fixedContext, ...ctx }),
      info: (message: string, ctx?: LogContext) =>
        logger.info(message, { ...fixedContext, ...ctx }),
      warn: (message: string, ctx?: LogContext) =>
        logger.warn(message, { ...fixedContext, ...ctx }),
      error: (message: string, ctx?: LogContext & { error?: unknown }) =>
        logger.error(message, { ...fixedContext, ...ctx }),
    }
  },
}

export type Logger = typeof logger
export type ChildLogger = ReturnType<typeof logger.child>

export {
  runWithRequestContext,
  withCronContext,
  withWebhookContext,
  updateRequestContext,
  getRequestContext,
} from './logger/context'
export type { RequestContext } from './logger/context'
