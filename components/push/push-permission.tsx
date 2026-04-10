'use client'

import { useEffect, useState, useTransition } from 'react'
import { Bell, BellOff, BellRing } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { requestPushPermission, onForegroundMessage } from '@/lib/firebase/client'
import { toast } from 'sonner'

type PermissionState = 'unknown' | 'granted' | 'denied' | 'default'

export function PushPermissionButton() {
  const [permState, setPermState] = useState<PermissionState>('unknown')
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPermState(Notification.permission as PermissionState)
    }

    // Listen for foreground messages and show a toast
    const unsub = onForegroundMessage((payload) => {
      toast(payload.title ?? 'Notificação', {
        description: payload.body,
        action: payload.link
          ? { label: 'Ver', onClick: () => (window.location.href = payload.link!) }
          : undefined,
      })
    })
    return unsub
  }, [])

  if (permState === 'unknown') return null
  if (permState === 'denied') {
    return (
      <div className="flex items-center gap-1.5 rounded-md bg-yellow-50 px-3 py-1.5 text-xs text-yellow-700">
        <BellOff className="h-3.5 w-3.5" />
        Notificações bloqueadas pelo navegador
      </div>
    )
  }
  if (permState === 'granted') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-green-600">
        <BellRing className="h-3.5 w-3.5" />
        Push ativo
      </div>
    )
  }

  // default — ask
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5 text-xs"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const token = await requestPushPermission()
          if (token) {
            await fetch('/api/push/subscribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token }),
            })
            setPermState('granted')
            toast.success('Notificações push ativadas!')
          } else {
            setPermState(Notification.permission as PermissionState)
          }
        })
      }}
    >
      <Bell className="h-3.5 w-3.5" />
      Ativar notificações push
    </Button>
  )
}
