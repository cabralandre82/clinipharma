import { describe, it, expect, beforeEach, vi } from 'vitest'
import { rateLimit } from '@/lib/rate-limit'

describe('rateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('allows requests within the limit', () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 5 })
    const r1 = limiter.check('user-1')
    expect(r1.ok).toBe(true)
    expect(r1.remaining).toBe(4)
  })

  it('tracks remaining count correctly', () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 3 })
    expect(limiter.check('id').remaining).toBe(2)
    expect(limiter.check('id').remaining).toBe(1)
    expect(limiter.check('id').remaining).toBe(0)
  })

  it('blocks requests after limit is reached', () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 2 })
    limiter.check('blocked')
    limiter.check('blocked')
    const result = limiter.check('blocked')
    expect(result.ok).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('resets after the window expires', () => {
    const limiter = rateLimit({ windowMs: 1_000, max: 1 })
    limiter.check('reset-test')
    const blocked = limiter.check('reset-test')
    expect(blocked.ok).toBe(false)

    vi.advanceTimersByTime(1_001)

    const reset = limiter.check('reset-test')
    expect(reset.ok).toBe(true)
    expect(reset.remaining).toBe(0)
  })

  it('uses separate buckets for different identifiers', () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 1 })
    const r1 = limiter.check('user-a')
    const r2 = limiter.check('user-b')
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
  })

  it('returns a resetAt timestamp in the future', () => {
    const limiter = rateLimit({ windowMs: 5_000, max: 10 })
    const result = limiter.check('ts-test')
    expect(result.resetAt).toBeGreaterThan(Date.now())
  })

  it('handles max=1 correctly — first ok, second blocked', () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 1 })
    expect(limiter.check('one').ok).toBe(true)
    expect(limiter.check('one').ok).toBe(false)
  })
})
