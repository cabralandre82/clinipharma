import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { getDaysDiff, getStaleThreshold } from '@/lib/stale-orders'
import { sendEmail } from '@/lib/email'
import { createNotification } from '@/lib/notifications'

/**
 * GET /api/cron/stale-orders
 * Called daily by Vercel Cron (see vercel.json).
 * Sends in-app + email alerts for stale orders to SUPER_ADMINs and PHARMACY_ADMINs.
 */
export async function GET(req: NextRequest) {
  // Verify cron secret so only Vercel can call this
  const secret = req.headers.get('authorization')
  if (secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  const { data: orders } = await admin
    .from('orders')
    .select(
      `id, code, order_status, updated_at,
       pharmacy_id,
       clinics(trade_name), pharmacies(trade_name)`
    )
    .not('order_status', 'in', '("COMPLETED","CANCELED","DRAFT")')

  const stale: Array<{
    id: string
    code: string
    order_status: string
    daysStale: number
    threshold: number
    clinic: string
    pharmacy: string
    pharmacy_id: string
  }> = []

  for (const o of orders ?? []) {
    const threshold = getStaleThreshold(o.order_status)
    if (!threshold) continue
    const days = getDaysDiff(o.updated_at)
    if (days >= threshold) {
      stale.push({
        id: o.id,
        code: o.code,
        order_status: o.order_status,
        daysStale: days,
        threshold,
        clinic: (o.clinics as { trade_name?: string } | null)?.trade_name ?? '—',
        pharmacy: (o.pharmacies as { trade_name?: string } | null)?.trade_name ?? '—',
        pharmacy_id: o.pharmacy_id,
      })
    }
  }

  if (stale.length === 0) {
    return NextResponse.json({ ok: true, stale: 0 })
  }

  // ── Notify SUPER_ADMINs ───────────────────────────────
  const { data: superAdmins } = await admin
    .from('user_roles')
    .select('user_id, profiles(email, full_name)')
    .eq('role', 'SUPER_ADMIN')

  const origin = req.headers.get('origin') ?? process.env.NEXT_PUBLIC_APP_URL ?? ''

  const emailBody = buildDigestEmail(stale, origin)

  for (const sa of superAdmins ?? []) {
    const profile = sa.profiles as { email?: string; full_name?: string } | null
    if (!profile?.email) continue

    await createNotification({
      userId: sa.user_id,
      type: 'STALE_ORDER',
      title: `${stale.length} pedido(s) parado(s)`,
      message: `${stale.length} pedido(s) sem movimentação. Verifique os pedidos.`,
      link: '/orders?status=open',
    })

    await sendEmail({
      to: profile.email,
      subject: `⚠️ Clinipharma — ${stale.length} pedido(s) parado(s)`,
      html: emailBody,
    })
  }

  // ── Notify PHARMACY_ADMINs (only their own stale orders) ─
  const pharmacyGroups: Record<string, typeof stale> = {}
  for (const o of stale) {
    if (!pharmacyGroups[o.pharmacy_id]) pharmacyGroups[o.pharmacy_id] = []
    pharmacyGroups[o.pharmacy_id].push(o)
  }

  const { data: pharmacyAdmins } = await admin
    .from('user_roles')
    .select('user_id, profiles(email, full_name, pharmacy_id)')
    .eq('role', 'PHARMACY_ADMIN')

  for (const pa of pharmacyAdmins ?? []) {
    const profile = pa.profiles as {
      email?: string
      full_name?: string
      pharmacy_id?: string
    } | null
    if (!profile?.email || !profile?.pharmacy_id) continue

    const myStale = pharmacyGroups[profile.pharmacy_id] ?? []
    if (myStale.length === 0) continue

    await createNotification({
      userId: pa.user_id,
      type: 'STALE_ORDER',
      title: `${myStale.length} pedido(s) parado(s) na sua farmácia`,
      message: `${myStale.length} pedido(s) aguardam ação.`,
      link: '/orders',
    })

    await sendEmail({
      to: profile.email,
      subject: `⚠️ Clinipharma — ${myStale.length} pedido(s) aguardando ação`,
      html: buildDigestEmail(myStale, origin, true),
    })
  }

  return NextResponse.json({ ok: true, stale: stale.length })
}

const STATUS_LABELS: Record<string, string> = {
  AWAITING_DOCUMENTS: 'Aguardando Documentos',
  READY_FOR_REVIEW: 'Em Revisão',
  AWAITING_PAYMENT: 'Aguardando Pagamento',
  PAYMENT_UNDER_REVIEW: 'Pagamento em Análise',
  COMMISSION_CALCULATED: 'Comissão Calculada',
  TRANSFER_PENDING: 'Repasse Pendente',
  RELEASED_FOR_EXECUTION: 'Liberado para Farmácia',
  RECEIVED_BY_PHARMACY: 'Recebido pela Farmácia',
  IN_EXECUTION: 'Em Execução',
  READY: 'Pronto para Envio',
  SHIPPED: 'Enviado',
}

function buildDigestEmail(
  stale: Array<{
    id: string
    code: string
    order_status: string
    daysStale: number
    clinic: string
    pharmacy: string
  }>,
  origin: string,
  isPharmacy = false
) {
  const rows = stale
    .map(
      (o) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;">
          <a href="${origin}/orders/${o.id}" style="color:#0891b2;font-weight:600;text-decoration:none;">${o.code}</a>
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#374151;">${o.clinic}</td>
        ${!isPharmacy ? `<td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#374151;">${o.pharmacy}</td>` : ''}
        <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#6b7280;">${STATUS_LABELS[o.order_status] ?? o.order_status}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:center;">
          <span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:9999px;font-size:12px;font-weight:700;">
            ${o.daysStale}d
          </span>
        </td>
      </tr>`
    )
    .join('')

  return `
  <!DOCTYPE html>
  <html lang="pt-BR">
  <body style="font-family:system-ui,sans-serif;background:#f8fafc;margin:0;padding:20px;">
    <div style="max-width:640px;margin:auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
      <div style="background:#1e3a5f;padding:24px 32px;">
        <h1 style="margin:0;color:#fff;font-size:18px;">⚠️ Pedidos Parados — Clinipharma</h1>
        <p style="margin:4px 0 0;color:#93c5fd;font-size:13px;">${stale.length} pedido(s) sem movimentação</p>
      </div>
      <div style="padding:24px 32px;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#f8fafc;">
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Pedido</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Clínica</th>
              ${!isPharmacy ? '<th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Farmácia</th>' : ''}
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Status</th>
              <th style="padding:8px 12px;text-align:center;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Parado</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="margin-top:24px;text-align:center;">
          <a href="${origin}/orders" style="background:#1e3a5f;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">
            Ver todos os pedidos
          </a>
        </div>
      </div>
      <div style="background:#f8fafc;padding:16px 32px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;">
        Clinipharma · Este email foi gerado automaticamente
      </div>
    </div>
  </body>
  </html>`
}
