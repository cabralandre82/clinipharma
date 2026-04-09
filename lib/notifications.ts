import { createAdminClient } from '@/lib/db/admin'

export type NotificationType =
  | 'ORDER_CREATED'
  | 'ORDER_STATUS'
  | 'PAYMENT_CONFIRMED'
  | 'TRANSFER_REGISTERED'
  | 'CONSULTANT_TRANSFER'
  | 'DOCUMENT_UPLOADED'
  | 'PRODUCT_INTEREST'
  | 'GENERIC'

interface CreateNotificationInput {
  userId: string
  type: NotificationType
  title: string
  body?: string
  link?: string
}

export async function createNotification(input: CreateNotificationInput): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin.from('notifications').insert({
      user_id: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
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
    await admin.from('notifications').insert(
      roles.map((r) => ({
        user_id: r.user_id,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
      }))
    )
  } catch (err) {
    console.warn('[notifications] failed to create role notification:', err)
  }
}
