/**
 * Money formatting helpers that respect the `money.cents_read`
 * feature flag.
 *
 * During the dual-read window (Wave 8 → Wave N), callers are routed
 * through these helpers instead of `formatCurrency(row.field)` so
 * the transition from numeric-authoritative to cents-authoritative
 * happens with a single flag flip, not N component rewrites.
 *
 * The flag is read server-side per render (cheap — 30s in-process
 * cache from `lib/features`). When OFF, callers see the legacy
 * numeric value and nothing changes. When ON, callers see the
 * `_cents`-derived value and any drift between the two is both
 * (a) prevented by the migration-050 BEFORE-triggers at write time
 * and (b) surveilled by the `/api/cron/money-reconcile` job.
 *
 * @module lib/money-format
 */

import 'server-only'
import { isFeatureEnabled, type FeatureFlagContext } from '@/lib/features'
import { formatCents, fromCents, readMoneyField, toCents } from '@/lib/money'

/**
 * Format a money value for display. Picks between `row.field_cents`
 * and `row.field` based on the `money.cents_read` flag.
 *
 * Example:
 *
 *   const row = await db.from('orders').select('total_price, total_price_cents').single()
 *   const label = await formatMoney(row, 'total_price', { userId })
 *   // -> "R$ 1.234,56"
 */
export async function formatMoney(
  row: Record<string, unknown> | null | undefined,
  field: string,
  ctx: FeatureFlagContext = {},
  currency = 'BRL'
): Promise<string> {
  const useCents = await isFeatureEnabledSafe('money.cents_read', ctx)
  if (useCents) {
    const cents = readMoneyField(row, field)
    return formatCents(cents, currency)
  }
  const raw = row ? row[field] : null
  const value = typeof raw === 'string' ? Number(raw) : ((raw as number) ?? 0)
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value)
}

/**
 * Return the canonical integer-cents value for a row+field, honouring
 * the dual-read flag. Useful for server-side arithmetic where both
 * paths must produce the same result regardless of the flag.
 */
export async function readMoneyCents(
  row: Record<string, unknown> | null | undefined,
  field: string,
  ctx: FeatureFlagContext = {}
): Promise<number> {
  const useCents = await isFeatureEnabledSafe('money.cents_read', ctx)
  if (useCents) {
    return readMoneyField(row, field)
  }
  if (!row) return 0
  const raw = row[field]
  if (raw === null || raw === undefined) return 0
  return toCents(raw as number | string)
}

/**
 * Return the canonical decimal (JS number) value for a row+field,
 * honouring the dual-read flag. Useful when legacy callers still
 * expect a `number` for formatting / chart libraries.
 */
export async function readMoneyDecimal(
  row: Record<string, unknown> | null | undefined,
  field: string,
  ctx: FeatureFlagContext = {}
): Promise<number> {
  const cents = await readMoneyCents(row, field, ctx)
  return fromCents(cents)
}

async function isFeatureEnabledSafe(key: string, ctx: FeatureFlagContext): Promise<boolean> {
  try {
    return await isFeatureEnabled(key, ctx)
  } catch {
    return false
  }
}
