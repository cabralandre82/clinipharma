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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import type { OrderStatus } from '@/types'
import { PackageCheck, FlaskConical, CheckCircle, Truck, MapPin } from 'lucide-react'

interface TransitionConfig {
  next: OrderStatus
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  notesLabel: string
  notesPlaceholder: string
  notesRequired?: boolean
  trackingField?: boolean
}

const pharmacyTransitions: Partial<Record<OrderStatus, TransitionConfig>> = {
  RELEASED_FOR_EXECUTION: {
    next: 'RECEIVED_BY_PHARMACY',
    label: 'Confirmar Recebimento',
    description: 'Confirme que sua farmácia recebeu e aceita executar este pedido.',
    icon: PackageCheck,
    notesLabel: 'Observações (opcional)',
    notesPlaceholder: 'Ex: pedido recebido em perfeitas condições…',
  },
  RECEIVED_BY_PHARMACY: {
    next: 'IN_EXECUTION',
    label: 'Iniciar Manipulação',
    description: 'Informe que a manipulação/preparação do pedido foi iniciada.',
    icon: FlaskConical,
    notesLabel: 'Observações (opcional)',
    notesPlaceholder: 'Ex: farmacêutico responsável, lote iniciado…',
  },
  IN_EXECUTION: {
    next: 'READY',
    label: 'Preparação Concluída',
    description: 'Marque o pedido como pronto para envio ou retirada.',
    icon: CheckCircle,
    notesLabel: 'Observações (opcional)',
    notesPlaceholder: 'Ex: produto embalado e lacrado, pronto para despacho…',
  },
  READY: {
    next: 'SHIPPED',
    label: 'Registrar Envio',
    description: 'Informe o despacho do pedido e, se disponível, o código de rastreamento.',
    icon: Truck,
    notesLabel: 'Observações (opcional)',
    notesPlaceholder: 'Ex: transportadora, previsão de entrega…',
    trackingField: true,
  },
  SHIPPED: {
    next: 'DELIVERED',
    label: 'Confirmar Entrega',
    description: 'Confirme que o pedido foi entregue ao destinatário.',
    icon: MapPin,
    notesLabel: 'Observações (opcional)',
    notesPlaceholder: 'Ex: entregue em mãos, assinatura coletada…',
  },
}

interface Props {
  orderId: string
  currentStatus: OrderStatus
}

export function PharmacyOrderActions({ orderId, currentStatus }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [trackingCode, setTrackingCode] = useState('')
  const [loading, setLoading] = useState(false)

  const transition = pharmacyTransitions[currentStatus]

  if (!transition) return null

  const Icon = transition.icon

  async function handleAction() {
    if (transition!.notesRequired && !notes.trim()) {
      toast.error(`${transition!.notesLabel} é obrigatório`)
      return
    }

    setLoading(true)
    const reasonParts: string[] = []
    if (trackingCode.trim()) reasonParts.push(`Rastreio: ${trackingCode.trim()}`)
    if (notes.trim()) reasonParts.push(notes.trim())
    const reason = reasonParts.join(' | ') || undefined

    try {
      const res = await fetch(`/api/orders/${orderId}/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newStatus: transition!.next, reason }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Erro ao atualizar status')
      } else {
        toast.success(`Pedido atualizado: ${transition!.label}`)
        setOpen(false)
        setNotes('')
        setTrackingCode('')
        router.refresh()
      }
    } catch {
      toast.error('Erro de conexão')
    }
    setLoading(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Icon className="mr-2 h-4 w-4" />
        {transition.label}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-blue-600" />
            {transition.label}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-gray-600">{transition.description}</p>

          {transition.trackingField && (
            <div className="space-y-1.5">
              <Label htmlFor="tracking">
                Código de rastreamento <span className="font-normal text-gray-400">(opcional)</span>
              </Label>
              <Input
                id="tracking"
                value={trackingCode}
                onChange={(e) => setTrackingCode(e.target.value)}
                placeholder="Ex: BR123456789BR"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="notes">
              {transition.notesLabel}
              {transition.notesRequired && <span className="ml-1 text-red-500">*</span>}
            </Label>
            <Textarea
              id="notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={transition.notesPlaceholder}
            />
          </div>

          <div className="flex gap-3">
            <Button onClick={handleAction} disabled={loading}>
              {loading ? 'Salvando...' : 'Confirmar'}
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
