import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { STALE_THRESHOLDS, getStaleThreshold, getDaysDiff } from '@/lib/stale-orders'

// ── getStaleThreshold ────────────────────────────────────────────────────────

describe('getStaleThreshold', () => {
  it('returns 3 for financial/doc phases', () => {
    expect(getStaleThreshold('AWAITING_DOCUMENTS')).toBe(3)
    expect(getStaleThreshold('READY_FOR_REVIEW')).toBe(3)
    expect(getStaleThreshold('AWAITING_PAYMENT')).toBe(3)
    expect(getStaleThreshold('PAYMENT_UNDER_REVIEW')).toBe(3)
    expect(getStaleThreshold('COMMISSION_CALCULATED')).toBe(3)
    expect(getStaleThreshold('TRANSFER_PENDING')).toBe(3)
    expect(getStaleThreshold('READY')).toBe(3)
  })

  it('returns 5 for operational/delivery phases', () => {
    expect(getStaleThreshold('RELEASED_FOR_EXECUTION')).toBe(5)
    expect(getStaleThreshold('RECEIVED_BY_PHARMACY')).toBe(5)
    expect(getStaleThreshold('IN_EXECUTION')).toBe(5)
    expect(getStaleThreshold('SHIPPED')).toBe(5)
  })

  it('returns null for terminal or excluded statuses', () => {
    expect(getStaleThreshold('COMPLETED')).toBeNull()
    expect(getStaleThreshold('CANCELED')).toBeNull()
    expect(getStaleThreshold('DRAFT')).toBeNull()
  })

  it('returns null for unknown status', () => {
    expect(getStaleThreshold('UNKNOWN_STATUS')).toBeNull()
  })

  it('has all expected statuses in STALE_THRESHOLDS', () => {
    expect(Object.keys(STALE_THRESHOLDS).length).toBeGreaterThanOrEqual(10)
  })

  it('all thresholds are positive numbers', () => {
    for (const [, v] of Object.entries(STALE_THRESHOLDS)) {
      expect(v).toBeGreaterThan(0)
    }
  })
})

// ── getDaysDiff ──────────────────────────────────────────────────────────────

describe('getDaysDiff', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-10T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns 0 for today', () => {
    expect(getDaysDiff('2026-04-10T12:00:00Z')).toBe(0)
  })

  it('returns 1 for yesterday', () => {
    expect(getDaysDiff('2026-04-09T12:00:00Z')).toBe(1)
  })

  it('returns 3 for 3 days ago', () => {
    expect(getDaysDiff('2026-04-07T12:00:00Z')).toBe(3)
  })

  it('returns 5 for 5 days ago', () => {
    expect(getDaysDiff('2026-04-05T12:00:00Z')).toBe(5)
  })

  it('returns integer (floors partial days)', () => {
    // 1.5 days ago
    const d = new Date('2026-04-08T23:59:59Z').toISOString()
    const result = getDaysDiff(d)
    expect(Number.isInteger(result)).toBe(true)
    expect(result).toBe(1)
  })
})

// ── Stale detection logic ────────────────────────────────────────────────────

describe('Stale order detection logic', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-10T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('detects AWAITING_PAYMENT stale after 3 days', () => {
    const threshold = getStaleThreshold('AWAITING_PAYMENT')!
    const days = getDaysDiff('2026-04-07T12:00:00Z')
    expect(days >= threshold).toBe(true)
  })

  it('does NOT flag AWAITING_PAYMENT at 2 days', () => {
    const threshold = getStaleThreshold('AWAITING_PAYMENT')!
    const days = getDaysDiff('2026-04-08T12:00:00Z')
    expect(days >= threshold).toBe(false)
  })

  it('detects IN_EXECUTION stale after 5 days', () => {
    const threshold = getStaleThreshold('IN_EXECUTION')!
    const days = getDaysDiff('2026-04-05T12:00:00Z')
    expect(days >= threshold).toBe(true)
  })

  it('does NOT flag IN_EXECUTION at 4 days', () => {
    const threshold = getStaleThreshold('IN_EXECUTION')!
    const days = getDaysDiff('2026-04-06T12:00:00Z')
    expect(days >= threshold).toBe(false)
  })

  it('COMPLETED never triggers stale', () => {
    expect(getStaleThreshold('COMPLETED')).toBeNull()
  })

  it('CANCELED never triggers stale', () => {
    expect(getStaleThreshold('CANCELED')).toBeNull()
  })

  it('DRAFT never triggers stale', () => {
    expect(getStaleThreshold('DRAFT')).toBeNull()
  })
})
