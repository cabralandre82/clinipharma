import { describe, it, expect, vi } from 'vitest'
import { toCSV } from '@/lib/export'

// Mock exceljs so toXLSX can run without native bindings
vi.mock('exceljs', () => {
  const fakeWorksheet = {
    addRow: vi.fn(),
    getRow: vi.fn(() => ({ font: {}, fill: {} })),
    columns: { forEach: vi.fn() },
  }

  function FakeWorkbook() {
    return {
      addWorksheet: vi.fn(() => fakeWorksheet),
      xlsx: {
        writeBuffer: vi.fn().mockResolvedValue(Buffer.from('XLSX_CONTENT')),
      },
    }
  }

  return { default: { Workbook: FakeWorkbook } }
})

describe('toCSV', () => {
  it('returns empty string for empty array', () => {
    expect(toCSV([])).toBe('')
  })

  it('generates header row from first object keys', () => {
    const rows = [{ Nome: 'André', Email: 'andre@test.com' }]
    const csv = toCSV(rows)
    const lines = csv.split('\n')
    expect(lines[0]).toBe('Nome,Email')
  })

  it('generates data rows correctly', () => {
    const rows = [
      { Nome: 'André', Email: 'andre@test.com' },
      { Nome: 'João', Email: 'joao@test.com' },
    ]
    const csv = toCSV(rows)
    const lines = csv.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toBe('André,andre@test.com')
    expect(lines[2]).toBe('João,joao@test.com')
  })

  it('escapes commas inside field values with double-quotes', () => {
    const rows = [{ Descricao: 'produto, premium', Valor: '100' }]
    const csv = toCSV(rows)
    expect(csv).toContain('"produto, premium"')
  })

  it('escapes double-quotes inside field values', () => {
    const rows = [{ Observacao: 'ele disse "ok"' }]
    const csv = toCSV(rows)
    expect(csv).toContain('"ele disse ""ok"""')
  })

  it('escapes newlines inside field values', () => {
    const rows = [{ Texto: 'linha1\nlinha2' }]
    const csv = toCSV(rows)
    expect(csv).toContain('"linha1\nlinha2"')
  })

  it('handles null and undefined values as empty strings', () => {
    const rows = [{ A: null, B: undefined, C: 'ok' }]
    const csv = toCSV(rows as Record<string, unknown>[])
    const dataLine = csv.split('\n')[1]
    expect(dataLine).toBe(',,ok')
  })

  it('handles numeric values', () => {
    const rows = [{ Valor: 1234.56, Qtd: 10 }]
    const csv = toCSV(rows)
    const dataLine = csv.split('\n')[1]
    expect(dataLine).toBe('1234.56,10')
  })
})

describe('toXLSX', () => {
  it('returns a Uint8Array', async () => {
    const { toXLSX } = await import('@/lib/export')
    const result = await toXLSX([
      {
        name: 'Sheet1',
        rows: [
          { A: '1', B: '2' },
          { A: '3', B: '4' },
        ],
      },
    ])
    expect(result).toBeInstanceOf(Uint8Array)
  })

  it('handles empty rows gracefully', async () => {
    const { toXLSX } = await import('@/lib/export')
    const result = await toXLSX([{ name: 'Empty', rows: [] }])
    expect(result).toBeInstanceOf(Uint8Array)
  })

  it('handles multiple sheets', async () => {
    const { toXLSX } = await import('@/lib/export')
    const result = await toXLSX([
      { name: 'Sheet1', rows: [{ Col: 'val1' }] },
      { name: 'Sheet2', rows: [{ Col: 'val2' }] },
    ])
    expect(result).toBeInstanceOf(Uint8Array)
  })

  it('truncates sheet names longer than 31 chars without throwing', async () => {
    const { toXLSX } = await import('@/lib/export')
    const longName = 'A'.repeat(50)
    // Should not throw when given a long sheet name
    const result = await toXLSX([{ name: longName, rows: [{ X: 1 }] }])
    expect(result).toBeInstanceOf(Uint8Array)
  })
})
