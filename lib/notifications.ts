import { createAdminClient } from '@/lib/db/admin'

export type NotificationType =
  | 'ORDER_CREATED'
  | 'ORDER_STATUS'
  | 'PAYMENT_CONFIRMED'
  | 'TRANSFER_REGISTERED'
  | 'CONSULTANT_TRANSFER'
  | 'DOCUMENT_UPLOADED'
  | 'PRODUCT_INTEREST'
  | 'REGISTRATION_REQUEST'
  | 'STALE_ORDER'
  | 'GENERIC'

// Types the user can silence. Critical types are always delivered.
export const SILENCEABLE_TYPES: NotificationType[] = [
  'TRANSFER_REGISTERED',
  'CONSULTANT_TRANSFER',
  'PRODUCT_INTEREST',
  'REGISTRATION_REQUEST',
  'STALE_ORDER',
]

// Critical types are NEVER silenced
export const CRITICAL_TYPES: NotificationType[] = [
  'ORDER_CREATED',
  'ORDER_STATUS',
  'PAYMENT_CONFIRMED',
  'DOCUMENT_UPLOADED',
]

interface CreateNotificationInput {
  userId: string
  type: NotificationType
  title: string
  body?: string
  message?: string
  link?: string
}

/** Returns true if the user has this type enabled (or if it's critical). */
async function isTypeEnabled(userId: string, type: NotificationType): Promise<boolean> {
  if (CRITICAL_TYPES.includes(type)) return true
  if (!SILENCEABLE_TYPES.includes(type)) return true // GENERIC and unknown always on

  const admin = createAdminClient()
  const { data } = await admin
    .from('profiles')
    .select('notification_preferences')
    .eq('id', userId)
    .single()

  const prefs = (data?.notification_preferences ?? {}) as Record<string, boolean>
  // Missing key → enabled
  return prefs[type] !== false
}

export async function createNotification(input: CreateNotificationInput): Promise<void> {
  try {
    const admin = createAdminClient()
    const enabled = await isTypeEnabled(input.userId, input.type)
    if (!enabled) return

    await admin.from('notifications').insert({
      user_id: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? input.message ?? null,
      link: input.link ?? null,
    })
  } catch (err) {
    console.warn('[notifications] failed to create notification:', err)
  }
}

export async function createNotificationForRole(
  role: string,
  input: Omit<CreateNotificationInput, 'userId'>
): Promise<void> {
  try {
    const admin = createAdminClient()
    const { data: roles } = await admin.from('user_roles').select('user_id').eq('role', role)
    if (!roles?.length) return

    // Filter by preferences (skip critical check — done per-user below)
    const eligibleUserIds: string[] = []
    for (const r of roles) {
      const enabled = await isTypeEnabled(r.user_id, input.type)
      if (enabled) eligibleUserIds.push(r.user_id)
    }
    if (!eligibleUserIds.length) return

    await admin.from('notifications').insert(
      eligibleUserIds.map((uid) => ({
        user_id: uid,
        type: input.type,
        title: input.title,
        body: input.body ?? input.message ?? null,
        link: input.link ?? null,
      }))
    )
  } catch (err) {
    console.warn('[notifications] failed to create role notification:', err)
  }
}
