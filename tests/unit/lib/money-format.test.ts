/**
 * Unit tests for `lib/money-format.ts` — the dual-read adapter that
 * sits in front of display/aggregation code during the Wave 8
 * migration window.
 *
 * We mock `lib/features::isFeatureEnabled` so we can assert both
 * branches without a database. We also mock `server-only` so the
 * module loads under Vitest (jsdom) without throwing the
 * "server-only must not be imported client-side" guard.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('@/lib/features', () => ({
  isFeatureEnabled: vi.fn(),
}))

const { isFeatureEnabled } = await import('@/lib/features')
const { formatMoney, readMoneyCents, readMoneyDecimal } = await import('@/lib/money-format')

const mockFlag = vi.mocked(isFeatureEnabled)

function norm(s: string): string {
  return s.replace(/\u00A0/g, ' ')
}

describe('lib/money-format', () => {
  beforeEach(() => {
    mockFlag.mockReset()
  })

  describe('formatMoney', () => {
    it('reads numeric when flag is OFF', async () => {
      mockFlag.mockResolvedValue(false)
      const row = { total_price: '10.50', total_price_cents: 9999 }
      const out = await formatMoney(row, 'total_price')
      expect(norm(out)).toBe('R$ 10,50')
      // Flag is called exactly once per formatMoney call.
      expect(mockFlag).toHaveBeenCalledWith('money.cents_read', {})
    })

    it('reads cents when flag is ON', async () => {
      mockFlag.mockResolvedValue(true)
      const row = { total_price: '999.99', total_price_cents: 1050 }
      const out = await formatMoney(row, 'total_price')
      expect(norm(out)).toBe('R$ 10,50')
    })

    it('falls back to numeric when cents missing even with flag ON', async () => {
      mockFlag.mockResolvedValue(true)
      const row = { total_price: '10.50' }
      const out = await formatMoney(row, 'total_price')
      expect(norm(out)).toBe('R$ 10,50')
    })

    it('handles null row gracefully', async () => {
      mockFlag.mockResolvedValue(true)
      const out = await formatMoney(null, 'total_price')
      expect(norm(out)).toBe('R$ 0,00')
    })

    it('fails closed when feature flag lookup throws', async () => {
      mockFlag.mockRejectedValue(new Error('db unreachable'))
      const row = { total_price: '10.50', total_price_cents: 9999 }
      // Flag lookup failed → treat as OFF → use numeric (10.50, not 9999).
      const out = await formatMoney(row, 'total_price')
      expect(norm(out)).toBe('R$ 10,50')
    })

    it('propagates FeatureFlagContext to isFeatureEnabled', async () => {
      mockFlag.mockResolvedValue(false)
      const ctx = { userId: 'user-1', clinicId: 'clinic-2' }
      const row = { total_price: '1.00' }
      await formatMoney(row, 'total_price', ctx)
      expect(mockFlag).toHaveBeenCalledWith('money.cents_read', ctx)
    })

    it('honours currency override', async () => {
      mockFlag.mockResolvedValue(true)
      const row = { price_cents: 12345 }
      const out = await formatMoney(row, 'price', {}, 'USD')
      // Output depends on ICU — just assert it starts with US$ or $
      expect(out).toMatch(/\$\s?123[.,]45/)
    })
  })

  describe('readMoneyCents', () => {
    it('returns cents column when flag ON', async () => {
      mockFlag.mockResolvedValue(true)
      const row = { total_price: '99.99', total_price_cents: 1050 }
      expect(await readMoneyCents(row, 'total_price')).toBe(1050)
    })

    it('converts numeric when flag OFF', async () => {
      mockFlag.mockResolvedValue(false)
      const row = { total_price: '10.50', total_price_cents: 1050 }
      expect(await readMoneyCents(row, 'total_price')).toBe(1050)
    })

    it('returns 0 for null row', async () => {
      mockFlag.mockResolvedValue(true)
      expect(await readMoneyCents(null, 'total_price')).toBe(0)
    })

    it('parses string numeric when flag OFF', async () => {
      mockFlag.mockResolvedValue(false)
      expect(await readMoneyCents({ total_price: '1234.56' }, 'total_price')).toBe(123456)
    })
  })

  describe('readMoneyDecimal', () => {
    it('returns JS number for numeric path', async () => {
      mockFlag.mockResolvedValue(false)
      const row = { total_price: '10.50' }
      expect(await readMoneyDecimal(row, 'total_price')).toBe(10.5)
    })

    it('returns JS number for cents path', async () => {
      mockFlag.mockResolvedValue(true)
      const row = { total_price_cents: 1050 }
      expect(await readMoneyDecimal(row, 'total_price')).toBe(10.5)
    })
  })
})
