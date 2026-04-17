/**
 * Monitoring abstraction layer.
 *
 * All application code imports from here — never directly from @sentry/nextjs.
 * This makes it trivial to swap providers (Sentry → Datadog, etc.)
 * and ensures no errors are thrown when Sentry is not configured.
 */
import * as Sentry from '@sentry/nextjs'
import { logger } from '@/lib/logger'

export interface ErrorContext {
  userId?: string
  role?: string
  action?: string
  entity?: string
  entityId?: string
  extra?: Record<string, unknown>
}

/**
 * Capture an unexpected error with optional context.
 * No-op when Sentry DSN is not configured.
 */
export function captureError(error: unknown, context?: ErrorContext): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
    // Fallback: structured logging through our logger (PII-redacted, auto-enriched)
    logger.error(error instanceof Error ? error.message : String(error), {
      module: 'monitoring',
      error,
      ...context,
    })
    return
  }

  Sentry.withScope((scope) => {
    if (context?.userId) scope.setUser({ id: context.userId })
    if (context?.role) scope.setTag('role', context.role)
    if (context?.action) scope.setTag('action', context.action)
    if (context?.entity) scope.setTag('entity', context.entity)
    if (context?.entityId) scope.setExtra('entityId', context.entityId)
    if (context?.extra) {
      Object.entries(context.extra).forEach(([k, v]) => scope.setExtra(k, v))
    }
    Sentry.captureException(error)
  })
}

/**
 * Record a custom metric / breadcrumb.
 * Useful for tracking slow queries, cache misses, etc.
 */
export function recordMetric(message: string, data?: Record<string, unknown>): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
    if (process.env.NODE_ENV !== 'production') {
      logger.debug(message, { module: 'metric', ...data })
    }
    return
  }

  Sentry.addBreadcrumb({
    message,
    data,
    level: 'info',
  })
}

/**
 * Set the current user context for all subsequent events in this request.
 */
export function identifyUser(userId: string, role?: string): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return
  Sentry.setUser({ id: userId, role })
}
