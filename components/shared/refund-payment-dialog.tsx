'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { processRefund } from '@/services/payments'
import { formatCurrency } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { RotateCcw, Loader2, AlertTriangle } from 'lucide-react'

interface RefundPaymentDialogProps {
  paymentId: string
  amount: number
  orderCode: string
}

export function RefundPaymentDialog({ paymentId, amount, orderCode }: RefundPaymentDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [notes, setNotes] = useState('')

  async function handleRefund() {
    if (loading) return
    setLoading(true)
    try {
      const result = await processRefund(paymentId, notes || undefined)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Estorno registrado com sucesso!')
      setOpen(false)
      router.refresh()
    } catch {
      toast.error('Erro ao registrar estorno')
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
            className="border-red-200 text-red-700 hover:bg-red-50"
          >
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            Registrar estorno
          </Button>
        }
      />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar estorno de pagamento</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="flex items-start gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-orange-500" />
            <p className="text-sm text-orange-800">
              Confirme que o valor já foi estornado externamente (PIX, TED, etc.) antes de registrar
              aqui. Esta ação não processa o estorno — apenas registra que ele foi feito.
            </p>
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs text-gray-500">
              Pedido: <span className="font-mono font-medium text-gray-900">{orderCode}</span>
            </p>
            <p className="mt-1 text-xl font-bold text-red-700">{formatCurrency(amount)}</p>
          </div>

          <div className="space-y-1.5">
            <Label>Observações (opcional)</Label>
            <Textarea
              placeholder="Comprovante, referência da devolução, etc."
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <Button
            className="w-full bg-red-600 text-white hover:bg-red-700"
            onClick={handleRefund}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Registrando...
              </>
            ) : (
              <>
                <RotateCcw className="mr-2 h-4 w-4" />
                Confirmar estorno realizado
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
