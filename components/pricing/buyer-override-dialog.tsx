'use client'

/**
 * Dialog para criar um buyer pricing override (PR-B/C).
 *
 * O override "exceções negociadas" — uma clínica fechou um piso
 * diferente do produto-padrão para um produto específico. Este
 * componente coleta o (buyer, piso abs, piso pct, motivo) e chama
 * `createBuyerOverride`. O servidor aplica RLS, audit, e o trigger
 * trg_bpo_no_overlap rejeita sobreposição.
 *
 * Polimorfismo: o operador escolhe entre clínica OU médico via
 * radio. As listas são pré-populadas pelo server component pai
 * (apenas IDs/nomes que ele tem permissão de ver via admin client).
 *
 * UX: campos em REAIS, não centavos. Conversão no submit.
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createBuyerOverride } from '@/services/pricing'
import { Plus } from 'lucide-react'

interface BuyerOption {
  id: string
  label: string
}

interface Props {
  productId: string
  clinics: BuyerOption[]
  doctors: BuyerOption[]
}

function brlToCents(brl: string): number | null {
  const trimmed = brl.trim().replace(/\./g, '').replace(',', '.')
  if (!trimmed) return null
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

export function BuyerOverrideDialog({ productId, clinics, doctors }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [buyerKind, setBuyerKind] = useState<'clinic' | 'doctor'>('clinic')
  const [buyerId, setBuyerId] = useState<string>('')
  const [floorAbsBrl, setFloorAbsBrl] = useState('')
  const [floorPctStr, setFloorPctStr] = useState('')
  const [reason, setReason] = useState('')

  function reset() {
    setBuyerKind('clinic')
    setBuyerId('')
    setFloorAbsBrl('')
    setFloorPctStr('')
    setReason('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!buyerId) {
      toast.error('Escolha o destinatário (clínica ou médico)')
      return
    }
    const floorAbsCents = floorAbsBrl.trim() ? brlToCents(floorAbsBrl) : null
    if (floorAbsBrl.trim() && (floorAbsCents === null || floorAbsCents <= 0)) {
      toast.error('Piso absoluto inválido')
      return
    }
    const floorPct = floorPctStr.trim() ? Number(floorPctStr.replace(',', '.')) : null
    if (
      floorPctStr.trim() &&
      (floorPct === null || !Number.isFinite(floorPct) || floorPct <= 0 || floorPct > 100)
    ) {
      toast.error('Piso percentual inválido (0–100)')
      return
    }
    if (floorAbsCents == null && floorPct == null) {
      toast.error('Defina pelo menos um piso (absoluto ou percentual)')
      return
    }
    if (!reason.trim()) {
      toast.error('Motivo é obrigatório')
      return
    }

    startTransition(async () => {
      const res = await createBuyerOverride({
        product_id: productId,
        clinic_id: buyerKind === 'clinic' ? buyerId : null,
        doctor_id: buyerKind === 'doctor' ? buyerId : null,
        platform_min_unit_cents: floorAbsCents,
        platform_min_unit_pct: floorPct,
        change_reason: reason.trim(),
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success('Override criado')
      reset()
      setOpen(false)
      router.refresh()
    })
  }

  const buyerOptions = buyerKind === 'clinic' ? clinics : doctors

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : (setOpen(false), reset()))}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Plus className="mr-1 h-4 w-4" />
        Novo override
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Override de piso para buyer</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Tipo de destinatário</Label>
            <RadioGroup
              value={buyerKind}
              onValueChange={(v) => {
                setBuyerKind(v as 'clinic' | 'doctor')
                setBuyerId('')
              }}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="clinic" id="bk_clinic" />
                <Label htmlFor="bk_clinic" className="cursor-pointer">
                  Clínica
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="doctor" id="bk_doctor" />
                <Label htmlFor="bk_doctor" className="cursor-pointer">
                  Médico
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="buyer_id">{buyerKind === 'clinic' ? 'Clínica' : 'Médico'} *</Label>
            <Select value={buyerId} onValueChange={(v) => setBuyerId(v ?? '')}>
              <SelectTrigger id="buyer_id">
                <SelectValue
                  placeholder={`Selecione ${buyerKind === 'clinic' ? 'a clínica' : 'o médico'}`}
                />
              </SelectTrigger>
              <SelectContent>
                {buyerOptions.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ovr_abs">Piso absoluto (R$)</Label>
              <Input
                id="ovr_abs"
                type="text"
                placeholder="80,00"
                value={floorAbsBrl}
                onChange={(e) => setFloorAbsBrl(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ovr_pct">Piso percentual (%)</Label>
              <Input
                id="ovr_pct"
                type="text"
                placeholder="5"
                value={floorPctStr}
                onChange={(e) => setFloorPctStr(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Vale o MAIOR entre absoluto e percentual. Defina pelo menos um.
          </p>

          <div className="space-y-2">
            <Label htmlFor="ovr_reason">Motivo *</Label>
            <Textarea
              id="ovr_reason"
              rows={3}
              placeholder="Ex.: piso negociado em contrato 2026-Q2"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <div className="flex gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? 'Salvando...' : 'Criar override'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false)
                reset()
              }}
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
