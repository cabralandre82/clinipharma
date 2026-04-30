/**
 * /admin/pricing/health — pricing engine operational dashboard.
 *
 * Read-only dashboard for super-admin / platform-admin to spot
 * pricing-engine health issues in seconds:
 *
 *   1. Configuration drift (DB facts):
 *      - TIERED products without an active pricing profile.
 *      - Last `pricing-health-check` cron run + outcome.
 *
 *   2. Activity on this warm instance (snapshot in-memory):
 *      - /api/pricing/preview outcomes counter (success vs error
 *        reasons).
 *      - Top products hitting INV-2 (coupon clamp) and INV-4
 *        (consultant clamp).
 *      - Latency p50/p95/p99 of /api/pricing/preview.
 *
 * Why two sources?
 *   - DB facts are global + persistent (single source of truth for
 *     "what's misconfigured").
 *   - Snapshot is per-instance ephemeral memory: useful as a
 *     sanity-check from inside the running app (a smoke signal that
 *     instrumentation is wired and counters are firing). For
 *     historical aggregation across instances, point operators at
 *     Grafana — there is a banner saying so.
 *
 * RBAC: SUPER_ADMIN + PLATFORM_ADMIN. No write actions on this page,
 * but the data exposed here describes commercial config (which
 * products are TIERED, recent buyer activity volume) and stays
 * platform-internal.
 */

import Link from 'next/link'
import { requireRolePage } from '@/lib/rbac'
import { createAdminClient } from '@/lib/db/admin'
import { snapshotMetrics, Metrics } from '@/lib/metrics'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, CheckCircle2, Clock, Activity } from 'lucide-react'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Saúde do pricing engine | Clinipharma' }

const HEALTH_CHECK_JOB = 'pricing-health-check'
const TOP_N = 10

interface TieredProduct {
  id: string
  slug: string
  name: string
  active: boolean
}

interface ProfileRow {
  product_id: string
}

interface CronRunRow {
  status: string | null
  started_at: string | null
  finished_at: string | null
  duration_ms: number | null
  result: unknown
  error: string | null
}

export default async function PricingHealthPage() {
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  const admin = createAdminClient()

  // 1. DB facts: TIERED products + active profiles ────────────────
  const [{ data: tieredRaw }, { data: cronRunsRaw }] = await Promise.all([
    admin
      .from('products')
      .select('id, slug, name, active')
      .eq('pricing_mode', 'TIERED_PROFILE')
      .eq('active', true)
      .order('name'),
    admin
      .from('cron_runs')
      .select('status, started_at, finished_at, duration_ms, result, error')
      .eq('job_name', HEALTH_CHECK_JOB)
      .order('started_at', { ascending: false })
      .limit(1),
  ])

  const tieredProducts = (tieredRaw ?? []) as TieredProduct[]

  let activeProfileIds = new Set<string>()
  if (tieredProducts.length > 0) {
    const { data: profilesRaw } = await admin
      .from('pricing_profiles')
      .select('product_id')
      .in(
        'product_id',
        tieredProducts.map((p) => p.id)
      )
      .is('effective_until', null)
    activeProfileIds = new Set(((profilesRaw ?? []) as ProfileRow[]).map((r) => r.product_id))
  }

  const orphanProducts = tieredProducts.filter((p) => !activeProfileIds.has(p.id))
  const lastCronRun = (cronRunsRaw?.[0] ?? null) as CronRunRow | null

  // 2. Snapshot — in-memory metrics on this warm instance ─────────
  const snapshot = snapshotMetrics()

  type HistogramEntry = (typeof snapshot.histograms)[number]

  const previewByOutcome = new Map<string, number>()
  for (const c of snapshot.counters) {
    if (c.name !== Metrics.PRICING_PREVIEW_TOTAL) continue
    const outcome = String(c.labels.outcome ?? 'unknown')
    previewByOutcome.set(outcome, (previewByOutcome.get(outcome) ?? 0) + c.value)
  }
  const previewTotal = Array.from(previewByOutcome.values()).reduce((a, b) => a + b, 0)
  const previewSuccess = previewByOutcome.get('success') ?? 0
  const previewSuccessPct = previewTotal === 0 ? null : (previewSuccess / previewTotal) * 100

  const inv2ByProduct = collectByProductId(snapshot.counters, Metrics.PRICING_INV2_CAP_TOTAL)
  const inv4ByProduct = collectByProductId(snapshot.counters, Metrics.PRICING_INV4_CAP_TOTAL)
  const profileMissingByProduct = collectByProductId(
    snapshot.counters,
    Metrics.PRICING_PROFILE_MISSING_TOTAL
  )

  const allTouchedProductIds = new Set([
    ...inv2ByProduct.keys(),
    ...inv4ByProduct.keys(),
    ...profileMissingByProduct.keys(),
  ])
  const productNamesById = new Map<string, string>()
  if (allTouchedProductIds.size > 0) {
    const { data: namesRaw } = await admin
      .from('products')
      .select('id, name, slug')
      .in('id', Array.from(allTouchedProductIds))
    for (const r of (namesRaw ?? []) as Array<{ id: string; name: string; slug: string }>) {
      productNamesById.set(r.id, `${r.name} (${r.slug})`)
    }
  }

  const previewLatency: HistogramEntry | undefined = snapshot.histograms.find(
    (h) => h.name === Metrics.PRICING_PREVIEW_DURATION_MS
  )

  // ── Render ────────────────────────────────────────────────────────
  const hasOrphans = orphanProducts.length > 0
  const cronOk = lastCronRun?.status === 'success'

  return (
    <div className="space-y-6 p-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Link href="/dashboard" className="hover:text-primary">
            Dashboard
          </Link>
          <span>/</span>
          <span>Saúde do pricing</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Saúde do motor de preços</h1>
        <p className="mt-1 text-sm text-slate-600">
          Sinais de configuração e atividade do pricing engine. Para histórico distribuído
          (multi-instância, janela longa), consulte Grafana.
        </p>
      </div>

      {/* ── Section 1: configuration health (DB facts) ───────────── */}
      <section className="space-y-4 rounded-lg border bg-white p-6">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-gray-900">Configuração</h2>
          <Badge variant="outline">Persistente</Badge>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <StatCard
            label="Produtos TIERED ativos"
            value={String(tieredProducts.length)}
            tone="neutral"
          />
          <StatCard
            label="Sem profile ativo"
            value={String(orphanProducts.length)}
            tone={hasOrphans ? 'danger' : 'success'}
          />
          <StatCard
            label="Último health-check"
            value={lastCronRun?.started_at ? relativeTime(lastCronRun.started_at) : 'Nunca'}
            tone={lastCronRun ? (cronOk ? 'success' : 'danger') : 'neutral'}
            sub={
              lastCronRun?.duration_ms
                ? `${(lastCronRun.duration_ms / 1000).toFixed(1)}s · ${lastCronRun.status}`
                : undefined
            }
          />
        </div>

        {hasOrphans ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
              <div className="space-y-2">
                <p className="text-sm font-medium text-red-900">
                  {orphanProducts.length} produto(s) configurados como TIERED sem profile ativo
                </p>
                <p className="text-xs text-red-700">
                  Buyers que abrirem o catálogo desses produtos verão &ldquo;Sem precificação ativa
                  no momento&rdquo;. Publique um profile com tiers em cada um, ou volte para FIXED.
                </p>
                <ul className="space-y-1 pt-1">
                  {orphanProducts.map((p) => (
                    <li key={p.id} className="text-sm">
                      <Link
                        href={`/products/${p.id}/pricing`}
                        className="text-red-700 underline hover:text-red-900"
                      >
                        {p.name} <span className="text-red-500">({p.slug})</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ) : tieredProducts.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nenhum produto está em modo TIERED hoje. Quando o primeiro for publicado, ele aparece
            aqui automaticamente.
          </p>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <CheckCircle2 className="h-4 w-4" />
            Todos os produtos TIERED têm profile ativo.
          </div>
        )}

        {lastCronRun?.error && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <span className="font-medium">Último cron com erro:</span> {lastCronRun.error}
          </div>
        )}
      </section>

      {/* ── Section 2: live activity (snapshot in-memory) ─────────── */}
      <section className="space-y-4 rounded-lg border bg-white p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-gray-900">Atividade desta instância</h2>
            <Badge variant="outline">In-memory</Badge>
          </div>
          <span className="flex items-center gap-1 text-xs text-slate-500">
            <Activity className="h-3.5 w-3.5" />
            warm Lambda · zera a cada cold-start
          </span>
        </div>

        <p className="text-xs text-slate-500">
          Estes contadores existem só no processo Node desta instância. Para tendência ao longo do
          tempo agregada entre instâncias, use Grafana / Prometheus (
          <code className="rounded bg-slate-100 px-1">pricing_*</code>).
        </p>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <StatCard
            label="/api/pricing/preview total"
            value={String(previewTotal)}
            tone="neutral"
          />
          <StatCard
            label="Taxa de sucesso"
            value={previewSuccessPct === null ? '—' : `${previewSuccessPct.toFixed(1)}%`}
            tone={
              previewSuccessPct === null
                ? 'neutral'
                : previewSuccessPct >= 95
                  ? 'success'
                  : previewSuccessPct >= 80
                    ? 'warning'
                    : 'danger'
            }
          />
          <StatCard
            label="Latência p95"
            value={previewLatency ? `${Math.round(previewLatency.p95)} ms` : '—'}
            tone={
              previewLatency
                ? previewLatency.p95 < 250
                  ? 'success'
                  : previewLatency.p95 < 1000
                    ? 'warning'
                    : 'danger'
                : 'neutral'
            }
            sub={
              previewLatency
                ? `p50 ${Math.round(previewLatency.p50)} · p99 ${Math.round(previewLatency.p99)}`
                : undefined
            }
          />
        </div>

        {/* Outcome breakdown */}
        <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
          <p className="mb-2 text-xs font-medium text-slate-700">Outcomes do preview</p>
          {previewByOutcome.size === 0 ? (
            <p className="text-xs text-slate-500">
              Sem chamadas a <code>/api/pricing/preview</code> nesta instância ainda.
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-1 text-sm md:grid-cols-2">
              {Array.from(previewByOutcome.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([outcome, value]) => (
                  <li key={outcome} className="flex justify-between">
                    <span className="text-slate-700">{outcomeLabel(outcome)}</span>
                    <span className="font-mono text-slate-900">{value}</span>
                  </li>
                ))}
            </ul>
          )}
        </div>

        {/* Per-product cap counts */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <ProductTable
            title="INV-2 (coupon cap)"
            description="Cupom desceria a plataforma abaixo do floor → clampado."
            entries={topN(inv2ByProduct, TOP_N)}
            productNamesById={productNamesById}
            tone="amber"
          />
          <ProductTable
            title="INV-4 (consultor cap)"
            description="Comissão do consultor excederia a receita unitária da plataforma."
            entries={topN(inv4ByProduct, TOP_N)}
            productNamesById={productNamesById}
            tone="amber"
          />
          <ProductTable
            title="Profile faltando"
            description="Produto TIERED foi consultado e não tinha profile ativo."
            entries={topN(profileMissingByProduct, TOP_N)}
            productNamesById={productNamesById}
            tone="red"
          />
        </div>
      </section>

      {/* ── Section 3: how to read this ──────────────────────────── */}
      <section className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
        <p className="flex items-center gap-1 font-medium text-slate-700">
          <Clock className="h-3.5 w-3.5" /> Como interpretar
        </p>
        <ul className="list-inside list-disc space-y-1">
          <li>
            <strong>Sem profile ativo &gt; 0:</strong> abre alerta automático em até 24h. Acima de
            zero por mais de um ciclo é um produto que precisa de profile.
          </li>
          <li>
            <strong>INV-2 cap recorrente em 1 produto:</strong> o cupom em vigor está pedindo
            desconto maior que a margem mínima — revisar o cupom ou o floor.
          </li>
          <li>
            <strong>INV-4 cap recorrente:</strong> comissão configurada no
            <code className="rounded bg-slate-200 px-1">pricing_profile</code> excede a margem por
            unidade — revisar `consultant_pct` / `consultant_basis`.
          </li>
          <li>
            <strong>Latência p95 &gt; 1s:</strong> verificar saúde do Postgres + cache em Server
            Component que está consultando o preview.
          </li>
        </ul>
      </section>
    </div>
  )
}

// ── helpers ─────────────────────────────────────────────────────────

type Tone = 'neutral' | 'success' | 'warning' | 'danger'

function StatCard({
  label,
  value,
  tone,
  sub,
}: {
  label: string
  value: string
  tone: Tone
  sub?: string
}) {
  const toneClass: Record<Tone, string> = {
    neutral: 'border-slate-200 bg-white',
    success: 'border-emerald-200 bg-emerald-50',
    warning: 'border-amber-200 bg-amber-50',
    danger: 'border-red-200 bg-red-50',
  }
  return (
    <div className={`rounded-md border p-4 ${toneClass[tone]}`}>
      <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  )
}

function ProductTable({
  title,
  description,
  entries,
  productNamesById,
  tone,
}: {
  title: string
  description: string
  entries: Array<[string, number]>
  productNamesById: Map<string, string>
  tone: 'amber' | 'red'
}) {
  const headerClass = tone === 'red' ? 'text-red-700' : 'text-amber-700'
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <p className={`text-xs font-medium ${headerClass}`}>{title}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">{description}</p>
      {entries.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">Nada disparou nesta instância.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {entries.map(([productId, count]) => (
            <li key={productId} className="flex justify-between gap-2">
              <Link
                href={`/products/${productId}/pricing`}
                className="truncate text-slate-700 hover:underline"
                title={productNamesById.get(productId) ?? productId}
              >
                {productNamesById.get(productId) ?? productId}
              </Link>
              <span className="font-mono text-slate-900">{count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface CounterLike {
  name: string
  labels: Record<string, string | number | boolean | null | undefined>
  value: number
}

function collectByProductId(
  counters: readonly CounterLike[],
  metricName: string
): Map<string, number> {
  const m = new Map<string, number>()
  for (const c of counters) {
    if (c.name !== metricName) continue
    const productId = c.labels.product_id
    if (typeof productId !== 'string') continue
    m.set(productId, (m.get(productId) ?? 0) + c.value)
  }
  return m
}

function topN(m: Map<string, number>, n: number): Array<[string, number]> {
  return Array.from(m.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
}

function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case 'success':
      return 'Sucesso'
    case 'no_active_profile':
      return 'Sem profile ativo'
    case 'no_tier_for_quantity':
      return 'Sem tier para a quantidade'
    case 'invalid_quantity':
      return 'Quantidade inválida'
    case 'rpc_unavailable':
      return 'RPC indisponível'
    case 'rate_limited':
      return 'Rate-limit (429)'
    case 'unauthorized':
      return 'Não autenticado (401)'
    case 'bad_request':
      return 'Parâmetros inválidos (400)'
    default:
      return outcome
  }
}

function relativeTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR })
  } catch {
    return iso
  }
}
