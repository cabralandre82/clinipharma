'use client'

import { useEffect, useState } from 'react'
import { Monitor, Smartphone, Tablet, ShieldAlert, RefreshCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { format, formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'

interface AccessLog {
  id: string
  event: string
  ip: string | null
  user_agent: string | null
  is_new_device: boolean
  created_at: string
}

const EVENT_LABEL: Record<string, string> = {
  LOGIN: 'Login',
  LOGOUT: 'Logout',
  SESSION_START: 'Sessão iniciada',
  PASSWORD_RESET: 'Senha redefinida',
}

function DeviceIcon({ ua }: { ua: string | null }) {
  if (!ua) return <Monitor className="h-4 w-4 text-gray-400" />
  if (/Mobile|Android|iPhone/.test(ua)) return <Smartphone className="h-4 w-4 text-gray-400" />
  if (/Tablet|iPad/.test(ua)) return <Tablet className="h-4 w-4 text-gray-400" />
  return <Monitor className="h-4 w-4 text-gray-400" />
}

function parseBrowser(ua: string | null): string {
  if (!ua) return 'Desconhecido'
  if (ua.includes('Edg/')) return 'Microsoft Edge'
  if (ua.includes('Chrome/')) return 'Chrome'
  if (ua.includes('Firefox/')) return 'Firefox'
  if (ua.includes('Safari/') && !ua.includes('Chrome')) return 'Safari'
  return 'Navegador'
}

function parseOS(ua: string | null): string {
  if (!ua) return ''
  if (ua.includes('Windows')) return 'Windows'
  if (ua.includes('Mac OS X') && !ua.includes('iPhone') && !ua.includes('iPad')) return 'macOS'
  if (ua.includes('Android')) return 'Android'
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS'
  if (ua.includes('Linux')) return 'Linux'
  return ''
}

export function SessionHistory() {
  const [logs, setLogs] = useState<AccessLog[]>([])
  const [loading, setLoading] = useState(true)

  function load() {
    setLoading(true)
    fetch('/api/sessions?limit=20')
      .then((r) => r.json())
      .then((data) => {
        setLogs(Array.isArray(data) ? data : [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // Log this page view as a session
    fetch('/api/sessions', { method: 'POST' }).catch(() => {})
  }, [])

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Histórico de acesso</h2>
          <p className="mt-0.5 text-xs text-gray-500">Últimos 20 acessos · retenção de 90 dias</p>
        </div>
        <Button size="sm" variant="ghost" onClick={load} className="gap-1.5 text-gray-500">
          <RefreshCcw className="h-3.5 w-3.5" />
          Atualizar
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">Nenhum acesso registrado</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {logs.map((log) => {
            const browser = parseBrowser(log.user_agent)
            const os = parseOS(log.user_agent)
            const isRecent = Date.now() - new Date(log.created_at).getTime() < 1000 * 60 * 60 * 2
            return (
              <div
                key={log.id}
                className={`flex items-start gap-3 py-3 ${log.is_new_device ? '-mx-5 bg-amber-50 px-5' : ''}`}
              >
                <div className="mt-1 shrink-0">
                  <DeviceIcon ua={log.user_agent} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">
                      {browser}
                      {os ? ` · ${os}` : ''}
                    </span>
                    <Badge
                      className={`text-xs ${
                        log.event === 'PASSWORD_RESET'
                          ? 'bg-red-100 text-red-700'
                          : log.event === 'LOGOUT'
                            ? 'bg-gray-100 text-gray-600'
                            : 'bg-blue-50 text-blue-700'
                      }`}
                    >
                      {EVENT_LABEL[log.event] ?? log.event}
                    </Badge>
                    {log.is_new_device && (
                      <Badge className="gap-1 bg-amber-100 text-xs text-amber-700">
                        <ShieldAlert className="h-3 w-3" />
                        Novo dispositivo
                      </Badge>
                    )}
                    {isRecent && (
                      <Badge className="bg-green-50 text-xs text-green-700">Atual</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500">
                    IP: {log.ip ?? 'desconhecido'} ·{' '}
                    {formatDistanceToNow(new Date(log.created_at), {
                      addSuffix: true,
                      locale: ptBR,
                    })}{' '}
                    · {format(new Date(log.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR })}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
