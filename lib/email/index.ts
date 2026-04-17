import { Resend } from 'resend'
import { withCircuitBreaker, CircuitOpenError } from '@/lib/circuit-breaker'
import { logger } from '@/lib/logger'

const resend = new Resend(process.env.RESEND_API_KEY)

const FROM = process.env.EMAIL_FROM ?? 'Clinipharma <noreply@clinipharma.com.br>'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://clinipharma-three.vercel.app'

export { FROM, APP_URL }

interface SendEmailOptions {
  to: string | string[]
  subject: string
  html: string
}

export async function sendEmail({ to, subject, html }: SendEmailOptions): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    logger.warn('RESEND_API_KEY not set — skipping email', { module: 'email', subject })
    return
  }

  try {
    await withCircuitBreaker(() => resend.emails.send({ from: FROM, to, subject, html }), {
      name: 'resend',
      failureThreshold: 3,
      recoveryTimeMs: 60_000,
    })
  } catch (err) {
    if (err instanceof CircuitOpenError) {
      logger.warn('Circuit OPEN — skipping email', { module: 'email', subject })
    } else {
      logger.error('Failed to send email', { module: 'email', subject, error: err })
    }
  }
}
