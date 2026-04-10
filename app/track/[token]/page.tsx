import { Metadata } from 'next'
import { CheckCircle2, Clock, Circle, XCircle, Package, Truck } from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export const metadata: Metadata = {
  title: 'Rastrear Pedido | Clinipharma',
  robots: 'noindex, nofollow',
}

interface TimelineStep {
  status: string
  label: string
  completed: boolean
  current: boolean
  future: boolean
}

interface TrackingData {
  code: string
  status: string
  statusLabel: string
  createdAt: string
  updatedAt: string
  estimatedDelivery: string | null
  isDelivered: boolean
  isCancelled: boolean
  itemCount: number
  timeline: TimelineStep[]
}

async function getTracking(token: string): Promise<TrackingData | null> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  try {
    const res = await fetch(`${baseUrl}/api/tracking?token=${token}`, { cache: 'no-store' })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export default async function PublicTrackingPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const data = await getTracking(token)

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <div className="text-center">
          <XCircle className="mx-auto mb-4 h-12 w-12 text-red-400" />
          <h1 className="mb-2 text-xl font-semibold text-gray-900">Link inválido ou expirado</h1>
          <p className="text-sm text-gray-500">
            Este link de rastreamento não existe ou já expirou.
          </p>
        </div>
      </div>
    )
  }

  const visibleSteps = data.timeline.filter(
    (s) => !['DRAFT', 'COMMISSION_CALCULATED', 'TRANSFER_PENDING'].includes(s.status)
  )

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-gray-50 px-4 py-12">
      <div className="mx-auto max-w-lg">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex items-center gap-2">
            <Package className="h-6 w-6 text-blue-600" />
            <span className="text-lg font-semibold text-gray-900">Clinipharma</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Rastreamento de Pedido</h1>
          <p className="mt-1 text-sm text-gray-500">
            Código: <strong className="text-gray-700">{data.code}</strong>
          </p>
        </div>

        {/* Status card */}
        <div
          className={`mb-6 rounded-2xl p-6 text-white shadow-lg ${
            data.isDelivered ? 'bg-green-600' : data.isCancelled ? 'bg-red-500' : 'bg-blue-600'
          }`}
        >
          <div className="mb-2 flex items-center gap-3">
            {data.isDelivered ? (
              <CheckCircle2 className="h-7 w-7" />
            ) : data.isCancelled ? (
              <XCircle className="h-7 w-7" />
            ) : (
              <Truck className="h-7 w-7" />
            )}
            <div>
              <p className="text-xs font-medium tracking-wide uppercase opacity-80">Status atual</p>
              <p className="text-xl font-bold">{data.statusLabel}</p>
            </div>
          </div>
          <div className="mt-4 flex justify-between border-t border-white/20 pt-4 text-xs opacity-90">
            <div>
              <p className="font-medium opacity-70">Criado em</p>
              <p>{format(new Date(data.createdAt), "d 'de' MMMM 'de' yyyy", { locale: ptBR })}</p>
            </div>
            {data.estimatedDelivery && !data.isCancelled && (
              <div className="text-right">
                <p className="font-medium opacity-70">Previsão de entrega</p>
                <p>{format(new Date(data.estimatedDelivery), "d 'de' MMMM", { locale: ptBR })}</p>
              </div>
            )}
          </div>
        </div>

        {/* Timeline */}
        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <h2 className="mb-5 text-sm font-semibold text-gray-700">Progresso do pedido</h2>
          <div className="relative">
            {visibleSteps.map((step, idx) => {
              const isLast = idx === visibleSteps.length - 1
              return (
                <div key={step.status} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 ${
                        step.completed
                          ? 'border-green-500 bg-green-500'
                          : step.current
                            ? 'border-blue-500 bg-blue-500'
                            : 'border-gray-200 bg-white'
                      }`}
                    >
                      {step.completed ? (
                        <CheckCircle2 className="h-4 w-4 fill-white text-white" />
                      ) : step.current ? (
                        <Clock className="h-4 w-4 text-white" />
                      ) : (
                        <Circle className="h-3 w-3 text-gray-300" />
                      )}
                    </div>
                    {!isLast && (
                      <div
                        className={`my-1 min-h-[20px] w-0.5 flex-1 ${
                          step.completed ? 'bg-green-300' : 'bg-gray-200'
                        }`}
                      />
                    )}
                  </div>
                  <div className={`pb-5 ${isLast ? '' : ''}`}>
                    <p
                      className={`mt-1 text-sm font-medium ${
                        step.current
                          ? 'text-blue-700'
                          : step.completed
                            ? 'text-green-700'
                            : 'text-gray-400'
                      }`}
                    >
                      {step.label}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          Última atualização:{' '}
          {format(new Date(data.updatedAt), "d/MM/yyyy 'às' HH:mm", { locale: ptBR })}
        </p>
      </div>
    </div>
  )
}
