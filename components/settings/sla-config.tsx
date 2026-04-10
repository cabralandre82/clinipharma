'use client'

import { useState, useEffect, useTransition } from 'react'
import { Save, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'

const CONFIGURABLE_STATUSES = [
  { status: 'AWAITING_DOCUMENTS', label: 'Aguardando Documentos', phase: 'Financeiro' },
  { status: 'AWAITING_PAYMENT', label: 'Aguardando Pagamento', phase: 'Financeiro' },
  { status: 'PAYMENT_UNDER_REVIEW', label: 'Pagamento em Análise', phase: 'Financeiro' },
  { status: 'READY_FOR_REVIEW', label: 'Em Revisão', phase: 'Financeiro' },
  { status: 'TRANSFER_PENDING', label: 'Repasse Pendente', phase: 'Financeiro' },
  { status: 'READY', label: 'Pedido Aprovado', phase: 'Operacional' },
  { status: 'RELEASED_FOR_EXECUTION', label: 'Liberado para Execução', phase: 'Operacional' },
  { status: 'RECEIVED_BY_PHARMACY', label: 'Recebido pela Farmácia', phase: 'Operacional' },
  { status: 'IN_EXECUTION', label: 'Em Manipulação', phase: 'Operacional' },
  { status: 'SHIPPED', label: 'Enviado', phase: 'Operacional' },
]

interface SlaRow {
  id?: string
  order_status: string
  pharmacy_id: string | null
  warning_days: number
  alert_days: number
  critical_days: number
}

interface SlaConfigProps {
  pharmacyId?: string
  pharmacyName?: string
}

export function SlaConfig({ pharmacyId, pharmacyName }: SlaConfigProps) {
  const [configs, setConfigs] = useState<SlaRow[]>([])
  const [expanded, setExpanded] = useState(false)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    const url = pharmacyId ? `/api/settings/sla?pharmacyId=${pharmacyId}` : '/api/settings/sla'
    fetch(url)
      .then((r) => r.json())
      .then((data: SlaRow[]) => {
        // Merge with defaults for any missing statuses
        const merged = CONFIGURABLE_STATUSES.map((s) => {
          const existing = data.find((d) => d.order_status === s.status)
          return (
            existing ?? {
              order_status: s.status,
              pharmacy_id: pharmacyId ?? null,
              warning_days: 2,
              alert_days: 3,
              critical_days: 5,
            }
          )
        })
        setConfigs(merged)
      })
      .catch(() => {})
  }, [pharmacyId])

  function updateConfig(status: string, field: keyof SlaRow, value: number) {
    setConfigs((prev) =>
      prev.map((c) => (c.order_status === status ? { ...c, [field]: value } : c))
    )
  }

  function save() {
    startTransition(async () => {
      const res = await fetch('/api/settings/sla', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configs: configs.map((c) => ({ ...c, pharmacy_id: pharmacyId ?? null })),
        }),
      })
      if (!res.ok) {
        toast.error('Erro ao salvar configurações SLA')
        return
      }
      toast.success('Configurações SLA salvas!')
    })
  }

  const phases = [...new Set(CONFIGURABLE_STATUSES.map((s) => s.phase))]

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
        onClick={() => setExpanded((e) => !e)}
      >
        <div>
          <span>SLA de Pedidos</span>
          {pharmacyName && <span className="ml-2 text-xs text-gray-400">— {pharmacyName}</span>}
        </div>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {expanded && (
        <div className="space-y-6 border-t p-4">
          <p className="text-xs text-gray-500">
            Configure quantos dias sem movimentação definem cada nível de alerta.
            <strong className="text-amber-600"> Aviso</strong> = ação recomendada,
            <strong className="text-orange-600"> Alerta</strong> = urgente,
            <strong className="text-red-600"> Crítico</strong> = bloqueante.
          </p>

          {phases.map((phase) => (
            <div key={phase}>
              <h3 className="mb-3 text-xs font-semibold tracking-wide text-gray-500 uppercase">
                {phase}
              </h3>
              <div className="space-y-2">
                <div className="mb-1 grid grid-cols-4 gap-2 px-1 text-xs font-medium text-gray-400">
                  <span>Status</span>
                  <span className="text-center text-amber-600">Aviso (dias)</span>
                  <span className="text-center text-orange-600">Alerta (dias)</span>
                  <span className="text-center text-red-600">Crítico (dias)</span>
                </div>
                {CONFIGURABLE_STATUSES.filter((s) => s.phase === phase).map((s) => {
                  const cfg = configs.find((c) => c.order_status === s.status)
                  if (!cfg) return null
                  return (
                    <div
                      key={s.status}
                      className="grid grid-cols-4 items-center gap-2 rounded-lg bg-gray-50 px-3 py-2"
                    >
                      <span className="text-xs font-medium text-gray-700">{s.label}</span>
                      {(['warning_days', 'alert_days', 'critical_days'] as const).map((field) => (
                        <Input
                          key={field}
                          type="number"
                          min={1}
                          max={30}
                          value={cfg[field]}
                          onChange={(e) => updateConfig(s.status, field, Number(e.target.value))}
                          className="h-7 text-center text-xs"
                        />
                      ))}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          <div className="flex justify-end">
            <Button size="sm" onClick={save} disabled={isPending} className="gap-1.5">
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Salvar SLA
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
