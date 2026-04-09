'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
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
import { updatePharmacyCost } from '@/services/products'
import { formatCurrency } from '@/lib/utils'
import { Building2 } from 'lucide-react'

interface Props {
  productId: string
  currentCost: number
}

export function PharmacyCostUpdateForm({ productId, currentCost }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [newCost, setNewCost] = useState('')
  const [reason, setReason] = useState('')

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!reason.trim()) {
      toast.error('Motivo é obrigatório')
      return
    }
    const cost = parseFloat(newCost)
    if (isNaN(cost) || cost < 0) {
      toast.error('Valor inválido')
      return
    }

    setLoading(true)
    const result = await updatePharmacyCost(productId, cost, reason)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Custo de farmácia atualizado!')
      setOpen(false)
      setNewCost('')
      setReason('')
      router.refresh()
    }
    setLoading(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Building2 className="mr-2 h-4 w-4" />
        Atualizar repasse
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Atualizar Repasse à Farmácia</DialogTitle>
        </DialogHeader>
        <div className="mb-4 rounded-md bg-gray-50 p-3">
          <p className="text-sm text-gray-500">Custo atual</p>
          <p className="text-lg font-semibold text-slate-800">{formatCurrency(currentCost)}</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new_cost">Novo valor de repasse (R$) *</Label>
            <Input
              id="new_cost"
              type="number"
              step="0.01"
              min="0"
              placeholder="0,00"
              value={newCost}
              onChange={(e) => setNewCost(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cost_reason">Motivo da alteração *</Label>
            <Textarea
              id="cost_reason"
              rows={3}
              placeholder="Descreva o motivo da alteração..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div className="flex gap-3">
            <Button type="submit" disabled={loading}>
              {loading ? 'Salvando...' : 'Confirmar alteração'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
