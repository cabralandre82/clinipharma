/**
 * Unit tests for `lib/money.ts` (Wave 8).
 *
 * The goal of these tests is to pin down the exact contract of every
 * exported function so any regression (rounding direction, float
 * pitfall leak, silent coercion of NaN) breaks CI loudly. We avoid
 * property-based fuzzing here because the cases below already cover
 * every documented edge in the module.
 */

import { describe, it, expect } from 'vitest'
import {
  toCents,
  fromCents,
  sumCents,
  mulCentsByQty,
  percentBpsCents,
  percentDecimalCents,
  driftCents,
  formatCents,
  readMoneyField,
} from '@/lib/money'

describe('lib/money', () => {
  describe('toCents', () => {
    it('rounds positive values half-away-from-zero', () => {
      expect(toCents(10.5)).toBe(1050)
      expect(toCents(10.125)).toBe(1013)
      expect(toCents(10.124)).toBe(1012)
      expect(toCents(10.995)).toBe(1100)
    })

    it('survives the 0.1 + 0.2 float pitfall', () => {
      // The canonical demonstration: 0.1 + 0.2 === 0.30000000000000004
      // but we must get exactly 30 cents back.
      expect(toCents(0.1 + 0.2)).toBe(30)
    })

    it('survives the 2.36 * 100 precision pitfall', () => {
      // 2.36 * 100 === 235.99999999999997. Naive floor() would give
      // 235 cents; our Math.round path gives 236.
      expect(toCents(2.36)).toBe(236)
    })

    it('parses string inputs from Supabase JSON', () => {
      expect(toCents('123.45')).toBe(12345)
      expect(toCents('0.00')).toBe(0)
      expect(toCents('99.99')).toBe(9999)
    })

    it('returns 0 for null/undefined', () => {
      expect(toCents(null)).toBe(0)
      expect(toCents(undefined)).toBe(0)
    })

    it('handles negative values symmetrically', () => {
      expect(toCents(-10.5)).toBe(-1050)
      expect(toCents(-0.01)).toBe(-1)
    })

    it('throws on NaN / Infinity', () => {
      expect(() => toCents(NaN)).toThrow(/non-finite/)
      expect(() => toCents(Infinity)).toThrow(/non-finite/)
      expect(() => toCents('not-a-number')).toThrow(/non-finite/)
    })
  })

  describe('fromCents', () => {
    it('divides by 100 exactly', () => {
      expect(fromCents(1050)).toBe(10.5)
      expect(fromCents(100)).toBe(1)
      expect(fromCents(9999)).toBe(99.99)
    })

    it('accepts bigint inputs', () => {
      expect(fromCents(12345n)).toBe(123.45)
    })

    it('returns 0 for null/undefined', () => {
      expect(fromCents(null)).toBe(0)
      expect(fromCents(undefined)).toBe(0)
    })

    it('is the exact inverse of toCents for money values', () => {
      // Round-trip over a representative sample.
      const samples = [0, 0.01, 1.23, 99.99, 100, 1000, 1234.56, 99_999.99]
      for (const x of samples) {
        expect(fromCents(toCents(x))).toBe(x)
      }
    })
  })

  describe('sumCents', () => {
    it('returns 0 for empty input', () => {
      expect(sumCents([])).toBe(0)
    })

    it('sums integer cents exactly — no float drift', () => {
      // Ten × 10 cents = 100 cents, exactly. The JS-native
      // `[0.1, 0.1, ...].reduce((a,b)=>a+b)` would give 0.9999... here;
      // sumCents uses integers and is exact.
      expect(sumCents([10, 10, 10, 10, 10, 10, 10, 10, 10, 10])).toBe(100)
    })

    it('handles bigint mixed with number', () => {
      expect(sumCents([100, 200n, 300])).toBe(600)
    })

    it('throws on non-integer input', () => {
      expect(() => sumCents([1.5 as unknown as number])).toThrow(/non-integer/)
      expect(() => sumCents([NaN as unknown as number])).toThrow(/non-integer/)
    })
  })

  describe('mulCentsByQty', () => {
    it('multiplies exactly', () => {
      expect(mulCentsByQty(1050, 3)).toBe(3150)
      expect(mulCentsByQty(199, 10)).toBe(1990)
    })

    it('rejects non-integer cents', () => {
      expect(() => mulCentsByQty(10.5, 2)).toThrow(/non-integer cents/)
    })

    it('rejects negative or non-integer quantities', () => {
      expect(() => mulCentsByQty(100, -1)).toThrow(/non-negative integer/)
      expect(() => mulCentsByQty(100, 1.5)).toThrow(/non-negative integer/)
    })

    it('accepts zero quantity', () => {
      expect(mulCentsByQty(1050, 0)).toBe(0)
    })
  })

  describe('percentBpsCents', () => {
    it('computes simple percentages', () => {
      // 5% of R$ 100 = R$ 5
      expect(percentBpsCents(10_000, 500)).toBe(500)
      // 1.25% of R$ 500 = R$ 6.25
      expect(percentBpsCents(50_000, 125)).toBe(625)
      // 100 bps = 1%, 10_000 bps = 100%
      expect(percentBpsCents(10_000, 10_000)).toBe(10_000)
    })

    it('rounds half-away-from-zero at fractional cents', () => {
      // 3.33% of R$ 1.00 = R$ 0.0333 → 3 cents
      expect(percentBpsCents(100, 333)).toBe(3)
      // 5.555% of R$ 1.00 = R$ 0.05555 → 6 cents (half-up)
      expect(percentBpsCents(100, 556)).toBe(6)
    })

    it('handles 0% and 0 base', () => {
      expect(percentBpsCents(10_000, 0)).toBe(0)
      expect(percentBpsCents(0, 500)).toBe(0)
    })

    it('rejects non-integer base', () => {
      expect(() => percentBpsCents(10.5, 500)).toThrow(/non-integer/)
    })

    it('rejects non-finite rate', () => {
      expect(() => percentBpsCents(10_000, NaN)).toThrow(/non-finite/)
    })
  })

  describe('percentDecimalCents', () => {
    it('handles the consultant-commission default (5%)', () => {
      // R$ 100 × 5% = R$ 5.00
      expect(percentDecimalCents(10_000, 5)).toBe(500)
      // R$ 1234.56 × 5% = R$ 61.728 → 6173 cents (half-up)
      expect(percentDecimalCents(123_456, 5)).toBe(6173)
    })

    it('handles fractional percent (2.5%)', () => {
      expect(percentDecimalCents(10_000, 2.5)).toBe(250)
    })

    it('handles 0% and very small percent', () => {
      expect(percentDecimalCents(10_000, 0)).toBe(0)
      // 0.01% of R$ 100 = R$ 0.01 → 1 cent
      expect(percentDecimalCents(10_000, 0.01)).toBe(1)
    })
  })

  describe('driftCents', () => {
    it('returns 0 for agreeing values', () => {
      expect(driftCents(10.5, 1050)).toBe(0)
      expect(driftCents('123.45', 12345)).toBe(0)
    })

    it('returns the absolute cents delta', () => {
      expect(driftCents(10.5, 1051)).toBe(1)
      expect(driftCents(10.5, 1049)).toBe(1)
      expect(driftCents(10.5, 0)).toBe(1050)
    })

    it('accepts bigint cents', () => {
      expect(driftCents(10.5, 1050n)).toBe(0)
    })
  })

  describe('formatCents', () => {
    it('formats BRL by default', () => {
      // NumberFormat uses NBSP; normalise to spaces so the test is
      // portable across libc versions.
      const normalize = (s: string) => s.replace(/\u00A0/g, ' ')
      expect(normalize(formatCents(1050))).toBe('R$ 10,50')
      expect(normalize(formatCents(100_000))).toBe('R$ 1.000,00')
      expect(normalize(formatCents(0))).toBe('R$ 0,00')
    })

    it('accepts bigint', () => {
      expect(formatCents(1050n)).toMatch(/10,50/)
    })

    it('handles null/undefined as 0', () => {
      expect(formatCents(null)).toMatch(/0,00/)
      expect(formatCents(undefined)).toMatch(/0,00/)
    })
  })

  describe('readMoneyField', () => {
    it('prefers the _cents column when present', () => {
      const row = { total_price: '999.99', total_price_cents: 12345 }
      expect(readMoneyField(row, 'total_price')).toBe(12345)
    })

    it('falls back to numeric when _cents is null', () => {
      const row = { total_price: '10.50', total_price_cents: null }
      expect(readMoneyField(row, 'total_price')).toBe(1050)
    })

    it('falls back to numeric when _cents is missing entirely', () => {
      const row = { total_price: '10.50' }
      expect(readMoneyField(row, 'total_price')).toBe(1050)
    })

    it('handles bigint in _cents', () => {
      const row = { total_price: 10.5, total_price_cents: 1050n }
      expect(readMoneyField(row, 'total_price')).toBe(1050)
    })

    it('returns 0 for null/undefined row or fields', () => {
      expect(readMoneyField(null, 'total_price')).toBe(0)
      expect(readMoneyField(undefined, 'total_price')).toBe(0)
      expect(readMoneyField({}, 'total_price')).toBe(0)
      expect(readMoneyField({ total_price: null, total_price_cents: null }, 'total_price')).toBe(0)
    })

    it('ignores non-finite _cents and falls through to numeric', () => {
      const row = { total_price: '10.50', total_price_cents: Number.NaN }
      expect(readMoneyField(row, 'total_price')).toBe(1050)
    })
  })

  describe('integration — P&L round-trip', () => {
    it('reproduces a typical order total correctly', () => {
      // 3 items: qty=2 @ R$ 19.99, qty=1 @ R$ 49.90, qty=5 @ R$ 0.33
      const lines = [
        mulCentsByQty(toCents(19.99), 2), // 3998
        mulCentsByQty(toCents(49.9), 1), //  4990
        mulCentsByQty(toCents(0.33), 5), //   165
      ]
      const total = sumCents(lines)
      expect(total).toBe(9153)
      expect(fromCents(total)).toBe(91.53)
    })

    it('reproduces the platform commission calculation', () => {
      // pharmacy_cost_per_unit * qty + platform_commission_per_unit * qty
      // = total_price_per_item * qty
      const pharmacyCostCents = toCents(7.5) // 750
      const platformCommCents = toCents(2.5) // 250
      const unitCents = pharmacyCostCents + platformCommCents // 1000
      expect(mulCentsByQty(unitCents, 3)).toBe(3000)
      expect(fromCents(mulCentsByQty(unitCents, 3))).toBe(30)
    })

    it('reproduces the consultant commission (5% on R$ 1234.56)', () => {
      const orderTotalCents = toCents(1234.56) // 123456
      const commission = percentDecimalCents(orderTotalCents, 5)
      // 5% of R$ 1234.56 = R$ 61.728 → 6173 cents half-up
      expect(commission).toBe(6173)
      expect(fromCents(commission)).toBe(61.73)
    })
  })
})
