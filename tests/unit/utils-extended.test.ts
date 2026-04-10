import { describe, it, expect } from 'vitest'
import {
  formatCurrency,
  generateOrderCode,
  formatCNPJ,
  formatPhone,
  truncate,
  slugify,
  getInitials,
  parsePage,
  paginationRange,
  cn,
} from '@/lib/utils'

describe('formatCurrency', () => {
  it('formats BRL correctly', () => {
    const result = formatCurrency(1234.56)
    expect(result).toContain('1.234,56')
    expect(result).toContain('R$')
  })

  it('formats zero', () => {
    expect(formatCurrency(0)).toContain('0,00')
  })

  it('formats large values', () => {
    const result = formatCurrency(1_000_000)
    expect(result).toContain('1.000.000,00')
  })
})

describe('generateOrderCode', () => {
  it('generates correct format CP-YYYY-NNNNNN', () => {
    expect(generateOrderCode(2026, 1)).toBe('CP-2026-000001')
    expect(generateOrderCode(2026, 999999)).toBe('CP-2026-999999')
    expect(generateOrderCode(2026, 42)).toBe('CP-2026-000042')
  })
})

describe('formatCNPJ', () => {
  it('formats 14-digit CNPJ', () => {
    expect(formatCNPJ('11222333000181')).toBe('11.222.333/0001-81')
  })

  it('handles empty string', () => {
    expect(formatCNPJ('')).toBe('')
  })
})

describe('formatPhone', () => {
  it('formats 11-digit mobile (celular)', () => {
    expect(formatPhone('11987654321')).toBe('(11) 98765-4321')
  })

  it('formats 10-digit landline (fixo)', () => {
    expect(formatPhone('1132165432')).toBe('(11) 3216-5432')
  })

  it('strips non-digits before formatting', () => {
    expect(formatPhone('(11) 98765-4321')).toBe('(11) 98765-4321')
  })
})

describe('truncate', () => {
  it('does not truncate strings within length', () => {
    expect(truncate('hello', 10)).toBe('hello')
    expect(truncate('hello', 5)).toBe('hello')
  })

  it('truncates and appends ellipsis', () => {
    expect(truncate('hello world', 5)).toBe('hello...')
  })
})

describe('slugify', () => {
  it('converts to lowercase', () => {
    expect(slugify('HELLO')).toBe('hello')
  })

  it('removes accents', () => {
    expect(slugify('café')).toBe('cafe')
    expect(slugify('ação')).toBe('acao')
  })

  it('replaces spaces with hyphens', () => {
    expect(slugify('hello world')).toBe('hello-world')
  })

  it('removes special characters', () => {
    expect(slugify('hello!@#$world')).toBe('helloworld')
  })

  it('collapses multiple hyphens', () => {
    expect(slugify('hello   world')).toBe('hello-world')
  })

  it('trims leading/trailing spaces', () => {
    expect(slugify('  hello  ')).toBe('hello')
  })
})

describe('getInitials', () => {
  it('returns two initials for two-word name', () => {
    expect(getInitials('Andre Lima')).toBe('AL')
  })

  it('returns one initial for single name', () => {
    expect(getInitials('Andre')).toBe('A')
  })

  it('uses only first two words', () => {
    expect(getInitials('Andre Lima Silva')).toBe('AL')
  })

  it('handles multiple spaces', () => {
    expect(getInitials('  Andre  Lima  ')).toBe('AL')
  })

  it('uppercases initials', () => {
    expect(getInitials('andre lima')).toBe('AL')
  })
})

describe('parsePage', () => {
  it('parses valid page numbers', () => {
    expect(parsePage('3')).toBe(3)
    expect(parsePage('1')).toBe(1)
  })

  it('returns default for undefined', () => {
    expect(parsePage(undefined)).toBe(1)
    expect(parsePage(undefined, 5)).toBe(5)
  })

  it('returns default for non-numeric strings', () => {
    expect(parsePage('abc')).toBe(1)
    expect(parsePage('')).toBe(1)
  })

  it('returns default for zero or negative', () => {
    expect(parsePage('0')).toBe(1)
    expect(parsePage('-1')).toBe(1)
  })
})

describe('paginationRange', () => {
  it('calculates range for page 1', () => {
    const { from, to } = paginationRange(1, 20)
    expect(from).toBe(0)
    expect(to).toBe(19)
  })

  it('calculates range for page 2', () => {
    const { from, to } = paginationRange(2, 20)
    expect(from).toBe(20)
    expect(to).toBe(39)
  })

  it('calculates range for page 3 with pageSize 10', () => {
    const { from, to } = paginationRange(3, 10)
    expect(from).toBe(20)
    expect(to).toBe(29)
  })
})

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('handles conditional classes', () => {
    expect(cn('foo', false && 'bar', 'baz')).toBe('foo baz')
  })

  it('deduplicates tailwind classes', () => {
    const result = cn('p-4', 'p-2')
    expect(result).toBe('p-2')
  })
})
