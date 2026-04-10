/**
 * WhatsApp integration via Evolution API (self-hosted).
 *
 * SETUP STEPS (TODO when WhatsApp number is ready):
 * 1. Deploy Evolution API container to Render/VPS (use docker image atendai/evolution-api:v2.2.3)
 * 2. Set EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE_NAME in env vars
 * 3. Create instance: POST /instance/create
 * 4. Connect WhatsApp: GET /instance/connect/{instance} → scan QR code
 * 5. Configure webhook: POST /webhook/set/{instance} with your /api/webhooks/whatsapp URL
 */

const API_URL = process.env.EVOLUTION_API_URL
const API_KEY = process.env.EVOLUTION_API_KEY
const INSTANCE = process.env.EVOLUTION_INSTANCE_NAME ?? 'clinipharma'

function isConfigured(): boolean {
  return !!API_URL && API_URL !== 'PENDING_DEPLOY' && !!API_KEY
}

async function evolutionFetch(path: string, body: object): Promise<void> {
  if (!isConfigured()) {
    console.warn('[whatsapp] Evolution API not configured yet — message skipped:', path)
    return
  }
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: API_KEY! },
      body: JSON.stringify(body),
    })
    if (!res.ok) console.warn('[whatsapp] API error:', res.status, await res.text())
  } catch (err) {
    console.warn('[whatsapp] Failed to send message:', err)
  }
}

/** Normalize phone to WhatsApp format: 5511999999999 */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('55')) return digits
  return `55${digits}`
}

export async function sendWhatsApp(phone: string, text: string): Promise<void> {
  if (!phone?.trim()) return
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 10) {
    console.warn('[whatsapp] Invalid phone number, skipping:', phone)
    return
  }
  await evolutionFetch(`/message/sendText/${INSTANCE}`, {
    number: normalizePhone(phone),
    text,
  })
}

// ── Message templates ─────────────────────────────────────────────────────────

export const WA = {
  orderCreated: (code: string, clinicName: string) =>
    `✅ *Clinipharma* — Olá, ${clinicName}!\n\nSeu pedido *${code}* foi recebido com sucesso.\n\nAcompanhe o status em: https://clinipharma.com.br`,

  paymentConfirmed: (code: string) =>
    `💳 *Clinipharma* — Pagamento do pedido *${code}* confirmado!\n\nEm breve a farmácia iniciará a execução. Acompanhe em: https://clinipharma.com.br`,

  orderReady: (code: string) =>
    `📦 *Clinipharma* — Pedido *${code}* pronto!\n\nSeu pedido está pronto para entrega. Entre em contato com a farmácia para combinar a entrega.`,

  orderShipped: (code: string) =>
    `🚚 *Clinipharma* — Pedido *${code}* enviado!\n\nSeu pedido saiu para entrega. Acesse clinipharma.com.br para detalhes.`,

  orderDelivered: (code: string) =>
    `🎉 *Clinipharma* — Pedido *${code}* entregue!\n\nObrigado pela confiança. Qualquer dúvida, estamos à disposição.`,

  registrationApproved: (name: string) =>
    `✅ *Clinipharma* — Olá, ${name}!\n\nSeu cadastro foi *aprovado*! Você já pode acessar a plataforma e realizar pedidos em: https://clinipharma.com.br`,

  registrationRejected: (name: string, reason: string) =>
    `❌ *Clinipharma* — Olá, ${name}.\n\nInfelizmente seu cadastro não foi aprovado.\n\n*Motivo:* ${reason}\n\nEm caso de dúvidas, entre em contato conosco.`,

  contractSent: (name: string) =>
    `📝 *Clinipharma* — Olá, ${name}!\n\nUm contrato foi enviado para sua assinatura. Verifique seu email para assinar digitalmente via Clicksign.`,

  staleOrderAlert: (code: string, days: number) =>
    `⚠️ *Clinipharma* — Alerta: o pedido *${code}* está parado há *${days} dias* sem movimentação.\n\nAcesse https://clinipharma.com.br para verificar.`,

  productInterestConfirm: (name: string, productName: string) =>
    `👋 *Clinipharma* — Olá, ${name}!\n\nRegistramos seu interesse no produto *${productName}*. Assim que estiver disponível, entraremos em contato.`,
}
