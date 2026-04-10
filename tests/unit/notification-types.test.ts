import { describe, it, expect } from 'vitest'
import { SILENCEABLE_TYPES, CRITICAL_TYPES } from '@/lib/notification-types'

describe('notification-types constants', () => {
  it('CRITICAL_TYPES contains essential payment and order types', () => {
    expect(CRITICAL_TYPES).toContain('ORDER_CREATED')
    expect(CRITICAL_TYPES).toContain('ORDER_STATUS')
    expect(CRITICAL_TYPES).toContain('PAYMENT_CONFIRMED')
    expect(CRITICAL_TYPES).toContain('DOCUMENT_UPLOADED')
  })

  it('SILENCEABLE_TYPES contains non-critical types', () => {
    expect(SILENCEABLE_TYPES).toContain('STALE_ORDER')
    expect(SILENCEABLE_TYPES).toContain('PRODUCT_INTEREST')
    expect(SILENCEABLE_TYPES).toContain('REGISTRATION_REQUEST')
    expect(SILENCEABLE_TYPES).toContain('TRANSFER_REGISTERED')
    expect(SILENCEABLE_TYPES).toContain('CONSULTANT_TRANSFER')
  })

  it('CRITICAL_TYPES and SILENCEABLE_TYPES have no overlap', () => {
    const overlap = CRITICAL_TYPES.filter((t) => SILENCEABLE_TYPES.includes(t))
    expect(overlap).toHaveLength(0)
  })

  it('SILENCEABLE_TYPES has at least 5 items', () => {
    expect(SILENCEABLE_TYPES.length).toBeGreaterThanOrEqual(5)
  })

  it('CRITICAL_TYPES has at least 4 items', () => {
    expect(CRITICAL_TYPES.length).toBeGreaterThanOrEqual(4)
  })
})
