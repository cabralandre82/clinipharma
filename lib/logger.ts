/**
 * Structured logger for Clinipharma.
 *
 * Outputs JSON-formatted logs to stdout (captured by Vercel).
 * error and warn levels are also persisted to server_logs table in Supabase
 * for long-term retention and admin visibility (90-day retention via cron).
 *
 * Fields per log entry:
 *   level, message, timestamp, requestId?, userId?, action?, durationMs?, error?, [context]
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogContext {
  requestId?: string
  userId?: string
  action?: string
  entityType?: string
  entityId?: string
  durationMs?: number
  statusCode?: number
  path?: string
  [key: string]: unknown
}

interface LogEntry extends LogContext {
  level: LogLevel
  message: string
  timestamp: string
  env: string
}

function buildEntry(level: LogLevel, message: string, context?: LogContext): LogEntry {
  return {
    level,
    message,
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV ?? 'development',
    ...context,
  }
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

  // Persist error/warn to Supabase for long-term retention (fire-and-forget)
  if (
    (entry.level === 'error' || entry.level === 'warn') &&
    process.env.NODE_ENV === 'production'
  ) {
    persistLog(entry).catch(() => null)
  }
}

async function persistLog(entry: LogEntry): Promise<void> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) return

    const { requestId, path, ...context } = entry as LogEntry & {
      requestId?: string
      path?: string
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
        context: Object.keys(context).length > 1 ? context : null,
      }),
    })
  } catch {
    // Never throw from logger — fail silently
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

  /** Returns a child logger with fixed context (e.g. per-request requestId). */
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
