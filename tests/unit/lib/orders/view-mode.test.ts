import { describe, it, expect } from 'vitest'
import {
  resolveViewMode,
  visibleLineTotal,
  visibleOrderTotal,
  visibleUnitAmount,
  priceColumnLabel,
  unitColumnLabel,
  isPharmacyView,
  isConsultantView,
} from '@/lib/orders/view-mode'

/**
 * Pin the RBAC view-mode contract with brittle, intentional assertions.
 *
 * If any of these change (e.g. someone "optimises" `visibleLineTotal` and
 * accidentally falls back to `unit_price` for pharmacy view), this suite
 * will flag the regression — the bug class we are guarding against is
 * "pharmacy sees the sales price", which is a financial information leak
 * (see docs/compliance/regression-audit-2026-04-28.md).
 */

describe('resolveViewMode', () => {
  it('returns "buyer" for null/empty roles', () => {
    expect(resolveViewMode(null)).toBe('buyer')
    expect(resolveViewMode(undefined)).toBe('buyer')
    expect(resolveViewMode([])).toBe('buyer')
  })

  it('returns "pharmacy" for any user with PHARMACY_ADMIN', () => {
    expect(resolveViewMode(['PHARMACY_ADMIN'])).toBe('pharmacy')
  })

  it('PHARMACY_ADMIN wins over admin/buyer roles (least-privilege)', () => {
    // A pharmacy operator who also happens to be a platform admin must
    // still see the pharmacy view when looking at pharmacy surfaces.
    expect(resolveViewMode(['SUPER_ADMIN', 'PHARMACY_ADMIN'])).toBe('pharmacy')
    expect(resolveViewMode(['CLINIC_ADMIN', 'PHARMACY_ADMIN'])).toBe('pharmacy')
  })

  it('returns "admin" for SUPER_ADMIN or PLATFORM_ADMIN without pharmacy', () => {
    expect(resolveViewMode(['SUPER_ADMIN'])).toBe('admin')
    expect(resolveViewMode(['PLATFORM_ADMIN'])).toBe('admin')
  })

  it('returns "buyer" for CLINIC_ADMIN / DOCTOR', () => {
    expect(resolveViewMode(['CLINIC_ADMIN'])).toBe('buyer')
    expect(resolveViewMode(['DOCTOR'])).toBe('buyer')
  })

  it('isPharmacyView reflects the mode', () => {
    expect(isPharmacyView('pharmacy')).toBe(true)
    expect(isPharmacyView('admin')).toBe(false)
    expect(isPharmacyView('buyer')).toBe(false)
    expect(isPharmacyView('consultant')).toBe(false)
  })

  it('returns "consultant" for SALES_CONSULTANT', () => {
    expect(resolveViewMode(['SALES_CONSULTANT'])).toBe('consultant')
  })

  it('PHARMACY_ADMIN still wins over SALES_CONSULTANT (rare staff combo)', () => {
    expect(resolveViewMode(['SALES_CONSULTANT', 'PHARMACY_ADMIN'])).toBe('pharmacy')
  })

  it('SALES_CONSULTANT wins over admin/buyer in ranking (least-privilege)', () => {
    // Even a platform admin who somehow also has the consultant role
    // should see the strict consultant view on consultant surfaces.
    expect(resolveViewMode(['PLATFORM_ADMIN', 'SALES_CONSULTANT'])).toBe('consultant')
    expect(resolveViewMode(['CLINIC_ADMIN', 'SALES_CONSULTANT'])).toBe('consultant')
  })

  it('isConsultantView reflects the mode', () => {
    expect(isConsultantView('consultant')).toBe(true)
    expect(isConsultantView('pharmacy')).toBe(false)
    expect(isConsultantView('admin')).toBe(false)
    expect(isConsultantView('buyer')).toBe(false)
  })
})

describe('visibleUnitAmount', () => {
  const item = { unit_price: 100, pharmacy_cost_per_unit: 30 }

  it('pharmacy sees pharmacy_cost_per_unit only', () => {
    expect(visibleUnitAmount('pharmacy', item)).toBe(30)
  })

  it('admin/buyer see unit_price', () => {
    expect(visibleUnitAmount('admin', item)).toBe(100)
    expect(visibleUnitAmount('buyer', item)).toBe(100)
  })

  it('pharmacy gets 0 (NOT unit_price) when pharmacy_cost is missing', () => {
    // CRITICAL: must never fall back to `unit_price`. If the pharmacy
    // cost is unknown, show R$ 0 (which is loud) rather than leak the
    // sales price.
    expect(visibleUnitAmount('pharmacy', { unit_price: 100 })).toBe(0)
    expect(visibleUnitAmount('pharmacy', { unit_price: 100, pharmacy_cost_per_unit: null })).toBe(0)
  })
})

describe('visibleLineTotal', () => {
  it('pharmacy: qty × pharmacy_cost_per_unit', () => {
    expect(
      visibleLineTotal('pharmacy', { quantity: 3, unit_price: 100, pharmacy_cost_per_unit: 30 })
    ).toBe(90)
  })

  it('buyer/admin: total_price (or unit_price × qty fallback)', () => {
    expect(
      visibleLineTotal('buyer', {
        quantity: 3,
        unit_price: 100,
        total_price: 280,
        pharmacy_cost_per_unit: 30,
      })
    ).toBe(280)
    expect(
      visibleLineTotal('admin', {
        quantity: 3,
        unit_price: 100,
        total_price: undefined,
        pharmacy_cost_per_unit: 30,
      })
    ).toBe(300)
  })

  it('pharmacy never returns unit_price-derived total', () => {
    // Even with no pharmacy_cost present, must not leak unit_price.
    expect(visibleLineTotal('pharmacy', { quantity: 5, unit_price: 200, total_price: 1000 })).toBe(
      0
    )
  })
})

describe('visibleOrderTotal', () => {
  const items = [
    { quantity: 2, pharmacy_cost_per_unit: 30 },
    { quantity: 1, pharmacy_cost_per_unit: 45 },
  ]

  it('pharmacy: Σ(qty × pharmacy_cost_per_unit)', () => {
    expect(visibleOrderTotal('pharmacy', { total_price: 999, order_items: items })).toBe(
      2 * 30 + 1 * 45
    ) // 105
  })

  it('admin/buyer: orders.total_price', () => {
    expect(visibleOrderTotal('admin', { total_price: 999, order_items: items })).toBe(999)
    expect(visibleOrderTotal('buyer', { total_price: 999, order_items: items })).toBe(999)
  })

  it('pharmacy gracefully degrades when items are absent', () => {
    expect(visibleOrderTotal('pharmacy', { total_price: 999 })).toBe(0)
  })
})

describe('column labels', () => {
  it('pharmacy → "Repasse"', () => {
    expect(priceColumnLabel('pharmacy')).toBe('Repasse')
    expect(unitColumnLabel('pharmacy')).toBe('Repasse/un.')
  })

  it('non-pharmacy → "Preço" / "Unit."', () => {
    expect(priceColumnLabel('admin')).toBe('Preço')
    expect(priceColumnLabel('buyer')).toBe('Preço')
    expect(unitColumnLabel('admin')).toBe('Unit.')
    expect(unitColumnLabel('buyer')).toBe('Unit.')
  })

  it('consultant → "Comissão"', () => {
    expect(priceColumnLabel('consultant')).toBe('Comissão')
    expect(unitColumnLabel('consultant')).toBe('Comissão/un.')
  })
})

describe('consultant view-mode never leaks sales price or repasse', () => {
  // A SALES_CONSULTANT must never see line-level monetary fields. The
  // dashboard renders `consultant_commissions.commission_amount` on its
  // own; if a future page accidentally feeds order_items into a
  // visibleX helper while `mode === 'consultant'`, we want a loud R$ 0.
  it('visibleUnitAmount returns 0 even when unit_price is set', () => {
    expect(visibleUnitAmount('consultant', { unit_price: 100, pharmacy_cost_per_unit: 30 })).toBe(0)
  })

  it('visibleLineTotal returns 0 even when total_price is set', () => {
    expect(
      visibleLineTotal('consultant', {
        quantity: 5,
        unit_price: 100,
        total_price: 1000,
        pharmacy_cost_per_unit: 30,
      })
    ).toBe(0)
  })

  it('visibleOrderTotal returns 0 even when total_price is set', () => {
    expect(
      visibleOrderTotal('consultant', {
        total_price: 999,
        order_items: [{ quantity: 2, pharmacy_cost_per_unit: 30 }],
      })
    ).toBe(0)
  })
})
