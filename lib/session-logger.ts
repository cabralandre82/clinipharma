import 'server-only'
import { createAdminClient } from '@/lib/db/admin'
import { createNotification } from '@/lib/notifications'

export async function logSession(params: {
  userId: string
  ip?: string
  userAgent?: string
  event?: 'LOGIN' | 'LOGOUT' | 'SESSION_START' | 'PASSWORD_RESET'
}): Promise<void> {
  const { userId, ip, userAgent, event = 'SESSION_START' } = params
  const admin = createAdminClient()

  // Check if this is a new device (same userAgent not seen in last 90 days)
  let isNewDevice = false
  if (userAgent) {
    const since = new Date()
    since.setDate(since.getDate() - 90)
    const { count } = await admin
      .from('access_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('user_agent', userAgent)
      .gte('created_at', since.toISOString())

    isNewDevice = (count ?? 0) === 0
  }

  await admin.from('access_logs').insert({
    user_id: userId,
    event,
    ip: ip ?? null,
    user_agent: userAgent ?? null,
    is_new_device: isNewDevice,
  })

  // Alert on new device
  if (isNewDevice && event !== 'LOGOUT') {
    const device = parseDevice(userAgent)
    await createNotification({
      userId,
      type: 'ORDER_STATUS', // reuse as system alert
      title: '🔐 Novo dispositivo detectado',
      message: `Acesso de novo dispositivo: ${device}. IP: ${ip ?? 'desconhecido'}. Se não foi você, altere sua senha.`,
      link: '/profile',
    })
  }
}

function parseDevice(ua?: string): string {
  if (!ua) return 'Dispositivo desconhecido'
  if (/Mobile|Android|iPhone/.test(ua)) return 'Celular'
  if (/Tablet|iPad/.test(ua)) return 'Tablet'
  return 'Computador'
}
