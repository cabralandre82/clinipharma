import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { createNotification, createNotificationForRole } from '@/lib/notifications'

/**
 * Clicksign webhook handler.
 * Configure in Clicksign: POST https://clinipharma.com.br/api/contracts/webhook
 * Set CLICKSIGN_WEBHOOK_SECRET env var and pass it as X-Clicksign-Secret header in Clicksign settings.
 */
export async function POST(req: NextRequest) {
  // Verify shared secret to prevent forged webhook events
  const secret = process.env.CLICKSIGN_WEBHOOK_SECRET
  if (secret) {
    const receivedSecret =
      req.headers.get('x-clicksign-secret') ?? req.nextUrl.searchParams.get('secret')
    if (receivedSecret !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const body = await req.json()
  const eventType: string = body.event?.name ?? ''
  const documentKey: string = body.document?.key ?? ''

  if (!documentKey) return NextResponse.json({ ok: true, skipped: true })

  const admin = createAdminClient()

  const { data: contract } = await admin
    .from('contracts')
    .select('id, type, entity_type, entity_id, user_id, status')
    .eq('clicksign_document_key', documentKey)
    .single()

  if (!contract) return NextResponse.json({ ok: true, skipped: 'contract not found' })

  if (eventType === 'sign' || eventType === 'auto_close') {
    await admin
      .from('contracts')
      .update({
        status: 'SIGNED',
        signed_at: new Date().toISOString(),
        document_url: body.document?.downloads?.signed_file_url ?? null,
      })
      .eq('id', contract.id)

    // Notify user
    if (contract.user_id) {
      await createNotification({
        userId: contract.user_id,
        type: 'GENERIC',
        title: 'Contrato assinado com sucesso',
        message: 'Seu contrato foi assinado digitalmente. Bem-vindo(a) à Clinipharma!',
        link: '/profile',
      })
    }

    // Notify all super admins
    await createNotificationForRole('SUPER_ADMIN', {
      type: 'GENERIC',
      title: `Contrato ${contract.type} assinado`,
      message: `Contrato ${contract.type} (entidade ${contract.entity_id}) foi assinado digitalmente.`,
      link: `/registrations`,
    })
  }

  if (eventType === 'deadline_exceeded' || eventType === 'cancelled') {
    await admin
      .from('contracts')
      .update({ status: eventType === 'cancelled' ? 'CANCELLED' : 'EXPIRED' })
      .eq('id', contract.id)

    if (contract.user_id) {
      await createNotification({
        userId: contract.user_id,
        type: 'GENERIC',
        title: `Contrato ${eventType === 'cancelled' ? 'cancelado' : 'expirado'}`,
        message: 'Seu contrato expirou ou foi cancelado. Entre em contato com a Clinipharma.',
        link: '/profile',
      })
    }
  }

  return NextResponse.json({ ok: true, event: eventType })
}
