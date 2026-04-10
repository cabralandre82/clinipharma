import { describe, it, expect, vi } from 'vitest'
import { withCircuitBreaker, CircuitOpenError, getCircuitStates } from '@/lib/circuit-breaker'

// Reset module-level circuit state between tests
// (circuits Map is module-level, so we need to clear it via a fresh import or workaround)
// We use different service names per describe block to avoid state leakage.

describe('withCircuitBreaker — CLOSED state (normal operation)', () => {
  it('returns result of successful fn call', async () => {
    const result = await withCircuitBreaker(() => Promise.resolve('ok'), { name: 'test-success-1' })
    expect(result).toBe('ok')
  })

  it('propagates error from fn without opening circuit (below threshold)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'))

    await expect(
      withCircuitBreaker(fn, { name: 'test-below-threshold', failureThreshold: 3 })
    ).rejects.toThrow('boom')

    // After 1 failure (threshold=3), circuit is still CLOSED
    const state = getCircuitStates()['test-below-threshold']
    expect(state.state).toBe('CLOSED')
    expect(state.failures).toBe(1)
  })

  it('resets failure count on success', async () => {
    const name = 'test-reset-on-success'

    // Fail once
    await expect(
      withCircuitBreaker(() => Promise.reject(new Error('fail')), { name, failureThreshold: 3 })
    ).rejects.toThrow()

    // Succeed — should reset failures to 0
    await withCircuitBreaker(() => Promise.resolve('ok'), { name, failureThreshold: 3 })

    const state = getCircuitStates()[name]
    expect(state.failures).toBe(0)
    expect(state.state).toBe('CLOSED')
  })
})

describe('withCircuitBreaker — OPEN state (after threshold failures)', () => {
  it('opens circuit after reaching failureThreshold', async () => {
    const name = 'test-opens-at-threshold'
    const fn = vi.fn().mockRejectedValue(new Error('service down'))

    for (let i = 0; i < 3; i++) {
      await expect(withCircuitBreaker(fn, { name, failureThreshold: 3 })).rejects.toThrow()
    }

    const state = getCircuitStates()[name]
    expect(state.state).toBe('OPEN')
  })

  it('throws CircuitOpenError immediately when OPEN (does not call fn)', async () => {
    const name = 'test-open-rejects-immediately'
    const fn = vi.fn().mockRejectedValue(new Error('service down'))

    // Open the circuit
    for (let i = 0; i < 3; i++) {
      await expect(withCircuitBreaker(fn, { name, failureThreshold: 3 })).rejects.toThrow()
    }

    fn.mockClear()

    // Next call should throw CircuitOpenError without calling fn
    await expect(withCircuitBreaker(fn, { name, failureThreshold: 3 })).rejects.toThrow(
      CircuitOpenError
    )

    expect(fn).not.toHaveBeenCalled()
  })

  it('CircuitOpenError has correct message', async () => {
    const name = 'test-open-error-message'
    const fn = vi.fn().mockRejectedValue(new Error('down'))

    for (let i = 0; i < 3; i++) {
      await expect(withCircuitBreaker(fn, { name, failureThreshold: 3 })).rejects.toThrow()
    }

    const err = await withCircuitBreaker(fn, { name, failureThreshold: 3 }).catch((e) => e)
    expect(err).toBeInstanceOf(CircuitOpenError)
    expect(err.message).toContain(name)
    expect(err.message).toContain('unavailable')
  })
})

describe('withCircuitBreaker — HALF_OPEN state (recovery)', () => {
  it('transitions to HALF_OPEN after recoveryTimeMs', async () => {
    vi.useFakeTimers()

    const name = 'test-half-open-transition'
    const fn = vi.fn().mockRejectedValue(new Error('down'))

    // Open the circuit
    for (let i = 0; i < 3; i++) {
      await expect(
        withCircuitBreaker(fn, { name, failureThreshold: 3, recoveryTimeMs: 1000 })
      ).rejects.toThrow()
    }

    expect(getCircuitStates()[name].state).toBe('OPEN')

    // Advance time past recovery window
    vi.advanceTimersByTime(1100)

    // Now make fn succeed — circuit should close
    fn.mockResolvedValueOnce('recovered')
    const result = await withCircuitBreaker(fn, { name, failureThreshold: 3, recoveryTimeMs: 1000 })
    expect(result).toBe('recovered')
    expect(getCircuitStates()[name].state).toBe('CLOSED')
    expect(getCircuitStates()[name].failures).toBe(0)

    vi.useRealTimers()
  })

  it('reopens circuit if HALF_OPEN probe fails', async () => {
    vi.useFakeTimers()

    const name = 'test-half-open-reopen'
    const fn = vi.fn().mockRejectedValue(new Error('still down'))

    // Open the circuit
    for (let i = 0; i < 3; i++) {
      await expect(
        withCircuitBreaker(fn, { name, failureThreshold: 3, recoveryTimeMs: 500 })
      ).rejects.toThrow()
    }

    // Advance time to trigger HALF_OPEN
    vi.advanceTimersByTime(600)

    // Probe fails — should reopen
    await expect(
      withCircuitBreaker(fn, { name, failureThreshold: 3, recoveryTimeMs: 500 })
    ).rejects.toThrow('still down')

    expect(getCircuitStates()[name].state).toBe('OPEN')

    vi.useRealTimers()
  })
})

describe('getCircuitStates', () => {
  it('returns state map with all tracked circuits', async () => {
    await withCircuitBreaker(() => Promise.resolve('x'), { name: 'test-states-a' })
    const states = getCircuitStates()
    expect(states['test-states-a']).toBeDefined()
    expect(states['test-states-a'].state).toBe('CLOSED')
  })
})
