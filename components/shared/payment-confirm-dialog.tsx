'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { confirmPayment } from '@/services/payments'
import { formatCurrency } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CheckCircle2, Loader2 } from 'lucide-react'

interface PaymentConfirmDialogProps {
  paymentId: string
  amount: number
  orderCode: string
}

export function PaymentConfirmDialog({ paymentId, amount, orderCode }: PaymentConfirmDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [method, setMethod] = useState('PIX')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')

  async function handleConfirm() {
    if (loading) return
    setLoading(true)
    try {
      const result = await confirmPayment({
        paymentId,
        paymentMethod: method,
        referenceCode: reference,
        notes,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Pagamento confirmado!')
      setOpen(false)
      router.refresh()
    } catch {
      toast.error('Erro ao confirmar pagamento')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            className="border-green-200 text-green-700 hover:bg-green-50"
          >
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
            Confirmar
          </Button>
        }
      />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Confirmar pagamento</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs text-gray-500">
              Pedido: <span className="font-mono font-medium text-gray-900">{orderCode}</span>
            </p>
            <p className="mt-1 text-xl font-bold text-[hsl(213,75%,24%)]">
              {formatCurrency(amount)}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Método de pagamento</Label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
            >
              <option value="PIX">PIX</option>
              <option value="TED">TED</option>
              <option value="BOLETO">Boleto</option>
              <option value="CARTAO_CREDITO">Cartão de Crédito</option>
              <option value="MANUAL">Outro</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label>Código de referência (opcional)</Label>
            <Input
              placeholder="ID da transação, chave, etc."
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Observações (opcional)</Label>
            <Textarea
              placeholder="Observações adicionais"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <Button className="w-full" onClick={handleConfirm} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Confirmando...
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Confirmar pagamento
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
