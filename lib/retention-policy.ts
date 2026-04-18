import { createAdminClient } from '@/lib/db/admin'
import { logger } from '@/lib/logger'

/**
 * Data Retention Policy — LGPD + Brazilian legal requirements.
 *
 * Legal basis:
 *   - Personal data (non-financial): 5 years after deletion (LGPD Art. 16)
 *   - Financial records: 10 years (CTN Art. 195, Lei 9.430/96)
 *   - Audit logs: 5 years (LGPD Art. 37 + best practice)
 *   - Order documents: 5 years
 *   - Session tokens (revoked): 2 hours (expires_at column — purged by cron)
 */

export interface RetentionSummary {
  profilesAnonymized: number
  notificationsPurged: number
  auditLogsPurged: number
  errors: string[]
}

const YEARS_MS = (y: number) => y * 365.25 * 24 * 60 * 60 * 1000

/**
 * Executes monthly data retention enforcement.
 * - Anonymizes soft-deleted profiles beyond 5-year retention
 * - Purges notifications beyond 5 years
 * - Purges non-financial audit logs beyond 5 years
 * Financial records (orders, payments, commissions, transfers) are NEVER touched.
 */
export async function enforceRetentionPolicy(): Promise<RetentionSummary> {
  const admin = createAdminClient()
  const errors: string[] = []
  const now = new Date()

  const fiveYearsAgo = new Date(now.getTime() - YEARS_MS(5)).toISOString()

  let profilesAnonymized = 0
  let notificationsPurged = 0
  let auditLogsPurged = 0

  // 1. Anonymize soft-deleted profiles beyond 5 years
  try {
    const { data: stale } = await admin
      .from('profiles')
      .select('id, full_name, email')
      .eq('status', 'INACTIVE')
      .lt('updated_at', fiveYearsAgo)
      .not('email', 'ilike', '%@deleted.clinipharma.invalid') // skip already anonymized

    for (const profile of stale ?? []) {
      const { error: anonErr } = await admin
        .from('profiles')
        .update({
          full_name: 'Usuário Anonimizado',
          email: `anon-${profile.id.slice(0, 8)}@deleted.clinipharma.invalid`,
          phone: null,
          phone_encrypted: null,
          updated_at: now.toISOString(),
        })
        .eq('id', profile.id)
      if (anonErr) {
        logger.error('[retentionPolicy] profile anonymization failed', {
          profileId: profile.id,
          error: anonErr,
        })
        errors.push(`profile ${profile.id}: ${anonErr.message}`)
      } else {
        profilesAnonymized++
      }
    }
  } catch (err) {
    errors.push(`profiles: ${err instanceof Error ? err.message : String(err)}`)
  }

  // 2. Purge notifications beyond 5 years
  try {
    const { data: purged, error: notifErr } = await admin
      .from('notifications')
      .delete()
      .lt('created_at', fiveYearsAgo)
      .select('id')

    if (notifErr) errors.push(`notifications: ${notifErr.message}`)
    else notificationsPurged = purged?.length ?? 0
  } catch (err) {
    errors.push(`notifications: ${err instanceof Error ? err.message : String(err)}`)
  }

  // 3. Purge non-financial audit logs beyond 5 years via append-only-safe RPC.
  // Wave 3 (migration 046) made audit_logs tamper-evident: direct DELETE is
  // blocked by the `audit_logs_prevent_delete_trg` trigger. The
  // `audit_purge_retention` SECURITY DEFINER function sets the one-shot
  // `clinipharma.audit_allow_delete=on` GUC inside its own transaction and
  // appends a row to `audit_chain_checkpoints` so the forensic trail is
  // preserved. Financial entities are never purged (passed as exclusion list).
  try {
    const { data: purged, error: auditErr } = await admin.rpc('audit_purge_retention', {
      p_cutoff: fiveYearsAgo,
      p_exclude_entity_types: ['PAYMENT', 'COMMISSION', 'TRANSFER', 'CONSULTANT_TRANSFER'],
    })

    if (auditErr) {
      errors.push(`audit_logs: ${auditErr.message}`)
    } else {
      const row = Array.isArray(purged) ? purged[0] : purged
      auditLogsPurged = Number((row as { purged_count?: number } | null)?.purged_count ?? 0)
    }
  } catch (err) {
    errors.push(`audit_logs: ${err instanceof Error ? err.message : String(err)}`)
  }

  return { profilesAnonymized, notificationsPurged, auditLogsPurged, errors }
}

/** Returns the scheduled purge dates for a given entity created/deleted at a timestamp. */
export function getRetentionDates(createdAt: Date): Record<string, Date> {
  return {
    personal_data_purge: new Date(createdAt.getTime() + YEARS_MS(5)),
    financial_data_purge: new Date(createdAt.getTime() + YEARS_MS(10)),
    audit_log_purge: new Date(createdAt.getTime() + YEARS_MS(5)),
  }
}
