// Thresholds (days without status change before an order is considered stale)
export const STALE_THRESHOLDS: Record<string, number> = {
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
}

export interface StaleOrder {
  id: string
  code: string
  order_status: string
  updated_at: string
  daysStale: number
  threshold: number
  clinic: string
  pharmacy: string
}

export function getStaleThreshold(status: string): number | null {
  return STALE_THRESHOLDS[status] ?? null
}

export function getDaysDiff(dateStr: string): number {
  const date = new Date(dateStr)
  const now = new Date()
  return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
}
