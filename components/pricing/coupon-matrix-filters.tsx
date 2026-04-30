'use client'

/**
 * Filtros do super-admin para a coupon impact matrix.
 *
 * Estado vive na URL — todos os parâmetros são query-string. Isto é
 * intencional:
 *   1. Bookmarkable: o operador pode salvar/compartilhar uma combo
 *      "produto X, clínica Y, cupom 30% PCT".
 *   2. Server-rendered: a matriz é calculada server-side via RPC; a
 *      página é um Server Component que lê searchParams. Mudar
 *      filtros = navegar para nova URL = re-render server-side.
 *
 * Suporta múltiplos cupons hipotéticos via parametros repetidos
 * `hyp` no formato 'PERCENT:30' ou 'FIXED:200'. UI permite até 4
 * variantes hipotéticas para a matriz não estourar 8 colunas.
 */

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface BuyerOption {
  id: string
  label: string
}

interface ExistingCouponOption {
  id: string
  code: string
  buyer_label: string
  discount_label: string
}

interface Props {
  productId: string
  clinics: BuyerOption[]
  doctors: BuyerOption[]
  existingCoupons: ExistingCouponOption[]
}

interface HypotheticalDraft {
  uid: string
  type: 'PERCENT' | 'FIXED'
  value: string
}

let _hypUidCounter = 0
function hypUid(): string {
  _hypUidCounter += 1
  return `hyp-${_hypUidCounter}-${Date.now()}`
}

function parseHypsFromQuery(qs: URLSearchParams): HypotheticalDraft[] {
  const hyps = qs.getAll('hyp')
  return hyps
    .map((h) => {
      const [type, valueStr] = h.split(':')
      if (type !== 'PERCENT' && type !== 'FIXED') return null
      if (!valueStr) return null
      return {
        uid: hypUid(),
        type: type as 'PERCENT' | 'FIXED',
        value: valueStr,
      }
    })
    .filter((h): h is HypotheticalDraft => h !== null)
}

export function CouponMatrixFilters({ productId, clinics, doctors, existingCoupons }: Props) {
  const router = useRouter()
  const sp = useSearchParams()
  const [pending, startTransition] = useTransition()

  const [buyerKind, setBuyerKind] = useState<'clinic' | 'doctor' | 'none'>(
    (sp.get('buyer_kind') as 'clinic' | 'doctor') ?? 'none'
  )
  const [buyerId, setBuyerId] = useState<string>(sp.get('buyer_id') ?? '')
  const [maxQty, setMaxQty] = useState<string>(sp.get('max_qty') ?? '10')

  const initialHyps = parseHypsFromQuery(new URLSearchParams(sp.toString()))
  const [hyps, setHyps] = useState<HypotheticalDraft[]>(
    initialHyps.length > 0 ? initialHyps : [{ uid: hypUid(), type: 'PERCENT', value: '30' }]
  )

  const [selectedExistingIds, setSelectedExistingIds] = useState<string[]>(sp.getAll('coupon_id'))

  function applyFilters() {
    const params = new URLSearchParams()
    if (buyerKind !== 'none' && buyerId) {
      params.set('buyer_kind', buyerKind)
      params.set('buyer_id', buyerId)
    }
    params.set('max_qty', maxQty)
    for (const h of hyps) {
      const v = h.value.trim()
      if (!v) continue
      params.append('hyp', `${h.type}:${v.replace(',', '.')}`)
    }
    for (const id of selectedExistingIds) {
      params.append('coupon_id', id)
    }
    startTransition(() => {
      router.push(`/products/${productId}/pricing/coupon-matrix?${params.toString()}`)
    })
  }

  function addHyp() {
    if (hyps.length >= 4) return
    setHyps((prev) => [...prev, { uid: hypUid(), type: 'PERCENT', value: '' }])
  }

  function removeHyp(uid: string) {
    setHyps((prev) => prev.filter((h) => h.uid !== uid))
  }

  function patchHyp(uid: string, patch: Partial<HypotheticalDraft>) {
    setHyps((prev) => prev.map((h) => (h.uid === uid ? { ...h, ...patch } : h)))
  }

  function toggleExisting(id: string) {
    setSelectedExistingIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        applyFilters()
      }}
      className="space-y-4 rounded-lg border bg-white p-6"
    >
      <h3 className="text-sm font-semibold text-slate-800">Configurar simulação</h3>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Buyer (cliente)</Label>
          <RadioGroup
            value={buyerKind}
            onValueChange={(v) => {
              setBuyerKind(v as 'clinic' | 'doctor' | 'none')
              setBuyerId('')
            }}
            className="flex gap-4"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="none" id="bk_none" />
              <Label htmlFor="bk_none" className="cursor-pointer">
                Genérico (sem buyer)
              </Label>
            </div>
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
          {buyerKind !== 'none' && (
            <Select value={buyerId} onValueChange={(v) => setBuyerId(v ?? '')}>
              <SelectTrigger>
                <SelectValue
                  placeholder={`Selecione ${buyerKind === 'clinic' ? 'a clínica' : 'o médico'}`}
                />
              </SelectTrigger>
              <SelectContent>
                {(buyerKind === 'clinic' ? clinics : doctors).map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <p className="text-xs text-slate-500">
            Define overrides de piso e qual cupom existente é considerado &ldquo;vigente&rdquo; para
            esse buyer.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="max_qty">Quantidade máxima na matriz</Label>
          <Input
            id="max_qty"
            type="number"
            min="1"
            max="20"
            step="1"
            value={maxQty}
            onChange={(e) => setMaxQty(e.target.value)}
          />
          <p className="text-xs text-slate-500">Linhas: 1 → maxQty. Valores típicos: 5–10.</p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Cupons hipotéticos a comparar (até 4)</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addHyp}
            disabled={hyps.length >= 4}
          >
            <Plus className="mr-1 h-4 w-4" />
            Adicionar
          </Button>
        </div>
        {hyps.map((h) => (
          <div key={h.uid} className="flex items-center gap-2 rounded-md border p-2">
            <Select
              value={h.type}
              onValueChange={(v) =>
                patchHyp(h.uid, { type: (v as 'PERCENT' | 'FIXED') ?? 'PERCENT' })
              }
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PERCENT">Percentual</SelectItem>
                <SelectItem value="FIXED">Valor fixo</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="text"
              placeholder={h.type === 'PERCENT' ? '30' : '200,00'}
              value={h.value}
              onChange={(e) => patchHyp(h.uid, { value: e.target.value })}
              className="flex-1"
            />
            <span className="text-xs text-slate-500">
              {h.type === 'PERCENT' ? '%' : 'R$ /unid.'}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeHyp(h.uid)}
              aria-label="Remover"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      {existingCoupons.length > 0 && (
        <div className="space-y-2">
          <Label>Cupons existentes (apenas ativos para este produto)</Label>
          <div className="space-y-1 rounded-md border bg-slate-50 p-2">
            {existingCoupons.map((c) => (
              <label
                key={c.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-white"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={selectedExistingIds.includes(c.id)}
                  onChange={() => toggleExisting(c.id)}
                />
                <span className="text-sm font-medium text-slate-700">{c.code}</span>
                <span className="text-xs text-slate-500">
                  · {c.buyer_label} · {c.discount_label}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Atualizando...' : 'Atualizar matriz'}
        </Button>
      </div>
    </form>
  )
}
