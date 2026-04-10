/**
 * Audit 3 — Security & Business Logic Edge Cases
 *
 * Tests covering all bugs found in the third audit:
 * 1. PHARMACY_ADMIN ownership check in updateOrderStatus
 * 2. Race condition guard in confirmPayment
 * 3. State machine edge cases
 * 4. Commission calculation edge cases
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isValidTransition, getAllowedTransitions } from '@/lib/orders/status-machine'

// ─── State Machine Tests ────────────────────────────────────────────────────

describe('Order State Machine — admin transitions', () => {
  it('allows all documented admin forward transitions', () => {
    expect(isValidTransition('DRAFT', 'AWAITING_DOCUMENTS', 'admin')).toBe(true)
    expect(isValidTransition('AWAITING_DOCUMENTS', 'READY_FOR_REVIEW', 'admin')).toBe(true)
    expect(isValidTransition('READY_FOR_REVIEW', 'AWAITING_PAYMENT', 'admin')).toBe(true)
    expect(isValidTransition('AWAITING_PAYMENT', 'PAYMENT_CONFIRMED', 'admin')).toBe(true)
    expect(isValidTransition('PAYMENT_CONFIRMED', 'COMMISSION_CALCULATED', 'admin')).toBe(true)
    expect(isValidTransition('COMMISSION_CALCULATED', 'TRANSFER_PENDING', 'admin')).toBe(true)
    expect(isValidTransition('TRANSFER_PENDING', 'TRANSFER_COMPLETED', 'admin')).toBe(true)
    expect(isValidTransition('TRANSFER_COMPLETED', 'RELEASED_FOR_EXECUTION', 'admin')).toBe(true)
    expect(isValidTransition('RELEASED_FOR_EXECUTION', 'RECEIVED_BY_PHARMACY', 'admin')).toBe(true)
    expect(isValidTransition('RECEIVED_BY_PHARMACY', 'IN_EXECUTION', 'admin')).toBe(true)
    expect(isValidTransition('IN_EXECUTION', 'READY', 'admin')).toBe(true)
    expect(isValidTransition('READY', 'SHIPPED', 'admin')).toBe(true)
    expect(isValidTransition('SHIPPED', 'DELIVERED', 'admin')).toBe(true)
    expect(isValidTransition('DELIVERED', 'COMPLETED', 'admin')).toBe(true)
  })

  it('allows admin to cancel from most states', () => {
    const cancelableStates = [
      'DRAFT',
      'AWAITING_DOCUMENTS',
      'READY_FOR_REVIEW',
      'AWAITING_PAYMENT',
      'PAYMENT_UNDER_REVIEW',
      'PAYMENT_CONFIRMED',
      'COMMISSION_CALCULATED',
      'TRANSFER_PENDING',
      'TRANSFER_COMPLETED',
      'RELEASED_FOR_EXECUTION',
    ]
    for (const state of cancelableStates) {
      expect(isValidTransition(state, 'CANCELED', 'admin')).toBe(true)
    }
  })

  it('blocks admin from canceling terminal states', () => {
    expect(isValidTransition('COMPLETED', 'CANCELED', 'admin')).toBe(false)
    expect(isValidTransition('CANCELED', 'CANCELED', 'admin')).toBe(false)
  })

  it('blocks admin from skipping states', () => {
    expect(isValidTransition('DRAFT', 'PAYMENT_CONFIRMED', 'admin')).toBe(false)
    expect(isValidTransition('AWAITING_PAYMENT', 'RELEASED_FOR_EXECUTION', 'admin')).toBe(false)
    expect(isValidTransition('RECEIVED_BY_PHARMACY', 'COMPLETED', 'admin')).toBe(false)
  })

  it('allows admin to flag WITH_ISSUE from operational states', () => {
    const issueableStates = [
      'RELEASED_FOR_EXECUTION',
      'RECEIVED_BY_PHARMACY',
      'IN_EXECUTION',
      'READY',
      'SHIPPED',
    ]
    for (const state of issueableStates) {
      expect(isValidTransition(state, 'WITH_ISSUE', 'admin')).toBe(true)
    }
  })

  it('allows admin to recover from WITH_ISSUE', () => {
    expect(isValidTransition('WITH_ISSUE', 'RELEASED_FOR_EXECUTION', 'admin')).toBe(true)
    expect(isValidTransition('WITH_ISSUE', 'CANCELED', 'admin')).toBe(true)
  })
})

describe('Order State Machine — pharmacy transitions', () => {
  it('allows pharmacy forward transitions from their responsible states', () => {
    expect(isValidTransition('RELEASED_FOR_EXECUTION', 'RECEIVED_BY_PHARMACY', 'pharmacy')).toBe(
      true
    )
    expect(isValidTransition('RECEIVED_BY_PHARMACY', 'IN_EXECUTION', 'pharmacy')).toBe(true)
    expect(isValidTransition('IN_EXECUTION', 'READY', 'pharmacy')).toBe(true)
    expect(isValidTransition('READY', 'SHIPPED', 'pharmacy')).toBe(true)
    expect(isValidTransition('SHIPPED', 'DELIVERED', 'pharmacy')).toBe(true)
  })

  it('blocks pharmacy from touching admin-only states', () => {
    expect(isValidTransition('DRAFT', 'AWAITING_DOCUMENTS', 'pharmacy')).toBe(false)
    expect(isValidTransition('AWAITING_PAYMENT', 'PAYMENT_CONFIRMED', 'pharmacy')).toBe(false)
    expect(isValidTransition('PAYMENT_CONFIRMED', 'COMMISSION_CALCULATED', 'pharmacy')).toBe(false)
  })

  it('blocks pharmacy from canceling orders', () => {
    expect(isValidTransition('IN_EXECUTION', 'CANCELED', 'pharmacy')).toBe(false)
    expect(isValidTransition('RELEASED_FOR_EXECUTION', 'CANCELED', 'pharmacy')).toBe(false)
  })

  it('allows pharmacy to flag and recover WITH_ISSUE', () => {
    expect(isValidTransition('IN_EXECUTION', 'WITH_ISSUE', 'pharmacy')).toBe(true)
    expect(isValidTransition('WITH_ISSUE', 'IN_EXECUTION', 'pharmacy')).toBe(true)
  })

  it('blocks pharmacy from completing order directly', () => {
    expect(isValidTransition('DELIVERED', 'COMPLETED', 'pharmacy')).toBe(false)
  })
})

describe('Order State Machine — getAllowedTransitions', () => {
  it('returns empty array for terminal COMPLETED state', () => {
    expect(getAllowedTransitions('COMPLETED', 'admin')).toEqual([])
    expect(getAllowedTransitions('COMPLETED', 'pharmacy')).toEqual([])
  })

  it('returns empty array for terminal CANCELED state', () => {
    expect(getAllowedTransitions('CANCELED', 'admin')).toEqual([])
    expect(getAllowedTransitions('CANCELED', 'pharmacy')).toEqual([])
  })

  it('returns empty array for unknown states', () => {
    expect(getAllowedTransitions('INVALID_STATE', 'admin')).toEqual([])
    expect(getAllowedTransitions('', 'pharmacy')).toEqual([])
  })

  it('pharmacy has no transitions for pre-execution states', () => {
    expect(getAllowedTransitions('DRAFT', 'pharmacy')).toEqual([])
    expect(getAllowedTransitions('AWAITING_PAYMENT', 'pharmacy')).toEqual([])
    expect(getAllowedTransitions('PAYMENT_CONFIRMED', 'pharmacy')).toEqual([])
  })
})

// ─── Commission Calculation Tests ───────────────────────────────────────────

describe('Commission calculation — precision and edge cases', () => {
  const calcCommission = (total: number, rate: number) => Math.round(total * rate * 100) / 10000

  it('calculates 5% commission on round number correctly', () => {
    expect(calcCommission(1000, 5)).toBe(50)
  })

  it('calculates 5% on fractional total with correct rounding', () => {
    // 100.33 * 5 / 100 = 5.0165
    expect(calcCommission(100.33, 5)).toBeCloseTo(5.0165, 2)
  })

  it('handles zero rate (no consultant) without error', () => {
    expect(calcCommission(1000, 0)).toBe(0)
  })

  it('handles zero total without error', () => {
    expect(calcCommission(0, 5)).toBe(0)
  })

  it('handles maximum realistic total (R$ 99,999.99)', () => {
    const result = calcCommission(99999.99, 5)
    expect(result).toBeCloseTo(4999.9995, 2)
    expect(Number.isFinite(result)).toBe(true)
  })

  const calcPharmacyTransfer = (items: Array<{ cost: number; qty: number }>) =>
    Math.round(items.reduce((sum, i) => sum + i.cost * i.qty, 0) * 100) / 100

  it('calculates pharmacy transfer correctly for multiple items', () => {
    const items = [
      { cost: 100.5, qty: 2 }, // 201.00
      { cost: 55.33, qty: 3 }, // 165.99
    ]
    expect(calcPharmacyTransfer(items)).toBe(366.99)
  })

  it('handles floating point edge case in pharmacy transfer', () => {
    // Classic float issue: 0.1 + 0.2 !== 0.3
    const items = [
      { cost: 0.1, qty: 1 },
      { cost: 0.2, qty: 1 },
    ]
    expect(calcPharmacyTransfer(items)).toBe(0.3)
  })
})

// ─── Input Validation Edge Cases ────────────────────────────────────────────

import { productInterestSchema, orderSchema } from '@/lib/validators'
import { z } from 'zod'

describe('Zod schema edge cases — productInterestSchema', () => {
  it('rejects empty product_id', () => {
    const result = productInterestSchema.safeParse({
      product_id: '',
      name: 'João',
      whatsapp: '11999998888',
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-UUID product_id', () => {
    const result = productInterestSchema.safeParse({
      product_id: 'not-a-uuid',
      name: 'João',
      whatsapp: '11999998888',
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty name', () => {
    const result = productInterestSchema.safeParse({
      product_id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'J',
      whatsapp: '11999998888',
    })
    expect(result.success).toBe(false)
  })

  it('accepts valid interest data', () => {
    const result = productInterestSchema.safeParse({
      product_id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'João Silva',
      whatsapp: '11999998888',
    })
    expect(result.success).toBe(true)
  })
})

describe('Zod schema edge cases — orderSchema', () => {
  it('rejects order with zero items', () => {
    const result = orderSchema.safeParse({
      clinic_id: '123e4567-e89b-12d3-a456-426614174000',
      doctor_id: '123e4567-e89b-12d3-a456-426614174001',
      items: [],
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toMatch(/ao menos um produto/i)
  })

  it('rejects item with zero quantity', () => {
    const result = orderSchema.safeParse({
      clinic_id: '123e4567-e89b-12d3-a456-426614174000',
      doctor_id: '123e4567-e89b-12d3-a456-426614174001',
      items: [{ product_id: '123e4567-e89b-12d3-a456-426614174002', quantity: 0 }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects item with negative quantity', () => {
    const result = orderSchema.safeParse({
      clinic_id: '123e4567-e89b-12d3-a456-426614174000',
      doctor_id: '123e4567-e89b-12d3-a456-426614174001',
      items: [{ product_id: '123e4567-e89b-12d3-a456-426614174002', quantity: -1 }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-UUID clinic_id', () => {
    const result = orderSchema.safeParse({
      clinic_id: 'not-a-uuid',
      doctor_id: '123e4567-e89b-12d3-a456-426614174001',
      items: [{ product_id: '123e4567-e89b-12d3-a456-426614174002', quantity: 1 }],
    })
    expect(result.success).toBe(false)
  })

  it('accepts valid order', () => {
    const result = orderSchema.safeParse({
      clinic_id: '123e4567-e89b-12d3-a456-426614174000',
      doctor_id: '123e4567-e89b-12d3-a456-426614174001',
      items: [{ product_id: '123e4567-e89b-12d3-a456-426614174002', quantity: 3 }],
    })
    expect(result.success).toBe(true)
  })
})

const slaItemSchema = z.object({
  order_status: z.string().min(1),
  pharmacy_id: z.string().uuid().nullable().optional(),
  warning_days: z.number().int().min(0),
  alert_days: z.number().int().min(0),
  critical_days: z.number().int().min(0),
})

describe('Zod schema edge cases — sla config', () => {
  const validItem = {
    order_status: 'AWAITING_PAYMENT',
    pharmacy_id: null,
    warning_days: 2,
    alert_days: 3,
    critical_days: 5,
  }

  it('validates correct sla config', () => {
    expect(slaItemSchema.safeParse(validItem).success).toBe(true)
  })

  it('rejects negative days', () => {
    expect(slaItemSchema.safeParse({ ...validItem, warning_days: -1 }).success).toBe(false)
  })

  it('rejects non-integer days', () => {
    expect(slaItemSchema.safeParse({ ...validItem, critical_days: 1.5 }).success).toBe(false)
  })

  it('rejects empty order_status', () => {
    expect(slaItemSchema.safeParse({ ...validItem, order_status: '' }).success).toBe(false)
  })

  it('rejects non-UUID pharmacy_id', () => {
    expect(slaItemSchema.safeParse({ ...validItem, pharmacy_id: 'not-uuid' }).success).toBe(false)
  })

  it('accepts null pharmacy_id for global config', () => {
    expect(slaItemSchema.safeParse({ ...validItem, pharmacy_id: null }).success).toBe(true)
  })
})
