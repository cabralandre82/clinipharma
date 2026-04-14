'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { acknowledgeTransferReversal } from '@/services/payments'
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
import { Undo2, Loader2, AlertTriangle } from 'lucide-react'

interface AcknowledgeReversalDialogProps {
  transferId: string
  amount: number
  pharmacyName: string
}

export function AcknowledgeReversalDialog({
  transferId,
  amount,
  pharmacyName,
}: AcknowledgeReversalDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [notes, setNotes] = useState('')

  async function handleReversal() {
    if (loading) return
    setLoading(true)
    try {
      const result = await acknowledgeTransferReversal(transferId, notes || undefined)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Reversão de repasse registrada!')
      setOpen(false)
      router.refresh()
    } catch {
      toast.error('Erro ao registrar reversão')
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
            className="border-orange-200 text-orange-700 hover:bg-orange-50"
          >
            <Undo2 className="mr-1 h-3.5 w-3.5" />
            Registrar reversão
          </Button>
        }
      />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar reversão de repasse</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="flex items-start gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-orange-500" />
            <p className="text-sm text-orange-800">
              Confirme que a farmácia já devolveu o valor ou que há um acordo de compensação antes
              de registrar aqui. Esta ação não movimenta dinheiro — apenas registra a reversão.
            </p>
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs text-gray-500">
              Farmácia: <span className="font-medium text-gray-900">{pharmacyName}</span>
            </p>
            <p className="mt-1 text-xl font-bold text-orange-700">{formatCurrency(amount)}</p>
          </div>

          <div className="space-y-1.5">
            <Label>Observações (opcional)</Label>
            <Textarea
              placeholder="Como foi feita a reversão, referência, etc."
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <Button
            className="w-full bg-orange-600 text-white hover:bg-orange-700"
            onClick={handleReversal}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Registrando...
              </>
            ) : (
              <>
                <Undo2 className="mr-2 h-4 w-4" />
                Confirmar reversão realizada
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
