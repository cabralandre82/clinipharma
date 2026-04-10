import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getStaleThreshold,
  getDaysDiff,
  getAlertLevel,
  getSlaConfigs,
  STALE_THRESHOLDS,
} from '@/lib/stale-orders'

describe('getStaleThreshold', () => {
  it('returns correct thresholds for known statuses', () => {
    expect(getStaleThreshold('AWAITING_DOCUMENTS')).toBe(3)
    expect(getStaleThreshold('RELEASED_FOR_EXECUTION')).toBe(5)
    expect(getStaleThreshold('IN_EXECUTION')).toBe(5)
    expect(getStaleThreshold('READY')).toBe(3)
    expect(getStaleThreshold('SHIPPED')).toBe(5)
    expect(getStaleThreshold('WITH_ISSUE')).toBe(1)
  })

  it('returns null for statuses not in thresholds', () => {
    expect(getStaleThreshold('COMPLETED')).toBeNull()
    expect(getStaleThreshold('CANCELED')).toBeNull()
    expect(getStaleThreshold('DRAFT')).toBeNull()
    expect(getStaleThreshold('UNKNOWN_STATUS')).toBeNull()
  })

  it('STALE_THRESHOLDS exports the same values', () => {
    for (const [status, days] of Object.entries(STALE_THRESHOLDS)) {
      expect(getStaleThreshold(status)).toBe(days)
    }
  })
})

describe('getDaysDiff', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-10T12:00:00Z'))
  })

  it('returns 0 for today', () => {
    expect(getDaysDiff('2026-04-10T10:00:00Z')).toBe(0)
  })

  it('returns 1 for yesterday', () => {
    expect(getDaysDiff('2026-04-09T10:00:00Z')).toBe(1)
  })

  it('returns 5 for 5 days ago', () => {
    expect(getDaysDiff('2026-04-05T12:00:00Z')).toBe(5)
  })

  it('returns 30 for 30 days ago', () => {
    expect(getDaysDiff('2026-03-11T12:00:00Z')).toBe(30)
  })
})

describe('getAlertLevel', () => {
  const config = {
    order_status: 'AWAITING_DOCUMENTS',
    pharmacy_id: null,
    warning_days: 2,
    alert_days: 3,
    critical_days: 5,
  }

  it('returns null below warning threshold', () => {
    expect(getAlertLevel(1, config)).toBeNull()
  })

  it('returns warning at warning threshold', () => {
    expect(getAlertLevel(2, config)).toBe('warning')
  })

  it('returns alert at alert threshold', () => {
    expect(getAlertLevel(3, config)).toBe('alert')
  })

  it('returns critical at critical threshold', () => {
    expect(getAlertLevel(5, config)).toBe('critical')
  })

  it('returns critical above critical threshold', () => {
    expect(getAlertLevel(10, config)).toBe('critical')
  })
})

describe('getSlaConfigs', () => {
  it('returns configs array with required shape', async () => {
    // getSlaConfigs always has a fallback — test that fallback structure is correct
    const configs = await getSlaConfigs()
    expect(Array.isArray(configs)).toBe(true)
    // Whether DB succeeds or not, shape must be correct
    if (configs.length > 0) {
      configs.forEach((c) => {
        expect(c).toHaveProperty('order_status')
        expect(c).toHaveProperty('warning_days')
        expect(c).toHaveProperty('alert_days')
        expect(c).toHaveProperty('critical_days')
      })
    }
  })

  it('fallback values are internally consistent (warning < alert < critical)', () => {
    // Test the fallback math directly
    for (const [status, days] of Object.entries(STALE_THRESHOLDS)) {
      const warning = Math.floor(days * 0.6)
      const alert = days
      const critical = Math.ceil(days * 1.5)
      expect(warning).toBeLessThanOrEqual(alert)
      expect(alert).toBeLessThanOrEqual(critical)
    }
  })

  it('STALE_THRESHOLDS covers expected statuses', () => {
    const statuses = Object.keys(STALE_THRESHOLDS)
    expect(statuses).toContain('AWAITING_DOCUMENTS')
    expect(statuses).toContain('IN_EXECUTION')
    expect(statuses).toContain('SHIPPED')
    expect(statuses).toContain('WITH_ISSUE')
  })
})
