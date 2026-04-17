import { captureError } from '@/lib/monitoring'
import { logger } from '@/lib/logger'

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
    } else {
      throw new CircuitOpenError(name)
    }
  }

  try {
    const result = await fn()

    // Success: reset circuit
    if (circuit.state === 'HALF_OPEN') {
      circuit.state = 'CLOSED'
      circuit.failures = 0
      circuit.openedAt = null
      circuit.lastFailureAt = null
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
