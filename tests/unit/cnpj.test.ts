import { describe, it, expect } from 'vitest'
import { validateCNPJ, formatCNPJ } from '@/lib/utils/cnpj'

describe('validateCNPJ', () => {
  it('accepts known valid CNPJs', () => {
    expect(validateCNPJ('11.222.333/0001-81')).toBe(true)
    expect(validateCNPJ('11222333000181')).toBe(true)
  })

  it('rejects CNPJs with wrong length', () => {
    expect(validateCNPJ('123')).toBe(false)
    expect(validateCNPJ('1234567890123')).toBe(false) // 13 digits
    expect(validateCNPJ('123456789012345')).toBe(false) // 15 digits
  })

  it('rejects repeated-digit sequences', () => {
    expect(validateCNPJ('00000000000000')).toBe(false)
    expect(validateCNPJ('11111111111111')).toBe(false)
    expect(validateCNPJ('99999999999999')).toBe(false)
    expect(validateCNPJ('22222222222222')).toBe(false)
  })

  it('rejects CNPJs with wrong check digits', () => {
    expect(validateCNPJ('11222333000182')).toBe(false) // last digit wrong
    expect(validateCNPJ('11222333000191')).toBe(false) // penultimate digit wrong
  })

  it('accepts formatted CNPJ stripping non-digits', () => {
    expect(validateCNPJ('11.222.333/0001-81')).toBe(true)
  })

  it('rejects empty string', () => {
    expect(validateCNPJ('')).toBe(false)
  })
})

describe('formatCNPJ', () => {
  it('formats 14-digit raw CNPJ correctly', () => {
    expect(formatCNPJ('11222333000181')).toBe('11.222.333/0001-81')
  })

  it('handles partial input gracefully', () => {
    const result = formatCNPJ('11222')
    expect(result).toContain('11')
  })

  it('strips non-digit characters before formatting', () => {
    expect(formatCNPJ('11.222.333/0001-81')).toBe('11.222.333/0001-81')
  })

  it('truncates to 14 digits if more are provided', () => {
    const result = formatCNPJ('1122233300018199999')
    expect(result.replace(/\D/g, '').length).toBeLessThanOrEqual(14)
  })
})
