import { createAdminClient } from '@/lib/db/admin'
import { logger } from '@/lib/logger'
import type { UserRole } from '@/types'

interface AuditLogParams {
  actorUserId?: string
  actorRole?: UserRole | string
  entityType: string
  entityId: string
  action: string
  oldValues?: Record<string, unknown>
  newValues?: Record<string, unknown>
  metadata?: Record<string, unknown>
  ip?: string
  userAgent?: string
}

/**
 * Appends a row to `public.audit_logs`.
 *
 * Hash-chain columns (`seq`, `prev_hash`, `row_hash`) are filled by the
 * `audit_logs_chain_before_insert` trigger (migration 046). Do not pass
 * them from the application side — the trigger ignores caller-supplied
 * values and overwrites them. UPDATE / DELETE on `audit_logs` are
 * blocked by triggers; the only sanctioned delete path is the
 * `audit_purge_retention` SECURITY DEFINER RPC called from
 * `lib/retention-policy.ts`.
 */
export async function createAuditLog(params: AuditLogParams): Promise<void> {
  try {
    const supabase = createAdminClient()
    await supabase.from('audit_logs').insert({
      actor_user_id: params.actorUserId ?? null,
      actor_role: params.actorRole ?? null,
      entity_type: params.entityType,
      entity_id: params.entityId,
      action: params.action,
      old_values_json: params.oldValues ?? null,
      new_values_json: params.newValues ?? null,
      metadata_json: params.metadata ?? null,
      ip: params.ip ?? null,
      user_agent: params.userAgent ?? null,
    })
  } catch (err) {
    // Audit log failures should never crash the main operation
    logger.error('Failed to create audit log', {
      module: 'audit',
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      error: err,
    })
  }
}

export const AuditAction = {
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  STATUS_CHANGE: 'STATUS_CHANGE',
  PRICE_CHANGE: 'PRICE_CHANGE',
  PAYMENT_CONFIRMED: 'PAYMENT_CONFIRMED',
  PAYMENT_REFUNDED: 'PAYMENT_REFUNDED',
  TRANSFER_REGISTERED: 'TRANSFER_REGISTERED',
  TRANSFER_REVERSED: 'TRANSFER_REVERSED',
  COMMISSION_CALCULATED: 'COMMISSION_CALCULATED',
  DOCUMENT_UPLOADED: 'DOCUMENT_UPLOADED',
  SETTING_CHANGED: 'SETTING_CHANGED',
} as const

export const AuditEntity = {
  PROFILE: 'PROFILE',
  CLINIC: 'CLINIC',
  DOCTOR: 'DOCTOR',
  PHARMACY: 'PHARMACY',
  PRODUCT: 'PRODUCT',
  ORDER: 'ORDER',
  PAYMENT: 'PAYMENT',
  TRANSFER: 'TRANSFER',
  COMMISSION: 'COMMISSION',
  APP_SETTING: 'APP_SETTING',
} as const
