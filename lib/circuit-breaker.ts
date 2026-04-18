import { captureError } from '@/lib/monitoring'
import { logger } from '@/lib/logger'
import { setGauge, Metrics } from '@/lib/metrics'

/**
 * Circuit Breaker — prevents cascade failures when external services are down.
 *
 * States:
 *  CLOSED   → Normal operation. Failures are counted.
 *  OPEN     → Service is down. All calls fail immediately without hitting the service.
 *  HALF_OPEN → Testing recovery. One probe call is allowed through.
 *
 * Transitions:
 *  CLOSED  → OPEN      after `failureThreshold` consecutive failures within `windowMs`
 *  OPEN    → HALF_OPEN after `recoveryTimeMs` has elapsed
 *  HALF_OPEN → CLOSED  if the probe call succeeds
 *  HALF_OPEN → OPEN    if the probe call fails
 */

type State = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

interface CircuitBreakerOptions {
  /** Number of consecutive failures to open the circuit. Default: 3 */
  failureThreshold?: number
  /** How long (ms) to wait before trying to recover. Default: 30_000 (30s) */
  recoveryTimeMs?: number
  /** Name of the service — used in error messages and Sentry alerts. */
  name: string
}

interface CircuitBreakerState {
  state: State
  failures: number
  lastFailureAt: number | null
  openedAt: number | null
}

// Module-level store — persists across warm serverless invocations
const circuits = new Map<string, CircuitBreakerState>()

function getCircuit(name: string): CircuitBreakerState {
  if (!circuits.has(name)) {
    circuits.set(name, { state: 'CLOSED', failures: 0, lastFailureAt: null, openedAt: null })
  }
  return circuits.get(name)!
}

export class CircuitOpenError extends Error {
  constructor(serviceName: string) {
    super(`Circuit OPEN: ${serviceName} is unavailable. Try again in a few seconds.`)
    this.name = 'CircuitOpenError'
  }
}

/**
 * Wrap an async call with circuit breaker protection.
 *
 * @example
 * const result = await withCircuitBreaker('asaas', () => createPayment(...), { name: 'asaas' })
 */
export async function withCircuitBreaker<T>(
  fn: () => Promise<T>,
  opts: CircuitBreakerOptions
): Promise<T> {
  const { name, failureThreshold = 3, recoveryTimeMs = 30_000 } = opts
  const circuit = getCircuit(name)
  const now = Date.now()

  // OPEN: check if recovery time has elapsed → transition to HALF_OPEN
  if (circuit.state === 'OPEN') {
    if (circuit.openedAt !== null && now - circuit.openedAt >= recoveryTimeMs) {
      circuit.state = 'HALF_OPEN'
      setGauge(Metrics.CIRCUIT_BREAKER_STATE, 1, { name })
    } else {
      throw new CircuitOpenError(name)
    }
  }

  try {
    const result = await fn()

    // Success: reset circuit
    if (circuit.state === 'HALF_OPEN') {
      const wasHalfOpen = true
      circuit.state = 'CLOSED'
      circuit.failures = 0
      circuit.openedAt = null
      circuit.lastFailureAt = null
      setGauge(Metrics.CIRCUIT_BREAKER_STATE, 0, { name })
      if (wasHalfOpen) {
        void (async () => {
          try {
            const { resolveAlert } = await import('@/lib/alerts')
            await resolveAlert({
              dedupKey: `circuit-breaker:${name}:open`,
              component: 'lib/circuit-breaker',
              message: 'Circuit breaker recovered (CLOSED).',
            })
          } catch {
            /* best effort */
          }
        })()
      }
    } else if (circuit.state === 'CLOSED') {
      circuit.failures = 0
    }

    return result
  } catch (err) {
    // Don't count CircuitOpenError as a failure (it's already open)
    if (err instanceof CircuitOpenError) throw err

    circuit.failures += 1
    circuit.lastFailureAt = now

    if (circuit.state === 'HALF_OPEN' || circuit.failures >= failureThreshold) {
      const wasAlreadyOpen = (circuit.state as string) === 'OPEN'
      circuit.state = 'OPEN'
      circuit.openedAt = now
      setGauge(Metrics.CIRCUIT_BREAKER_STATE, 2, { name })

      if (!wasAlreadyOpen) {
        // Alert on circuit open — this means the external service is down
        captureError(new Error(`Circuit OPENED for ${name} after ${circuit.failures} failures`), {
          action: 'circuit_breaker_open',
          extra: { service: name, failures: circuit.failures },
        })
        logger.error('Circuit breaker OPENED', {
          module: 'circuit-breaker',
          circuit: name,
          failures: circuit.failures,
        })
        // Fire a P1 alert. Imported lazily to avoid a cycle: lib/alerts →
        // lib/email → lib/circuit-breaker. This dynamic import keeps the
        // module graph a DAG even while the breaker stays the sink for
        // "something is on fire" signals.
        void (async () => {
          try {
            const { triggerAlert } = await import('@/lib/alerts')
            await triggerAlert({
              severity: 'critical',
              title: `Circuit breaker OPEN: ${name}`,
              message: `The ${name} downstream circuit has opened after ${circuit.failures} consecutive failures. Calls to ${name} will fail fast until it recovers.`,
              dedupKey: `circuit-breaker:${name}:open`,
              component: 'lib/circuit-breaker',
              customDetails: {
                service: name,
                failures: circuit.failures,
                openedAt: new Date(now).toISOString(),
              },
            })
          } catch {
            // Alert dispatch is best-effort — never let it surface.
          }
        })()
      }
    }

    throw err
  }
}

/** Get current state of all circuits — for health check endpoint. */
export function getCircuitStates(): Record<string, { state: State; failures: number }> {
  const result: Record<string, { state: State; failures: number }> = {}
  circuits.forEach((v, k) => {
    result[k] = { state: v.state, failures: v.failures }
  })
  return result
}
