'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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
import { registerConsultantTransfer } from '@/services/consultants'
import { formatCurrency } from '@/lib/utils'
import type { ConsultantCommission } from '@/types'

interface ConsultantTransferDialogProps {
  consultantId: string
  consultantName: string
  commissions: Array<ConsultantCommission & { orders: { code: string } | null }>
  totalAmount: number
}

export function ConsultantTransferDialog({
  consultantId,
  consultantName,
  commissions,
  totalAmount,
}: ConsultantTransferDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!reference.trim()) {
      setError('Informe a referência da transferência')
      return
    }
    setLoading(true)
    setError(null)

    const commissionIds = commissions.map((c) => c.id)
    const result = await registerConsultantTransfer(consultantId, commissionIds, reference, notes)
    setLoading(false)

    if (result.error) {
      setError(result.error)
      return
    }

    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="default">
            Registrar repasse
          </Button>
        }
      />
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar repasse — {consultantName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 pt-2">
          {/* Summary */}
          <div className="space-y-2 rounded-lg bg-blue-50 p-4">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Pedidos incluídos</span>
              <span className="font-medium text-slate-800">{commissions.length}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Valor total a transferir</span>
              <span className="text-lg font-bold text-blue-700">{formatCurrency(totalAmount)}</span>
            </div>
          </div>

          {/* Commission list */}
          <div className="max-h-36 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {commissions.map((c) => (
              <div key={c.id} className="flex justify-between px-3 py-2 text-xs text-slate-600">
                <span className="font-mono">{c.orders?.code ?? c.order_id.slice(0, 8)}</span>
                <span className="font-semibold">{formatCurrency(Number(c.commission_amount))}</span>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ct_reference">Referência da transferência *</Label>
            <Input
              id="ct_reference"
              placeholder="Ex: PIX 123456, TED 2026-04-09"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ct_notes">Observações</Label>
            <Textarea
              id="ct_notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Banco, chave PIX usada, etc."
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 pt-1">
            <Button onClick={handleSubmit} disabled={loading}>
              {loading ? 'Registrando...' : 'Confirmar repasse'}
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
