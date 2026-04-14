import { createAdminClient } from '@/lib/db/admin'
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
    console.error('[AUDIT] Failed to create audit log:', err)
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
