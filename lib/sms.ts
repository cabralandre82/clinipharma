import twilio from 'twilio'

function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) return null
  return twilio(sid, token)
}

export async function sendSms(to: string, body: string): Promise<void> {
  const from = process.env.TWILIO_PHONE_NUMBER
  if (!from) {
    console.warn('[sms] TWILIO_PHONE_NUMBER not configured')
    return
  }

  // Normalize BR phone: ensure +55 prefix
  const normalizedTo = to.startsWith('+') ? to : `+55${to.replace(/\D/g, '')}`

  try {
    const client = getTwilioClient()
    if (!client) {
      console.warn('[sms] Twilio not configured')
      return
    }
    await client.messages.create({ to: normalizedTo, from, body })
  } catch (err) {
    console.warn('[sms] Failed to send SMS:', err)
  }
}

// ── SMS templates ─────────────────────────────────────────────────────────────

export const SMS = {
  orderCreated: (code: string) =>
    `Clinipharma: Pedido ${code} recebido com sucesso. Acompanhe em clinipharma.com.br`,

  paymentConfirmed: (code: string) =>
    `Clinipharma: Pagamento do pedido ${code} confirmado! Em breve a farmácia iniciará a execução.`,

  orderReady: (code: string) =>
    `Clinipharma: Pedido ${code} pronto para entrega! Entre em contato com a farmácia.`,

  orderDelivered: (code: string) => `Clinipharma: Pedido ${code} entregue com sucesso. Obrigado!`,

  staleOrder: (code: string, days: number) =>
    `Clinipharma: O pedido ${code} está parado há ${days} dias. Acesse clinipharma.com.br para verificar.`,
}
