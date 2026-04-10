/**
 * Cursor-based pagination for Supabase queries ordered by `created_at DESC`.
 *
 * Pattern (in each server page):
 *
 *   const { after, before } = await searchParams
 *   const cursor = parseCursorParams({ after, before })
 *
 *   let q = supabase.from('table').select('*')
 *   if (cursor.after) q = q.lt('created_at', cursor.after)
 *   if (cursor.before) q = q.gt('created_at', cursor.before)
 *   q = q.order('created_at', { ascending: cursor.ascending }).limit(cursor.fetchSize)
 *
 *   const { data: raw } = await q
 *   const { rows, nextCursor, prevCursor, isFirstPage } =
 *     sliceCursorResult(raw ?? [], cursor)
 */

export interface CursorParams {
  after: string | null
  before: string | null
  ascending: boolean
  fetchSize: number
  pageSize: number
  isFirstPage: boolean
}

export interface CursorResult<T> {
  rows: T[]
  nextCursor: string | null
  /** null when on the first page */
  prevCursor: string | null
  isFirstPage: boolean
}

export function parseCursorParams({
  after,
  before,
  pageSize,
}: {
  after?: string | null
  before?: string | null
  pageSize: number
}): CursorParams {
  return {
    after: after ?? null,
    before: before ?? null,
    // When paginating backwards, we fetch ASC then reverse in JS
    ascending: !!before,
    fetchSize: pageSize + 1,
    pageSize,
    isFirstPage: !after && !before,
  }
}

export function sliceCursorResult<T extends { created_at: string }>(
  raw: T[],
  cursor: CursorParams
): CursorResult<T> {
  // If we fetched backwards (before cursor), reverse so newest-first again
  let rows = cursor.before ? [...raw].reverse() : raw

  const hasMore = rows.length > cursor.pageSize
  if (hasMore) rows = rows.slice(0, cursor.pageSize)

  const nextCursor = hasMore ? (rows[rows.length - 1]?.created_at ?? null) : null
  const prevCursor = cursor.isFirstPage ? null : (rows[0]?.created_at ?? null)

  return { rows, nextCursor, prevCursor, isFirstPage: cursor.isFirstPage }
}
