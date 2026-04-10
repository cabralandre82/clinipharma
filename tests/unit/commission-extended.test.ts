import { describe, it, expect } from 'vitest'
import { calculateCommission, calculateNetFromFixed } from '@/lib/payments/commission'

describe('calculateCommission — edge cases', () => {
  it('throws for negative gross amount', () => {
    expect(() => calculateCommission(-100, 10)).toThrow('Gross amount cannot be negative')
  })

  it('throws for percentage below 0', () => {
    expect(() => calculateCommission(1000, -1)).toThrow()
  })

  it('throws for percentage above 100', () => {
    expect(() => calculateCommission(1000, 101)).toThrow()
  })

  it('handles fractional percentages', () => {
    const result = calculateCommission(100, 5.5)
    expect(result.commissionAmount).toBe(5.5)
    expect(result.netAmount).toBe(94.5)
  })

  it('handles very large amounts', () => {
    const result = calculateCommission(10_000_000, 10)
    expect(result.commissionAmount).toBe(1_000_000)
    expect(result.netAmount).toBe(9_000_000)
  })

  it('grossAmount + commission + net sum correctly', () => {
    const { grossAmount, commissionAmount, netAmount } = calculateCommission(999.99, 17.5)
    expect(commissionAmount + netAmount).toBeCloseTo(grossAmount, 1)
  })
})

describe('calculateNetFromFixed — edge cases', () => {
  it('throws when fixed commission exceeds gross', () => {
    expect(() => calculateNetFromFixed(100, 101)).toThrow()
  })

  it('throws for negative fixed commission', () => {
    expect(() => calculateNetFromFixed(100, -5)).toThrow()
  })

  it('throws for negative gross', () => {
    expect(() => calculateNetFromFixed(-100, 10)).toThrow()
  })

  it('calculates correctly when commission equals gross', () => {
    const result = calculateNetFromFixed(100, 100)
    expect(result.netAmount).toBe(0)
    expect(result.commissionPercentage).toBe(100)
  })

  it('handles fractional amounts', () => {
    const result = calculateNetFromFixed(1000.5, 150.25)
    expect(result.netAmount).toBe(850.25)
  })
})
