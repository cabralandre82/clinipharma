'use client'

import { useState, useTransition } from 'react'
import {
  CreditCard,
  QrCode,
  FileText,
  ExternalLink,
  Copy,
  CheckCircle2,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'

interface PaymentOptionsProps {
  orderId: string
  orderCode?: string
  amount: number
  /** Pre-loaded payment data (if payment already created) */
  payment?: {
    asaasPaymentId?: string | null
    asaasInvoiceUrl?: string | null
    asaasPixQrCode?: string | null
    asaasPixCopyPaste?: string | null
    asaasBoletoUrl?: string | null
    paymentLink?: string | null
    paymentDueDate?: string | null
    status?: string
  } | null
  /** Whether the current user is an admin (can generate payment) */
  isAdmin?: boolean
}

export function PaymentOptions({
  orderId,
  orderCode,
  amount,
  payment,
  isAdmin,
}: PaymentOptionsProps) {
  const [isPending, startTransition] = useTransition()
  const [data, setData] = useState(payment)
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState<'pix' | 'boleto' | 'card'>('pix')

  const hasPayment = !!data?.asaasPaymentId
  const isPaid = data?.status === 'CONFIRMED'

  function generatePayment() {
    startTransition(async () => {
      const res = await fetch('/api/payments/asaas/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error('Erro ao gerar cobrança: ' + (json.error ?? 'Tente novamente'))
        return
      }
      setData({
        asaasPaymentId: json.asaasPaymentId,
        asaasInvoiceUrl: json.invoiceUrl,
        asaasPixQrCode: json.pixQrCode,
        asaasPixCopyPaste: json.pixCopyPaste,
        paymentDueDate: json.dueDate,
        status: 'PENDING',
      })
      toast.success('Cobrança gerada! Envie as opções de pagamento ao cliente.')
    })
  }

  function copyPix() {
    if (!data?.asaasPixCopyPaste) return
    navigator.clipboard.writeText(data.asaasPixCopyPaste)
    setCopied(true)
    toast.success('Código PIX copiado!')
    setTimeout(() => setCopied(false), 2000)
  }

  if (isPaid) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
        <CheckCircle2 className="h-5 w-5 text-green-600" />
        <div>
          <p className="font-medium text-green-800">Pagamento confirmado</p>
          <p className="text-sm text-green-600">
            O pagamento foi recebido e confirmado automaticamente pelo sistema.
          </p>
        </div>
      </div>
    )
  }

  if (!hasPayment) {
    if (!isAdmin) {
      return (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          Aguardando a geração da cobrança pelo administrador.
        </div>
      )
    }
    return (
      <Button onClick={generatePayment} disabled={isPending} className="gap-2">
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <CreditCard className="h-4 w-4" />
        )}
        Gerar cobrança (PIX + Boleto + Cartão)
      </Button>
    )
  }

  return (
    <div className="space-y-4">
      {data?.paymentDueDate && (
        <p className="text-sm text-gray-500">
          Vencimento:{' '}
          <strong>{new Date(data.paymentDueDate + 'T12:00:00').toLocaleDateString('pt-BR')}</strong>
          {' · '}
          Valor:{' '}
          <strong>R$ {(amount / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
        </p>
      )}

      {/* Tab selector */}
      <div className="flex gap-2 rounded-lg border bg-gray-50 p-1">
        {(
          [
            { key: 'pix', icon: QrCode, label: 'PIX' },
            { key: 'boleto', icon: FileText, label: 'Boleto' },
            { key: 'card', icon: CreditCard, label: 'Cartão' },
          ] as const
        ).map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* PIX */}
      {activeTab === 'pix' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Pagar via PIX</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data?.asaasPixQrCode ? (
              <>
                <div className="flex justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:image/png;base64,${data.asaasPixQrCode}`}
                    alt="QR Code PIX"
                    className="h-48 w-48 rounded-md border"
                  />
                </div>
                {data.asaasPixCopyPaste && (
                  <div className="flex items-center gap-2">
                    <code className="flex-1 overflow-hidden rounded bg-gray-100 px-3 py-2 text-xs">
                      {data.asaasPixCopyPaste.slice(0, 50)}…
                    </code>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 gap-1.5"
                      onClick={copyPix}
                    >
                      {copied ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      Copiar
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <p className="text-center text-sm text-gray-500">QR Code PIX sendo gerado…</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Boleto */}
      {activeTab === 'boleto' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Pagar via Boleto</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.asaasBoletoUrl ? (
              <a href={data.asaasBoletoUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" className="w-full gap-2">
                  <FileText className="h-4 w-4" />
                  Abrir boleto bancário
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </a>
            ) : (
              <p className="text-sm text-gray-500">
                Boleto disponível em instantes. Tente atualizar a página.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Cartão */}
      {activeTab === 'card' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Pagar via Cartão de Crédito</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.asaasInvoiceUrl ? (
              <a href={data.asaasInvoiceUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" className="w-full gap-2">
                  <CreditCard className="h-4 w-4" />
                  Pagar com cartão
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </a>
            ) : (
              <p className="text-sm text-gray-500">Link de pagamento não disponível.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Universal link */}
      {data?.paymentLink && (
        <div className="text-center">
          <a
            href={data.paymentLink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline"
          >
            Abrir página de pagamento completa →
          </a>
        </div>
      )}
    </div>
  )
}
