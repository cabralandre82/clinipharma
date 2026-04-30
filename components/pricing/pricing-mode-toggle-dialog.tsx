'use client'

/**
 * Dialog para flipar `products.pricing_mode` entre 'FIXED' e
 * 'TIERED_PROFILE'. Usado no /products/[id] (super-admin only).
 *
 * Por que um dialog em vez de um switch direto:
 *   - mudar pricing_mode é uma decisão comercial (a farmácia precisa
 *     ter combinado os tiers, o operador precisa ter um motivo de
 *     auditoria escrito).
 *   - flipar para TIERED_PROFILE sem profile vivo bloqueia novos
 *     pedidos (freeze trigger raise no_active_profile). O dialog
 *     mostra o aviso textualmente para que o operador entenda.
 *
 * O server action `togglePricingMode` faz o write + audit; este
 * componente apenas coleta a intenção.
 */

import { useState, useTransition } from 'react'
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { togglePricingMode } from '@/services/pricing'
import type { PricingMode } from '@/types'

interface Props {
  productId: string
  currentMode: PricingMode
  hasActiveProfile: boolean
}

export function PricingModeToggleDialog({ productId, currentMode, hasActiveProfile }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [pending, startTransition] = useTransition()

  const targetMode: PricingMode = currentMode === 'FIXED' ? 'TIERED_PROFILE' : 'FIXED'
  const targetLabel = targetMode === 'FIXED' ? 'preço fixo' : 'preços por tier'

  const willBlockOrders = targetMode === 'TIERED_PROFILE' && !hasActiveProfile

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!reason.trim()) {
      toast.error('Motivo é obrigatório')
      return
    }
    startTransition(async () => {
      const res = await togglePricingMode(productId, targetMode, reason.trim())
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(`Modo alterado para ${targetLabel}`)
      setOpen(false)
      setReason('')
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        Mudar para {targetLabel}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Alterar modo de precificação</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-slate-700">
            O modo atual é{' '}
            <span className="font-semibold">
              {currentMode === 'FIXED' ? 'preço fixo' : 'preços por tier'}
            </span>
            . Vai mudar para <span className="font-semibold">{targetLabel}</span>.
          </p>

          {willBlockOrders && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <strong>Atenção:</strong> este produto não tem nenhum pricing profile ativo. Ao mudar
              para preços por tier, novos pedidos serão <strong>bloqueados</strong> até que você
              cadastre o profile e os tiers.
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="toggle_reason">Motivo da alteração *</Label>
            <Textarea
              id="toggle_reason"
              rows={3}
              placeholder="Ex.: produto magistral passou a ter tabela de tiers acordada com a farmácia."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <div className="flex gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? 'Salvando...' : 'Confirmar alteração'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
