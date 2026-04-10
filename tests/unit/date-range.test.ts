import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Pure utility functions extracted for testing (same logic as DateRangePicker)
function today() {
  return new Date().toISOString().slice(0, 10)
}
function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}
function startOfMonth(offsetMonths = 0) {
  const d = new Date()
  d.setMonth(d.getMonth() + offsetMonths, 1)
  return d.toISOString().slice(0, 10)
}
function endOfMonth(offsetMonths = 0) {
  const d = new Date()
  d.setMonth(d.getMonth() + offsetMonths + 1, 0)
  return d.toISOString().slice(0, 10)
}
function startOfYear() {
  return `${new Date().getFullYear()}-01-01`
}

describe('DateRangePicker utilities', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-10T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('today()', () => {
    it('returns current date in YYYY-MM-DD format', () => {
      expect(today()).toBe('2026-04-10')
    })
  })

  describe('daysAgo()', () => {
    it('returns today for 0 days ago', () => {
      expect(daysAgo(0)).toBe('2026-04-10')
    })

    it('returns yesterday for 1 day ago', () => {
      expect(daysAgo(1)).toBe('2026-04-09')
    })

    it('returns 6 days ago correctly', () => {
      expect(daysAgo(6)).toBe('2026-04-04')
    })

    it('returns 29 days ago correctly', () => {
      expect(daysAgo(29)).toBe('2026-03-12')
    })

    it('handles month boundary', () => {
      expect(daysAgo(9)).toBe('2026-04-01')
    })
  })

  describe('startOfMonth()', () => {
    it('returns first day of current month', () => {
      expect(startOfMonth()).toBe('2026-04-01')
    })

    it('returns first day of previous month with offset -1', () => {
      expect(startOfMonth(-1)).toBe('2026-03-01')
    })

    it('returns first day of next month with offset +1', () => {
      expect(startOfMonth(1)).toBe('2026-05-01')
    })
  })

  describe('endOfMonth()', () => {
    it('returns last day of current month (April = 30)', () => {
      expect(endOfMonth()).toBe('2026-04-30')
    })

    it('returns last day of March (31 days)', () => {
      expect(endOfMonth(-1)).toBe('2026-03-31')
    })

    it('returns last day of May (31 days)', () => {
      expect(endOfMonth(1)).toBe('2026-05-31')
    })
  })

  describe('startOfYear()', () => {
    it('returns January 1 of current year', () => {
      expect(startOfYear()).toBe('2026-01-01')
    })
  })

  describe('preset ranges', () => {
    it('"Esta semana" covers last 7 days including today', () => {
      const from = daysAgo(6)
      const to = today()
      expect(from).toBe('2026-04-04')
      expect(to).toBe('2026-04-10')
    })

    it('"Este mês" starts on 1st and ends on 30th for April', () => {
      expect(startOfMonth()).toBe('2026-04-01')
      expect(endOfMonth()).toBe('2026-04-30')
    })

    it('"Últimos 3 meses" goes back 89 days', () => {
      expect(daysAgo(89)).toBe('2026-01-11')
    })

    it('"Últimos 6 meses" goes back 179 days', () => {
      expect(daysAgo(179)).toBe('2025-10-13')
    })

    it('"Este ano" starts at 2026-01-01', () => {
      expect(startOfYear()).toBe('2026-01-01')
    })

    it('from is always <= to for all presets', () => {
      const presets = [
        [today(), today()],
        [daysAgo(6), today()],
        [startOfMonth(), endOfMonth()],
        [startOfMonth(-1), endOfMonth(-1)],
        [daysAgo(89), today()],
        [daysAgo(179), today()],
        [startOfYear(), today()],
      ]
      for (const [from, to] of presets) {
        expect(from <= to).toBe(true)
      }
    })
  })
})
