'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend,
} from 'recharts'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'

// ── Period Comparison ──────────────────────────────────────────────────────────
interface PeriodCompData {
  metric: string
  current: number
  previous: number
  unit: 'currency' | 'number'
}

function PctBadge({ current, previous }: { current: number; previous: number }) {
  if (!previous) return null
  const pct = ((current - previous) / previous) * 100
  const color = pct > 0 ? 'text-green-600' : pct < 0 ? 'text-red-500' : 'text-gray-500'
  const Icon = pct > 0 ? TrendingUp : pct < 0 ? TrendingDown : Minus
  return (
    <span className={`flex items-center gap-0.5 text-xs font-medium ${color}`}>
      <Icon className="h-3 w-3" />
      {Math.abs(pct).toFixed(1)}%
    </span>
  )
}

export function PeriodComparison({ data }: { data: PeriodCompData[] }) {
  return (
    <div className="rounded-xl border bg-white p-5">
      <h3 className="mb-4 text-sm font-semibold text-gray-900">Comparação de Períodos</h3>
      <div className="mb-5 grid grid-cols-2 gap-3">
        {data.map((d) => (
          <div key={d.metric} className="rounded-lg bg-gray-50 p-3">
            <p className="mb-1 text-xs text-gray-500">{d.metric}</p>
            <p className="text-lg font-bold text-gray-900">
              {d.unit === 'currency'
                ? formatCurrency(d.current)
                : d.current.toLocaleString('pt-BR')}
            </p>
            <div className="mt-1 flex items-center justify-between">
              <p className="text-xs text-gray-400">
                Anterior:{' '}
                {d.unit === 'currency'
                  ? formatCurrency(d.previous)
                  : d.previous.toLocaleString('pt-BR')}
              </p>
              <PctBadge current={d.current} previous={d.previous} />
            </div>
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} barSize={28}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
          <XAxis dataKey="metric" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={50} />
          <Tooltip
            formatter={(v) => {
              const num = typeof v === 'number' ? v : Number(v)
              return num.toLocaleString('pt-BR')
            }}
          />
          <Bar dataKey="current" name="Atual" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          <Bar dataKey="previous" name="Anterior" fill="#93c5fd" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Clinic Ranking ─────────────────────────────────────────────────────────────
interface ClinicRankRow {
  name: string
  orders: number
  revenue: number
}

export function ClinicRanking({ data }: { data: ClinicRankRow[] }) {
  const sorted = [...data].sort((a, b) => b.revenue - a.revenue).slice(0, 10)
  return (
    <div className="rounded-xl border bg-white p-5">
      <h3 className="mb-4 text-sm font-semibold text-gray-900">
        Ranking de Clínicas (por receita)
      </h3>
      {sorted.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">Sem dados no período</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((c, i) => {
            const maxRevenue = sorted[0].revenue
            const pct = maxRevenue > 0 ? (c.revenue / maxRevenue) * 100 : 0
            return (
              <div key={c.name} className="flex items-center gap-3">
                <span className="w-5 shrink-0 text-xs font-bold text-gray-400">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex items-center justify-between">
                    <span className="truncate text-xs font-medium text-gray-700">{c.name}</span>
                    <span className="ml-2 shrink-0 text-xs text-gray-500">{c.orders} pedidos</span>
                  </div>
                  <div className="relative h-2 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-blue-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <span className="w-20 shrink-0 text-right text-xs font-semibold text-gray-900">
                  {formatCurrency(c.revenue)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Conversion Funnel ──────────────────────────────────────────────────────────
interface FunnelStep {
  status: string
  label: string
  count: number
  pct: number
}

const FUNNEL_COLORS = ['#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899']

export function ConversionFunnel({ data }: { data: FunnelStep[] }) {
  const funnelData = data.map((d, i) => ({
    name: d.label,
    value: d.count,
    fill: FUNNEL_COLORS[i % FUNNEL_COLORS.length],
  }))

  return (
    <div className="rounded-xl border bg-white p-5">
      <h3 className="mb-4 text-sm font-semibold text-gray-900">Funil de Conversão</h3>
      {data.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">Sem dados no período</p>
      ) : (
        <>
          <div className="mb-4 space-y-1.5">
            {data.map((step, i) => (
              <div key={step.status} className="flex items-center gap-3">
                <div
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ background: FUNNEL_COLORS[i % FUNNEL_COLORS.length] }}
                />
                <span className="flex-1 truncate text-xs text-gray-600">{step.label}</span>
                <span className="w-8 text-right text-xs font-medium text-gray-900">
                  {step.count}
                </span>
                <span className="w-10 text-right text-xs text-gray-400">
                  {step.pct.toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart layout="vertical" data={funnelData} barSize={16}>
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {funnelData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  )
}

// ── Product Margin ─────────────────────────────────────────────────────────────
interface ProductMarginRow {
  name: string
  revenue: number
  pharmacyCost: number
  consultantCommission: number
  platformMargin: number
}

export function ProductMarginChart({ data }: { data: ProductMarginRow[] }) {
  const sorted = [...data].sort((a, b) => b.platformMargin - a.platformMargin).slice(0, 8)
  return (
    <div className="rounded-xl border bg-white p-5">
      <h3 className="mb-1 text-sm font-semibold text-gray-900">Margem Real por Produto</h3>
      <p className="mb-4 text-xs text-gray-500">Receita − custo farmácia − comissão consultor</p>
      {sorted.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">Sem dados no período</p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={sorted} layout="vertical" barSize={14}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
            <XAxis
              type="number"
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
            />
            <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 10 }} />
            <Tooltip formatter={(v) => formatCurrency(Number(v))} />
            <Legend iconType="square" wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="pharmacyCost" name="Custo Farmácia" stackId="a" fill="#fca5a5" />
            <Bar
              dataKey="consultantCommission"
              name="Comissão Consultor"
              stackId="a"
              fill="#fcd34d"
            />
            <Bar
              dataKey="platformMargin"
              name="Margem Plataforma"
              stackId="a"
              fill="#4ade80"
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
