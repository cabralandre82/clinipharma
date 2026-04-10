'use client'

import { useState, useTransition } from 'react'
import {
  FileSignature,
  CheckCircle2,
  Clock,
  XCircle,
  Send,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'

interface Contract {
  id: string
  type: string
  status: string
  signed_at?: string | null
  expires_at?: string | null
  document_url?: string | null
  created_at: string
}

interface ContractStatusProps {
  entityType: 'CLINIC' | 'DOCTOR' | 'PHARMACY' | 'CONSULTANT'
  entityId: string
  contracts: Contract[]
  isAdmin?: boolean
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  PENDING: { label: 'Pendente', color: 'bg-gray-100 text-gray-700', icon: Clock },
  SENT: { label: 'Enviado', color: 'bg-blue-100 text-blue-700', icon: Send },
  VIEWED: { label: 'Visualizado', color: 'bg-yellow-100 text-yellow-700', icon: Clock },
  SIGNED: { label: 'Assinado', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  CANCELLED: { label: 'Cancelado', color: 'bg-red-100 text-red-700', icon: XCircle },
  EXPIRED: { label: 'Expirado', color: 'bg-orange-100 text-orange-700', icon: AlertCircle },
}

export function ContractStatus({ entityType, entityId, contracts, isAdmin }: ContractStatusProps) {
  const [list, setList] = useState<Contract[]>(contracts)
  const [isPending, startTransition] = useTransition()

  const latestContract = list[0] ?? null

  function sendContract() {
    startTransition(async () => {
      const res = await fetch('/api/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityType, entityId }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error('Erro ao enviar contrato: ' + (json.error ?? 'Tente novamente'))
        return
      }
      toast.success('Contrato enviado para assinatura via Clicksign!')
      // Reload contracts
      const listRes = await fetch(`/api/contracts?entityId=${entityId}`)
      const newList = await listRes.json()
      setList(newList)
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileSignature className="h-4 w-4 text-gray-500" />
          <span className="text-sm font-medium">Contrato digital</span>
        </div>
        {isAdmin && (
          <Button
            size="sm"
            variant="outline"
            disabled={
              isPending || latestContract?.status === 'SENT' || latestContract?.status === 'VIEWED'
            }
            onClick={sendContract}
            className="gap-1.5 text-xs"
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {latestContract ? 'Reenviar contrato' : 'Enviar contrato'}
          </Button>
        )}
      </div>

      {latestContract ? (
        <div className="space-y-2 rounded-lg border p-3">
          {(() => {
            const cfg = STATUS_CONFIG[latestContract.status] ?? STATUS_CONFIG.PENDING
            const Icon = cfg.icon
            return (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  <Badge className={`text-xs font-normal ${cfg.color}`}>{cfg.label}</Badge>
                </div>
                {latestContract.signed_at && (
                  <span className="text-xs text-gray-500">
                    Assinado em {new Date(latestContract.signed_at).toLocaleDateString('pt-BR')}
                  </span>
                )}
              </div>
            )
          })()}

          {latestContract.status === 'SENT' && (
            <p className="text-xs text-gray-500">
              Aguardando assinatura. Contrato enviado por email ao usuário via Clicksign.
            </p>
          )}

          {latestContract.document_url && latestContract.status === 'SIGNED' && (
            <a
              href={latestContract.document_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline"
            >
              Baixar contrato assinado →
            </a>
          )}

          {latestContract.expires_at && latestContract.status !== 'SIGNED' && (
            <p className="text-xs text-gray-400">
              Expira em: {new Date(latestContract.expires_at).toLocaleDateString('pt-BR')}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-gray-400">Nenhum contrato enviado ainda.</p>
      )}
    </div>
  )
}
