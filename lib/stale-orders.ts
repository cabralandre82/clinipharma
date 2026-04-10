/* eslint-disable @typescript-eslint/no-explicit-any */
import { createAdminClient } from '@/lib/db/admin'

// Fallback thresholds (used when DB configs are unavailable)
const FALLBACK_THRESHOLDS: Record<string, number> = {
  AWAITING_DOCUMENTS: 3,
  READY_FOR_REVIEW: 3,
  AWAITING_PAYMENT: 3,
  PAYMENT_UNDER_REVIEW: 3,
  COMMISSION_CALCULATED: 3,
  TRANSFER_PENDING: 3,
  RELEASED_FOR_EXECUTION: 5,
  RECEIVED_BY_PHARMACY: 5,
  IN_EXECUTION: 5,
  READY: 3,
  SHIPPED: 5,
  WITH_ISSUE: 1, // critical: must be resolved within 1 day
}

export const STALE_THRESHOLDS = FALLBACK_THRESHOLDS

export interface StaleOrder {
  id: string
  code: string
  order_status: string
  updated_at: string
  daysStale: number
  threshold: number
  alertLevel: 'warning' | 'alert' | 'critical'
  clinic: string
  pharmacy: string
  pharmacy_id?: string
}

export interface SlaConfig {
  order_status: string
  pharmacy_id: string | null
  warning_days: number
  alert_days: number
  critical_days: number
}

export async function getSlaConfigs(pharmacyId?: string): Promise<SlaConfig[]> {
  try {
    const admin = createAdminClient()
    // Get global configs
    const { data: global } = await admin.from('sla_configs').select('*').is('pharmacy_id', null)
    // Get pharmacy-specific overrides
    const { data: specific } = pharmacyId
      ? await admin.from('sla_configs').select('*').eq('pharmacy_id', pharmacyId)
      : { data: [] }

    // Merge: pharmacy-specific overrides global
    const merged: SlaConfig[] = (global ?? []).map((g) => {
      const override = (specific ?? []).find((s: any) => s.order_status === g.order_status)
      return override ?? g
    })
    return merged
  } catch {
    // Fallback to hardcoded values
    return Object.entries(FALLBACK_THRESHOLDS).map(([status, days]) => ({
      order_status: status,
      pharmacy_id: null,
      warning_days: Math.floor(days * 0.6),
      alert_days: days,
      critical_days: Math.ceil(days * 1.5),
    }))
  }
}

export function getAlertLevel(
  daysDiff: number,
  config: SlaConfig
): 'warning' | 'alert' | 'critical' | null {
  if (daysDiff >= config.critical_days) return 'critical'
  if (daysDiff >= config.alert_days) return 'alert'
  if (daysDiff >= config.warning_days) return 'warning'
  return null
}

export function getStaleThreshold(status: string): number | null {
  return FALLBACK_THRESHOLDS[status] ?? null
}

export function getDaysDiff(dateStr: string): number {
  const date = new Date(dateStr)
  const now = new Date()
  return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
}
