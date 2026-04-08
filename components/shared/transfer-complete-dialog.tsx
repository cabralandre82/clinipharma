'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { completeTransfer } from '@/services/payments'
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
import { ArrowLeftRight, Loader2 } from 'lucide-react'

interface TransferCompleteDialogProps {
  transferId: string
  amount: number
  pharmacyName: string
}

export function TransferCompleteDialog({
  transferId,
  amount,
  pharmacyName,
}: TransferCompleteDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')

  async function handleComplete() {
    if (!reference.trim()) {
      toast.error('Informe a referência da transferência')
      return
    }
    setLoading(true)
    try {
      const result = await completeTransfer(transferId, reference, notes)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Repasse registrado! Pedido liberado para execução.')
      setOpen(false)
      router.refresh()
    } catch {
      toast.error('Erro ao registrar repasse')
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
            className="border-blue-200 text-blue-700 hover:bg-blue-50"
          >
            <ArrowLeftRight className="mr-1 h-3.5 w-3.5" />
            Registrar
          </Button>
        }
      />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar repasse</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
            <p className="text-xs text-gray-500">
              Farmácia: <span className="font-medium text-gray-900">{pharmacyName}</span>
            </p>
            <p className="mt-1 text-xl font-bold text-[hsl(213,75%,24%)]">
              {formatCurrency(amount)}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              Após registrar, o pedido será liberado para execução
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Referência da transferência *</Label>
            <Input
              placeholder="ID da TED, chave PIX, etc."
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Observações (opcional)</Label>
            <Textarea
              placeholder="Notas sobre o repasse"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <Button className="w-full" onClick={handleComplete} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Registrando...
              </>
            ) : (
              <>
                <ArrowLeftRight className="mr-2 h-4 w-4" />
                Confirmar repasse
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
