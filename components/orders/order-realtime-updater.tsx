'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/db/client'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'

const STATUS_LABELS: Record<string, string> = {
  AWAITING_DOCUMENTS: 'Aguardando Documentação',
  READY_FOR_REVIEW: 'Pronto para Revisão',
  AWAITING_PAYMENT: 'Aguardando Pagamento',
  PAYMENT_UNDER_REVIEW: 'Pagamento em Análise',
  PAYMENT_CONFIRMED: 'Pagamento Confirmado',
  COMMISSION_CALCULATED: 'Comissão Calculada',
  TRANSFER_PENDING: 'Repasse Pendente',
  TRANSFER_COMPLETED: 'Repasse Concluído',
  RELEASED_FOR_EXECUTION: 'Liberado para Execução',
  RECEIVED_BY_PHARMACY: 'Recebido pela Farmácia',
  IN_EXECUTION: 'Em Manipulação',
  READY: 'Pronto para Envio',
  SHIPPED: 'Despachado',
  DELIVERED: 'Entregue',
  COMPLETED: 'Concluído',
  CANCELED: 'Cancelado',
  WITH_ISSUE: 'Com Problema',
}

/** Fallback polling interval — keeps the page current when WebSockets fail. */
const POLL_MS = 20_000

interface Props {
  orderId: string
  /** Called when the Realtime connection state changes. */
  onConnectionChange?: (connected: boolean) => void
}

/**
 * Invisible component that keeps the order detail page in sync via two layers:
 *
 * 1. **Supabase Realtime** (primary) — instant WebSocket updates with a toast
 *    on status change. Requires migration 034 + Realtime enabled on Supabase.
 *
 * 2. **Polling fallback** (secondary) — silent router.refresh() every 20 s so
 *    the page stays current when WebSockets are blocked or Realtime auth fails.
 */
export function OrderRealtimeUpdater({ orderId, onConnectionChange }: Props) {
  const router = useRouter()
  const [, setConnected] = useState(false)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const clientRef = useRef<SupabaseClient | null>(null)

  const setLive = useCallback(
    (ok: boolean) => {
      setConnected(ok)
      onConnectionChange?.(ok)
    },
    [onConnectionChange]
  )

  // ── Polling fallback ──────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => router.refresh(), POLL_MS)
    return () => clearInterval(id)
  }, [router])

  // ── Realtime primary ──────────────────────────────────────────────────────
  useEffect(() => {
    const supabase = createClient()
    clientRef.current = supabase

    // getSession() ensures the JWT is loaded into the client before subscribing,
    // preventing the channel from connecting as unauthenticated (anon).
    supabase.auth.getSession().then(({ data }) => {
      // Bail out if the effect was already cleaned up
      if (clientRef.current !== supabase) return

      if (!data.session) {
        // Not authenticated — polling fallback will keep the page current.
        return
      }

      const channel = supabase
        .channel(`order-detail:${orderId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
          () => router.refresh()
        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'order_status_history',
            filter: `order_id=eq.${orderId}`,
          },
          (payload) => {
            const newStatus = (payload.new as Record<string, string>)?.new_status
            if (newStatus) {
              toast.info(`Pedido atualizado: ${STATUS_LABELS[newStatus] ?? newStatus}`, {
                description: 'O status foi alterado agora mesmo.',
                duration: 5000,
              })
            }
            router.refresh()
          }
        )
        .subscribe((status) => {
          if (clientRef.current !== supabase) return
          if (status === 'SUBSCRIBED') setLive(true)
          else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) setLive(false)
        })

      channelRef.current = channel
    })

    return () => {
      // Mark this client instance as stale so any pending getSession callback
      // knows to bail out.
      clientRef.current = null
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
      setLive(false)
    }
  }, [orderId, router, setLive])

  return null
}

/** Small badge shown in the order detail header when realtime is connected. */
export function LiveBadge({ connected }: { connected: boolean }) {
  if (!connected) return null
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
      </span>
      Ao vivo
    </span>
  )
}
