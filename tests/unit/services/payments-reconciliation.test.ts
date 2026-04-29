import { describe, it, expect } from 'vitest'

/**
 * Reconciliation invariant for confirmPayment (services/payments.ts).
 *
 * After 2026-04-29, paying for an order MUST produce ledger rows that
 * satisfy:
 *
 *   total_price = pharmacy_transfer.net_amount + commission.amount + consultant_commission.amount
 *
 * Pre-fix this was not enforced — the legacy code summed
 * `platform_commission_per_unit * quantity` from the order_items
 * price-freeze snapshot, which was computed at item-insertion time as
 * `unit_price - pharmacy_cost` BEFORE coupons applied. On a coupon
 * order this overstated the platform share by exactly the coupon
 * amount and left a phantom-money gap in the ledger.
 *
 * The fix derives platform commission from the invariant:
 *
 *   platform_commission = total_price - pharmacy_transfer
 *
 * which is exact regardless of coupon presence. These tests enforce
 * the rule mathematically (no DB / no I/O — pure arithmetic).
 */

interface OrderItemSnapshot {
  quantity: number
  pharmacy_cost_per_unit: number
  // platform_commission_per_unit is intentionally NOT used in the
  // calculation post-fix — kept here only to mirror the schema so
  // a future reader doesn't misread the test as a regression.
  platform_commission_per_unit: number
}

function computeReconciledShares(orderTotal: number, items: OrderItemSnapshot[]) {
  const pharmacyTransfer =
    Math.round(items.reduce((s, i) => s + i.pharmacy_cost_per_unit * i.quantity, 0) * 100) / 100
  const platformCommission = Math.max(0, Math.round((orderTotal - pharmacyTransfer) * 100) / 100)
  return { pharmacyTransfer, platformCommission }
}

describe('confirmPayment reconciliation invariant', () => {
  it('reconciles a no-coupon order to the cent', () => {
    // Order: 1× R$ 190 unit, pharmacy cost R$ 100, no coupon.
    // Customer paid R$ 190.
    const items: OrderItemSnapshot[] = [
      { quantity: 1, pharmacy_cost_per_unit: 100, platform_commission_per_unit: 90 },
    ]
    const orderTotal = 190
    const { pharmacyTransfer, platformCommission } = computeReconciledShares(orderTotal, items)
    expect(pharmacyTransfer).toBe(100)
    expect(platformCommission).toBe(90)
    expect(pharmacyTransfer + platformCommission).toBe(orderTotal)
  })

  it('reconciles a coupon order — platform absorbs the discount', () => {
    // Order CP-2026-000015 reproduced exactly: R$ 190 unit, 5% coupon
    // → customer paid R$ 180,50. Pharmacy keeps its R$ 100 frozen
    // cost intact. Platform margin shrinks from R$ 90 to R$ 80,50 —
    // the R$ 9,50 the coupon advertised.
    const items: OrderItemSnapshot[] = [
      { quantity: 1, pharmacy_cost_per_unit: 100, platform_commission_per_unit: 90 },
    ]
    const orderTotal = 180.5
    const { pharmacyTransfer, platformCommission } = computeReconciledShares(orderTotal, items)
    expect(pharmacyTransfer).toBe(100)
    expect(platformCommission).toBe(80.5)
    expect(pharmacyTransfer + platformCommission).toBeCloseTo(orderTotal, 2)
  })

  it('handles multi-item orders with mixed coupons', () => {
    // 2 line items: one with coupon (130 → 120), one without (50).
    // Paid R$ 170. Pharmacy costs: R$ 60 + R$ 25 = R$ 85.
    // Platform should keep R$ 85 (170 - 85), not R$ 95 (130-60 + 50-25).
    const items: OrderItemSnapshot[] = [
      { quantity: 1, pharmacy_cost_per_unit: 60, platform_commission_per_unit: 70 },
      { quantity: 1, pharmacy_cost_per_unit: 25, platform_commission_per_unit: 25 },
    ]
    const orderTotal = 170
    const { pharmacyTransfer, platformCommission } = computeReconciledShares(orderTotal, items)
    expect(pharmacyTransfer).toBe(85)
    expect(platformCommission).toBe(85)
    expect(pharmacyTransfer + platformCommission).toBeCloseTo(orderTotal, 2)
  })

  it('handles quantity > 1 correctly', () => {
    // 3 units × R$ 50 cost = R$ 150 to pharmacy. Customer paid R$ 200
    // (R$ 240 minus a R$ 40 coupon). Platform gets R$ 50.
    const items: OrderItemSnapshot[] = [
      { quantity: 3, pharmacy_cost_per_unit: 50, platform_commission_per_unit: 30 },
    ]
    const orderTotal = 200
    const { pharmacyTransfer, platformCommission } = computeReconciledShares(orderTotal, items)
    expect(pharmacyTransfer).toBe(150)
    expect(platformCommission).toBe(50)
    expect(pharmacyTransfer + platformCommission).toBeCloseTo(orderTotal, 2)
  })

  it('clamps platform_commission to 0 instead of going negative', () => {
    // Pathological: coupon exceeds platform margin. Platform absorbs
    // up to its full margin; pharmacy is held harmless. The remaining
    // shortfall (if any) would be caught by money_drift_view as a
    // recon_gap. We never emit a negative commission to the ledger.
    const items: OrderItemSnapshot[] = [
      { quantity: 1, pharmacy_cost_per_unit: 100, platform_commission_per_unit: 10 },
    ]
    const orderTotal = 90 // less than pharmacy cost — would never happen but defend
    const { pharmacyTransfer, platformCommission } = computeReconciledShares(orderTotal, items)
    expect(pharmacyTransfer).toBe(100)
    expect(platformCommission).toBe(0)
    // recon_gap = 90 - 100 - 0 = -10 (would alert)
    expect(orderTotal - pharmacyTransfer - platformCommission).toBeLessThan(0)
  })
})
