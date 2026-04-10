import 'server-only'
import { createAdminClient } from '@/lib/db/admin'
import { sendPushToUser, sendPushToRole, type PushPayload } from '@/lib/push'
import { type NotificationType, SILENCEABLE_TYPES, CRITICAL_TYPES } from '@/lib/notification-types'

export type { NotificationType }
export { SILENCEABLE_TYPES, CRITICAL_TYPES }

export interface CreateNotificationInput {
  userId: string
  type: NotificationType
  title: string
  body?: string
  message?: string
  link?: string
  /** If true, also sends a push notification in addition to in-app */
  push?: boolean | Partial<PushPayload>
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
    if (!input.userId) return
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

    // Send push notification for critical types or when explicitly requested
    const shouldPush = input.push !== undefined ? !!input.push : CRITICAL_TYPES.includes(input.type)

    if (shouldPush) {
      const pushOverride = typeof input.push === 'object' ? input.push : {}
      await sendPushToUser(input.userId, {
        title: pushOverride.title ?? input.title,
        body: pushOverride.body ?? input.body ?? input.message ?? '',
        link: pushOverride.link ?? input.link,
      })
    }
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

    // Push for critical types
    const shouldPush = input.push !== undefined ? !!input.push : CRITICAL_TYPES.includes(input.type)

    if (shouldPush) {
      await sendPushToRole(role, {
        title: input.title,
        body: input.body ?? input.message ?? '',
        link: input.link,
      })
    }
  } catch (err) {
    console.warn('[notifications] failed to create role notification:', err)
  }
}
