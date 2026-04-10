/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { requireRole } from '@/lib/rbac'
import { createAndSendContract, type ContractType } from '@/lib/clicksign'
import { createNotification } from '@/lib/notifications'
import { z } from 'zod'

const contractSchema = z.object({
  entityType: z.enum(['CLINIC', 'DOCTOR', 'PHARMACY', 'CONSULTANT']),
  entityId: z.string().uuid('entityId inválido'),
})

export async function POST(req: NextRequest) {
  try {
    await requireRole(['SUPER_ADMIN'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const parsed = contractSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })

  const { entityType, entityId } = parsed.data
  const admin = createAdminClient()
  const contractType = entityType as ContractType

  // Resolve entity details
  let partyName = ''
  let partyCpfCnpj: string | undefined
  let partyEmail: string | undefined
  let partyUserId: string | undefined

  if (entityType === 'CLINIC') {
    const { data } = await admin
      .from('clinics')
      .select('trade_name, cnpj, profiles(email, full_name)')
      .eq('id', entityId)
      .single()
    if (!data) return NextResponse.json({ error: 'Clinic not found' }, { status: 404 })
    const profile = (data as any).profiles as { email: string | null; full_name: string } | null
    partyName = (data as any).trade_name
    partyCpfCnpj = (data as any).cnpj ?? undefined
    partyEmail = profile?.email ?? undefined
    const { data: cm } = await admin
      .from('clinic_members')
      .select('user_id')
      .eq('clinic_id', entityId)
      .limit(1)
      .maybeSingle()
    partyUserId = cm?.user_id
  } else if (entityType === 'DOCTOR') {
    const { data } = await admin
      .from('doctors')
      .select('full_name, cpf, profiles(email)')
      .eq('id', entityId)
      .single()
    if (!data) return NextResponse.json({ error: 'Doctor not found' }, { status: 404 })
    const profile = (data as any).profiles as { email: string | null } | null
    partyName = (data as any).full_name
    partyCpfCnpj = (data as any).cpf ?? undefined
    partyEmail = profile?.email ?? undefined
    partyUserId = entityId
  } else if (entityType === 'PHARMACY') {
    const { data } = await admin
      .from('pharmacies')
      .select('trade_name, cnpj, profiles(email, full_name)')
      .eq('id', entityId)
      .single()
    if (!data) return NextResponse.json({ error: 'Pharmacy not found' }, { status: 404 })
    const profile = (data as any).profiles as { email: string | null; full_name: string } | null
    partyName = (data as any).trade_name
    partyCpfCnpj = (data as any).cnpj ?? undefined
    partyEmail = profile?.email ?? undefined
    partyUserId = entityId
  } else if (entityType === 'CONSULTANT') {
    const { data } = await admin
      .from('consultants')
      .select('full_name, cpf, profiles(email)')
      .eq('id', entityId)
      .single()
    if (!data) return NextResponse.json({ error: 'Consultant not found' }, { status: 404 })
    const profile = (data as any).profiles as { email: string | null } | null
    partyName = (data as any).full_name
    partyCpfCnpj = (data as any).cpf ?? undefined
    partyEmail = profile?.email ?? undefined
    partyUserId = entityId
  }

  // Create and send contract via Clicksign
  const { documentKey, signerKey } = await createAndSendContract({
    type: contractType,
    party: { name: partyName, cpfCnpj: partyCpfCnpj, email: partyEmail },
    clinipharmaRepEmail: process.env.EMAIL_FROM?.match(/<(.+)>/)?.[1],
  })

  // Save contract record
  const { data: contract, error } = await admin
    .from('contracts')
    .insert({
      type: `${entityType}_AGREEMENT`,
      status: 'SENT',
      entity_type: entityType,
      entity_id: entityId,
      user_id: partyUserId ?? null,
      clicksign_document_key: documentKey,
      clicksign_request_signature_key: signerKey,
      signers: [{ name: partyName, email: partyEmail, key: signerKey }],
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Notify user
  if (partyUserId) {
    await createNotification({
      userId: partyUserId,
      type: 'GENERIC',
      title: 'Contrato enviado para assinatura',
      message: `Um contrato foi enviado para seu email (${partyEmail}) via Clicksign. Por favor, assine para concluir o cadastro.`,
      link: '/profile',
    })
  }

  return NextResponse.json({ ok: true, contractId: contract.id, documentKey })
}

export async function GET(req: NextRequest) {
  try {
    await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = req.nextUrl
  const entityId = searchParams.get('entityId')

  const admin = createAdminClient()
  let query = admin.from('contracts').select('*').order('created_at', { ascending: false })
  if (entityId) query = query.eq('entity_id', entityId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
