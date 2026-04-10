import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { createNotification } from '@/lib/notifications'

/**
 * Clicksign webhook handler.
 * Configure in Clicksign sandbox: POST https://clinipharma.com.br/api/contracts/webhook
 */
export async function POST(req: NextRequest) {
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

    // Notify admins
    await createNotification({
      userId: '',
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
