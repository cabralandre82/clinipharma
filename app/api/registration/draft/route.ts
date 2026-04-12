import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { registrationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

/**
 * POST /api/registration/draft
 *
 * Salva o rascunho do formulário de cadastro quando o usuário avança
 * para a etapa de documentos — sem criar conta no auth ainda.
 * Garante que o admin sempre saiba quem manifestou interesse.
 *
 * O rascunho expira em 7 dias (cron /api/cron/purge-drafts).
 * É deletado automaticamente após um submit bem-sucedido.
 */
export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0] ?? req.headers.get('x-real-ip') ?? 'unknown'

  const rl = await registrationLimiter.check(`draft:${ip}`)
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Muitas tentativas. Aguarde antes de tentar novamente.' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
      }
    )
  }

  try {
    const body = await req.json()
    const { type, form_data } = body as { type: string; form_data: Record<string, unknown> }

    if (!type || !form_data || !form_data.email) {
      return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
    }

    const admin = createAdminClient()

    const { data, error } = await admin
      .from('registration_drafts')
      .insert({ type, form_data, ip_address: ip })
      .select('id')
      .single()

    if (error || !data) {
      logger.error('[registration/draft] failed to save draft', { error })
      return NextResponse.json({ error: 'Erro ao salvar rascunho' }, { status: 500 })
    }

    return NextResponse.json({ draft_id: data.id })
  } catch (err) {
    logger.error('[registration/draft] unexpected error', { err })
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
