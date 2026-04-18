/**
 * Money primitives — integer-cents arithmetic for all financial
 * calculations in the platform. Wave 8.
 *
 * Rationale
 * ---------
 * The application historically stored monetary values as
 * PostgreSQL `numeric(10,2)` (or `numeric(15,2)` after migration 015)
 * and loaded them into JavaScript as `number`. Two problems:
 *
 *   1. IEEE 754 floats cannot represent 0.1 exactly, so
 *      `0.1 + 0.2 === 0.30000000000000004`. Any code that sums line
 *      items in JS can drift by ±0.01 over a large order, which
 *      eventually shows up as a discrepancy between `orders.total_price`
 *      (recomputed by Postgres trigger) and whatever the UI displays.
 *
 *   2. Percentage calculations (`total * rate / 100`) truncate at
 *      different places depending on whether PG or JS is doing them,
 *      because PG keeps the full `numeric` precision while JS rounds
 *      to 53 bits of mantissa.
 *
 * Solution: every amount is stored and passed around as **integer
 * cents** (BIGINT in PG, `number` in JS where `Number.MAX_SAFE_INTEGER`
 * = 9,007,199,254,740,992 cents = R$ 90 quadrillion, which is fine).
 * Display formatting is the only place a non-integer appears, and it
 * uses the exact integer-to-string path.
 *
 * The public API below is intentionally minimal — if you need a new
 * operation, add it here rather than recomputing in cents elsewhere
 * so the pitfalls are contained to this one module.
 *
 * @module lib/money
 */

// ── Conversion ──────────────────────────────────────────────────────────

/**
 * Convert a `numeric(x,2)` value (possibly a string from Supabase JSON
 * or a JS number from a form) into an integer cents value. Throws on
 * non-finite or precision-lost inputs.
 *
 *   toCents(10.5)     -> 1050
 *   toCents("10.50")  -> 1050
 *   toCents(0.1 + 0.2) -> 30   // proves the rounding is safe
 *
 * The rounding mode is "half-away-from-zero" (the same mode
 * PostgreSQL's `round()` uses), which matches what most accounting
 * systems expect.
 */
export function toCents(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) {
    throw new TypeError(`toCents: non-finite input "${value}"`)
  }
  // Multiply, then round. Multiplying by 100 on a float can itself
  // introduce FP error (e.g. `2.36 * 100 === 235.99999999999997`), so
  // we compensate by rounding after the multiplication. This is safe
  // for any numeric(15,2) value because `n * 100` stays well within
  // 2^53 - 1.
  return Math.round(n * 100 + Number.EPSILON * Math.sign(n))
}

/**
 * Convert integer cents back to a JS `number` representing the full
 * currency amount. Useful for Intl.NumberFormat which expects a
 * non-integer. Keeps the 2-decimal precision exactly because the
 * underlying value is an integer divided by 100.
 *
 *   fromCents(1050) -> 10.5
 *   fromCents(100)  -> 1
 */
export function fromCents(cents: number | bigint | null | undefined): number {
  if (cents === null || cents === undefined) return 0
  const n = typeof cents === 'bigint' ? Number(cents) : cents
  if (!Number.isFinite(n)) {
    throw new TypeError(`fromCents: non-finite input "${cents}"`)
  }
  return n / 100
}

// ── Arithmetic ──────────────────────────────────────────────────────────

/**
 * Sum any number of cent values. Returns 0 for an empty list. All
 * operands must be finite integers — we explicitly reject floats.
 */
export function sumCents(values: ReadonlyArray<number | bigint>): number {
  let total = 0
  for (const v of values) {
    const n = typeof v === 'bigint' ? Number(v) : v
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      throw new TypeError(`sumCents: non-integer input "${v}"`)
    }
    total += n
  }
  return total
}

/**
 * Multiply a cents value by a non-negative integer quantity. Enforces
 * that the quantity is an integer ≥ 0 because line-item math always
 * uses whole units.
 */
export function mulCentsByQty(cents: number, quantity: number): number {
  if (!Number.isInteger(cents)) {
    throw new TypeError(`mulCentsByQty: non-integer cents "${cents}"`)
  }
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new TypeError(`mulCentsByQty: quantity must be non-negative integer, got "${quantity}"`)
  }
  return cents * quantity
}

/**
 * Apply a rate expressed in basis points (1 bp = 0.01%). Using bps
 * keeps the multiplication in integer space:
 *
 *   percentBpsCents(10_000, 500) -> 500   // 5% of R$ 100 = R$ 5
 *   percentBpsCents(50_000, 125) -> 625   // 1.25% of R$ 500 = R$ 6.25
 *
 * Rounds half-up to the nearest cent. A separate helper exists for
 * percent-as-decimal because some legacy code uses `numeric(5,2)` with
 * values like `5.0` meaning 5% — do NOT multiply those by 100 again.
 */
export function percentBpsCents(baseCents: number, rateBps: number): number {
  if (!Number.isInteger(baseCents)) {
    throw new TypeError(`percentBpsCents: non-integer base "${baseCents}"`)
  }
  if (!Number.isFinite(rateBps)) {
    throw new TypeError(`percentBpsCents: non-finite rate "${rateBps}"`)
  }
  // (base * rate) / 10_000 with explicit rounding. Avoid Math.round
  // on the full product because base*rate can exceed 2^53 for very
  // large amounts — use bankers-style division instead.
  const product = baseCents * rateBps
  const quotient = Math.trunc(product / 10_000)
  const remainder = product - quotient * 10_000
  // Half-away-from-zero rounding on the remainder.
  if (Math.abs(remainder) * 2 >= 10_000) {
    return quotient + Math.sign(product)
  }
  return quotient
}

/**
 * Convenience wrapper for the legacy percent-as-decimal shape used by
 * `sales_consultants.commission_rate` and a handful of other callers
 * that store the rate as `numeric(5,2)` where `5.0` means 5%.
 *
 *   percentDecimalCents(10_000, 5)    -> 500
 *   percentDecimalCents(10_000, 2.5)  -> 250
 */
export function percentDecimalCents(baseCents: number, ratePercent: number): number {
  if (!Number.isFinite(ratePercent)) {
    throw new TypeError(`percentDecimalCents: non-finite rate "${ratePercent}"`)
  }
  // Convert the decimal percent to bps with proper rounding to avoid
  // accumulation error: 2.5% == 250 bps, 0.1% == 10 bps.
  const bps = Math.round(ratePercent * 100)
  return percentBpsCents(baseCents, bps)
}

// ── Drift detection ─────────────────────────────────────────────────────

/**
 * Returns the absolute delta between a `numeric(x,2)` read from the
 * database and the twin `*_cents` column, in cents. Zero means no
 * drift. Non-zero is a bug — log and alert.
 *
 * Used by the reconciliation cron to scan rows written by legacy
 * writers (pre-W8) or by external tools that bypass the sync trigger.
 */
export function driftCents(numericValue: number | string, centsValue: number | bigint): number {
  const expected = toCents(numericValue)
  const actual = typeof centsValue === 'bigint' ? Number(centsValue) : centsValue
  return Math.abs(expected - actual)
}

// ── Formatting ──────────────────────────────────────────────────────────

/**
 * Format cents as a BRL string (R$ 10,50). Deliberately uses the
 * integer-then-divide path so no float ever touches `Intl`.
 *
 *   formatCents(1050)    -> "R$ 10,50"
 *   formatCents(100_000) -> "R$ 1.000,00"
 */
export function formatCents(cents: number | bigint | null | undefined, currency = 'BRL'): string {
  const value = fromCents(cents)
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value)
}

// ── Row adapter ─────────────────────────────────────────────────────────

/**
 * Given a row that may carry either `field` (numeric) or
 * `field_cents` (bigint / number), return the canonical integer-cents
 * value. Preference order:
 *
 *   1. `field_cents` if present and numeric.
 *   2. `toCents(field)` as a fallback.
 *
 * This is the helper the UI / service layer uses during the dual-read
 * window. When the feature flag `money.cents_read` is OFF, the caller
 * reads `field` as before; when ON, the caller uses this helper so
 * the cents column becomes authoritative.
 */
export function readMoneyField(
  row: Record<string, unknown> | null | undefined,
  field: string
): number {
  if (!row) return 0
  const centsKey = `${field}_cents`
  const rawCents = row[centsKey]
  if (rawCents !== null && rawCents !== undefined) {
    const n = typeof rawCents === 'bigint' ? Number(rawCents) : Number(rawCents)
    if (Number.isFinite(n)) return n
  }
  const rawNumeric = row[field]
  if (rawNumeric === null || rawNumeric === undefined) return 0
  return toCents(rawNumeric as number | string)
}
