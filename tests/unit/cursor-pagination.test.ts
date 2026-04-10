import { describe, it, expect } from 'vitest'
import { parseCursorParams, sliceCursorResult } from '@/lib/cursor-pagination'

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRows(
  n: number,
  startIso = '2024-01-01T00:00:00Z'
): Array<{ id: string; created_at: string }> {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(new Date(startIso).getTime() - i * 60_000) // 1 minute apart, descending
    return { id: `row-${i}`, created_at: d.toISOString() }
  })
}

// ── parseCursorParams ──────────────────────────────────────────────────────

describe('parseCursorParams', () => {
  it('returns isFirstPage=true when no cursor', () => {
    const p = parseCursorParams({ pageSize: 20 })
    expect(p.isFirstPage).toBe(true)
    expect(p.after).toBeNull()
    expect(p.before).toBeNull()
    expect(p.ascending).toBe(false)
    expect(p.fetchSize).toBe(21)
  })

  it('sets ascending=false when using after cursor', () => {
    const p = parseCursorParams({ after: '2024-01-01T00:00:00Z', pageSize: 10 })
    expect(p.after).toBe('2024-01-01T00:00:00Z')
    expect(p.ascending).toBe(false)
    expect(p.isFirstPage).toBe(false)
    expect(p.fetchSize).toBe(11)
  })

  it('sets ascending=true when using before cursor (fetch backwards then reverse)', () => {
    const p = parseCursorParams({ before: '2024-01-01T00:00:00Z', pageSize: 10 })
    expect(p.before).toBe('2024-01-01T00:00:00Z')
    expect(p.ascending).toBe(true)
    expect(p.isFirstPage).toBe(false)
  })

  it('handles null/undefined cursor values', () => {
    const p = parseCursorParams({ after: null, before: undefined, pageSize: 5 })
    expect(p.after).toBeNull()
    expect(p.before).toBeNull()
    expect(p.isFirstPage).toBe(true)
  })
})

// ── sliceCursorResult ──────────────────────────────────────────────────────

describe('sliceCursorResult', () => {
  it('returns empty result for empty input', () => {
    const cursor = parseCursorParams({ pageSize: 20 })
    const result = sliceCursorResult([], cursor)
    expect(result.rows).toHaveLength(0)
    expect(result.nextCursor).toBeNull()
    expect(result.prevCursor).toBeNull()
    expect(result.isFirstPage).toBe(true)
  })

  it('returns all rows when fewer than pageSize', () => {
    const cursor = parseCursorParams({ pageSize: 20 })
    const rows = makeRows(10)
    const result = sliceCursorResult(rows, cursor)
    expect(result.rows).toHaveLength(10)
    expect(result.nextCursor).toBeNull() // no next page
    expect(result.prevCursor).toBeNull() // first page
  })

  it('detects next page when rows = pageSize + 1', () => {
    const cursor = parseCursorParams({ pageSize: 20 })
    const rows = makeRows(21) // fetched 21 = pageSize + 1
    const result = sliceCursorResult(rows, cursor)
    expect(result.rows).toHaveLength(20)
    // nextCursor = created_at of last row (row-19)
    expect(result.nextCursor).toBe(rows[19].created_at)
  })

  it('sets prevCursor=null on first page', () => {
    const cursor = parseCursorParams({ pageSize: 5 })
    const rows = makeRows(6)
    const result = sliceCursorResult(rows, cursor)
    expect(result.isFirstPage).toBe(true)
    expect(result.prevCursor).toBeNull()
  })

  it('sets prevCursor=first row created_at on non-first page', () => {
    const cursor = parseCursorParams({ after: '2024-01-01T00:10:00Z', pageSize: 5 })
    const rows = makeRows(5)
    const result = sliceCursorResult(rows, cursor)
    expect(result.isFirstPage).toBe(false)
    expect(result.prevCursor).toBe(rows[0].created_at)
  })

  it('reverses rows when navigating backwards (before cursor)', () => {
    const cursor = parseCursorParams({ before: '2024-01-01T00:00:00Z', pageSize: 5 })
    // Simulate: DB returned 5 rows in ASC order (oldest first because ascending=true)
    const ascRows = Array.from({ length: 5 }, (_, i) => ({
      id: `row-${i}`,
      created_at: new Date(new Date('2024-01-01T00:00:00Z').getTime() + i * 60_000).toISOString(),
    }))
    const result = sliceCursorResult(ascRows, cursor)
    // After reverse, newest should be first
    expect(result.rows[0].created_at > result.rows[4].created_at).toBe(true)
  })

  it('handles exactly pageSize rows with no next page', () => {
    const cursor = parseCursorParams({ pageSize: 10 })
    const rows = makeRows(10) // exactly 10 — no extra row fetched
    const result = sliceCursorResult(rows, cursor)
    expect(result.rows).toHaveLength(10)
    expect(result.nextCursor).toBeNull()
  })
})

// ── Integration scenario: multi-page navigation ────────────────────────────

describe('cursor pagination — multi-page navigation', () => {
  const ALL_ROWS = makeRows(55) // 55 total rows, newest first
  const PAGE_SIZE = 20

  it('page 1: correct count and next cursor', () => {
    const cursor = parseCursorParams({ pageSize: PAGE_SIZE })
    // Simulate DB returning first PAGE_SIZE+1 rows
    const fetched = ALL_ROWS.slice(0, PAGE_SIZE + 1)
    const p1 = sliceCursorResult(fetched, cursor)

    expect(p1.rows).toHaveLength(20)
    expect(p1.nextCursor).toBe(ALL_ROWS[19].created_at) // cursor = row 19
    expect(p1.prevCursor).toBeNull()
    expect(p1.isFirstPage).toBe(true)
  })

  it('page 2: uses after cursor, detects next page', () => {
    const afterCursor = ALL_ROWS[19].created_at
    const cursor = parseCursorParams({ after: afterCursor, pageSize: PAGE_SIZE })
    // Simulate DB returning rows 20-40
    const fetched = ALL_ROWS.slice(20, 41)
    const p2 = sliceCursorResult(fetched, cursor)

    expect(p2.rows).toHaveLength(20)
    expect(p2.nextCursor).toBe(ALL_ROWS[39].created_at)
    expect(p2.prevCursor).toBe(ALL_ROWS[20].created_at)
    expect(p2.isFirstPage).toBe(false)
  })

  it('page 3 (last): no next cursor', () => {
    const afterCursor = ALL_ROWS[39].created_at
    const cursor = parseCursorParams({ after: afterCursor, pageSize: PAGE_SIZE })
    // Only 15 rows remaining (40-54)
    const fetched = ALL_ROWS.slice(40, 55)
    const p3 = sliceCursorResult(fetched, cursor)

    expect(p3.rows).toHaveLength(15)
    expect(p3.nextCursor).toBeNull() // last page
    expect(p3.prevCursor).toBe(ALL_ROWS[40].created_at)
  })
})
