import { fcmMessaging } from '@/lib/firebase-admin'
import { createAdminClient } from '@/lib/db/admin'
import { logger } from '@/lib/logger'

export interface PushPayload {
  title: string
  body: string
  link?: string
  icon?: string
}

/** Send push notification to all FCM tokens for a user */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  try {
    const admin = createAdminClient()
    const { data: tokens } = await admin.from('fcm_tokens').select('token').eq('user_id', userId)

    if (!tokens?.length) return

    const messages = tokens.map((t) => ({
      token: t.token,
      notification: { title: payload.title, body: payload.body },
      webpush: {
        notification: {
          title: payload.title,
          body: payload.body,
          icon: payload.icon ?? '/icon-192.png',
          badge: '/icon-192.png',
          click_action: payload.link,
        },
        fcmOptions: { link: payload.link ?? '/' },
      },
    }))

    const response = await fcmMessaging().sendEach(messages)

    // Clean up invalid tokens
    const invalidTokens: string[] = []
    response.responses.forEach((r, i) => {
      if (!r.success && r.error?.code === 'messaging/registration-token-not-registered') {
        invalidTokens.push(tokens[i].token)
      }
    })
    if (invalidTokens.length > 0) {
      await admin.from('fcm_tokens').delete().in('token', invalidTokens)
    }
  } catch (err) {
    logger.warn('failed to send push notification', { module: 'push', error: err })
  }
}

/** Send push to all users with a specific role */
export async function sendPushToRole(role: string, payload: PushPayload): Promise<void> {
  try {
    const admin = createAdminClient()
    const { data: roles } = await admin.from('user_roles').select('user_id').eq('role', role)
    if (!roles?.length) return
    await Promise.all(roles.map((r) => sendPushToUser(r.user_id, payload)))
  } catch (err) {
    logger.warn('failed to send push to role', { module: 'push', role, error: err })
  }
}
