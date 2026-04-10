'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCcw, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

interface ReorderButtonProps {
  orderId?: string
  templateId?: string
  label?: string
  size?: 'sm' | 'default'
  variant?: 'outline' | 'default' | 'ghost'
}

export function ReorderButton({
  orderId,
  templateId,
  label = 'Repetir pedido',
  size = 'sm',
  variant = 'outline',
}: ReorderButtonProps) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function reorder() {
    startTransition(async () => {
      const res = await fetch('/api/orders/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, templateId }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? 'Erro ao repetir pedido')
        return
      }
      toast.success(`Pedido ${json.code} criado! Revise e confirme.`)
      router.push(`/orders/${json.orderId}`)
    })
  }

  return (
    <Button
      size={size}
      variant={variant}
      disabled={isPending}
      onClick={reorder}
      className="gap-1.5"
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <RefreshCcw className="h-3.5 w-3.5" />
      )}
      {label}
    </Button>
  )
}
