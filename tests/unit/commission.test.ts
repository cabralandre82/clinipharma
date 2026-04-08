import { describe, it, expect } from 'vitest'
import { calculateCommission, calculateNetFromFixed } from '@/lib/payments/commission'

describe('calculateCommission', () => {
  it('calculates 15% commission correctly', () => {
    const result = calculateCommission(1000, 15)
    expect(result.commissionAmount).toBe(150)
    expect(result.netAmount).toBe(850)
    expect(result.commissionPercentage).toBe(15)
    expect(result.grossAmount).toBe(1000)
  })

  it('calculates 0% commission (no commission)', () => {
    const result = calculateCommission(1000, 0)
    expect(result.commissionAmount).toBe(0)
    expect(result.netAmount).toBe(1000)
  })

  it('calculates 100% commission (platform keeps all)', () => {
    const result = calculateCommission(1000, 100)
    expect(result.commissionAmount).toBe(1000)
    expect(result.netAmount).toBe(0)
  })

  it('rounds to 2 decimal places', () => {
    const result = calculateCommission(100, 33.333)
    expect(result.commissionAmount).toBe(33.33)
    expect(result.netAmount).toBe(66.67)
  })

  it('throws on negative gross amount', () => {
    expect(() => calculateCommission(-100, 15)).toThrow()
  })

  it('throws on percentage > 100', () => {
    expect(() => calculateCommission(1000, 150)).toThrow()
  })

  it('throws on negative percentage', () => {
    expect(() => calculateCommission(1000, -5)).toThrow()
  })
})

describe('calculateNetFromFixed', () => {
  it('calculates net from fixed commission', () => {
    const result = calculateNetFromFixed(1000, 150)
    expect(result.netAmount).toBe(850)
    expect(result.commissionAmount).toBe(150)
    expect(result.grossAmount).toBe(1000)
  })

  it('throws if fixed commission exceeds gross', () => {
    expect(() => calculateNetFromFixed(100, 200)).toThrow()
  })
})
