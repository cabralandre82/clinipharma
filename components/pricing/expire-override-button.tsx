'use client'

/**
 * Botão "Encerrar override" — abre dialog para coletar motivo,
 * chama `expireBuyerOverride` (server action). Server seta
 * effective_until = max(now, from + 1ms) para honrar o CHECK
 * temporal e o EXCLUDE no_overlap (mig-074/075).
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
import { expireBuyerOverride } from '@/services/pricing'

interface Props {
  overrideId: string
  buyerLabel: string
}

export function ExpireOverrideButton({ overrideId, buyerLabel }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!reason.trim()) {
      toast.error('Motivo é obrigatório')
      return
    }
    startTransition(async () => {
      const res = await expireBuyerOverride(overrideId, reason.trim())
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success('Override encerrado')
      setOpen(false)
      setReason('')
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>Encerrar</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Encerrar override</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-slate-700">
            Vai encerrar o override para <strong>{buyerLabel}</strong>. Pedidos futuros voltam a
            usar o piso do produto-padrão.
          </p>
          <div className="space-y-2">
            <Label htmlFor="exp_reason">Motivo *</Label>
            <Textarea
              id="exp_reason"
              rows={3}
              placeholder="Ex.: contrato encerrado em 2026-04-30"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div className="flex gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? 'Salvando...' : 'Encerrar'}
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
