/**
 * Server Logs UI — diagnóstico operacional rápido.
 *
 * Mudança 2026-05-01: o painel mostrava 90 dias de warns/errors sem
 * separação entre "está acontecendo agora" e "resíduo já corrigido".
 * Operador olhava `[reorder] RPC not available` de 18 horas atrás e
 * pensava que a plataforma estava quebrada — quando o fix já tinha
 * sido deployado horas antes.
 *
 * Agora:
 *   1. Janela temporal padrão de 24h (configurável: 1h, 6h, 24h, 7d, all).
 *   2. Banner verde/amarelo/vermelho NO TOPO consolidando o estado da
 *      janela atual: "0 ativos", "3 warns", "1 error + 5 warns".
 *   3. Coluna "Quando" com idade relativa ("12min", "3h", "ontem 14:30").
 *   4. Linhas mais antigas que 1h ganham opacidade reduzida + badge
 *      "histórico" — visual claro de "isso é coisa velha, não pânico".
 */
import { requirePermissionPage, Permissions } from '@/lib/rbac/permissions'
import { createAdminClient } from '@/lib/db/admin'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import Link from 'next/link'
import { CheckCircle2, AlertTriangle, OctagonX, Clock } from 'lucide-react'

export const dynamic = 'force-dynamic'

type Since = '1h' | '6h' | '24h' | '7d' | 'all'

const SINCE_OPTIONS: { value: Since; label: string; hours: number | null }[] = [
  { value: '1h', label: 'Última hora', hours: 1 },
  { value: '6h', label: 'Últimas 6h', hours: 6 },
  { value: '24h', label: 'Últimas 24h', hours: 24 },
  { value: '7d', label: 'Últimos 7 dias', hours: 24 * 7 },
  { value: 'all', label: '90 dias (tudo)', hours: null },
]

function parseSince(raw: string | undefined): Since {
  return (SINCE_OPTIONS.find((o) => o.value === raw)?.value ?? '24h') as Since
}

function isoSinceFor(since: Since): string | null {
  const opt = SINCE_OPTIONS.find((o) => o.value === since)
  if (!opt || opt.hours == null) return null
  return new Date(Date.now() - opt.hours * 60 * 60 * 1000).toISOString()
}

// "Ativo" = ocorreu há menos de 1 hora. Linhas mais antigas viram
// histórico residual com visual mais sóbrio para que o operador
// distingua o que está vivo agora vs o que está pendurado na
// retenção de 90d.
const ACTIVE_THRESHOLD_MS = 60 * 60 * 1000

export default async function ServerLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ level?: string; q?: string; since?: string }>
}) {
  await requirePermissionPage(Permissions.SERVER_LOGS_READ)

  const { level, q, since: sinceRaw } = await searchParams
  const since = parseSince(sinceRaw)
  const sinceIso = isoSinceFor(since)
  const admin = createAdminClient()

  // --- 1) Logs visíveis (tabela) — respeita filtros do form -----------
  let query = admin
    .from('server_logs')
    .select('id, level, message, route, request_id, context, created_at')
    .order('created_at', { ascending: false })
    .limit(200)

  if (level === 'error' || level === 'warn') {
    query = query.eq('level', level)
  }
  if (q) {
    query = query.ilike('message', `%${q}%`)
  }
  if (sinceIso) {
    query = query.gte('created_at', sinceIso)
  }

  const { data: logs } = await query
  const safeLogs = logs ?? []

  // --- 2) Métricas independentes do filtro: estado da janela ----------
  // Conta por nível DENTRO da janela (sem ilike q nem level filter) e
  // dentro da janela "ativo" (1h) — para o banner consolidar saúde.
  // Duas requests pequenas, head-only, count=exact: O(2 ms) cada.
  const windowStart = sinceIso // null = sem filtro = 90d
  const activeStart = new Date(Date.now() - ACTIVE_THRESHOLD_MS).toISOString()

  const [windowErrCount, windowWarnCount, activeErrCount, activeWarnCount] = await Promise.all([
    countLogs(admin, 'error', windowStart),
    countLogs(admin, 'warn', windowStart),
    countLogs(admin, 'error', activeStart),
    countLogs(admin, 'warn', activeStart),
  ])

  return (
    <div className="space-y-5 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Logs do Servidor</h1>
        <p className="mt-1 text-sm text-slate-500">
          Erros e avisos persistidos — retenção de 90 dias · 200 mais recentes
        </p>
      </div>

      {/* Banner de saúde — estado da janela atual */}
      <HealthBanner
        windowLabel={SINCE_OPTIONS.find((o) => o.value === since)?.label ?? since}
        windowErr={windowErrCount}
        windowWarn={windowWarnCount}
        activeErr={activeErrCount}
        activeWarn={activeWarnCount}
      />

      {/* Filters — método=GET, server-side */}
      <form className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="filter-since" className="mb-1 block text-xs font-medium text-slate-600">
            Período
          </label>
          <select
            id="filter-since"
            name="since"
            defaultValue={since}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            {SINCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="filter-level" className="mb-1 block text-xs font-medium text-slate-600">
            Nível
          </label>
          <select
            id="filter-level"
            name="level"
            defaultValue={level ?? ''}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            <option value="">Todos os níveis</option>
            <option value="error">error</option>
            <option value="warn">warn</option>
          </select>
        </div>
        <div className="min-w-[12rem] flex-1">
          <label htmlFor="filter-q" className="mb-1 block text-xs font-medium text-slate-600">
            Buscar
          </label>
          <input
            id="filter-q"
            name="q"
            defaultValue={q}
            placeholder="Texto na mensagem ou rota..."
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Filtrar
        </button>
        {(level || q || since !== '24h') && (
          <Link
            href="/server-logs"
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Limpar
          </Link>
        )}
      </form>

      {/* Count + legend */}
      <div className="flex items-center justify-between text-sm text-slate-500">
        <p>
          Mostrando <strong>{safeLogs.length}</strong> entrada(s) na janela selecionada
          {(level || q) && ' (com filtro aplicado)'}
        </p>
        <p className="flex items-center gap-1.5 text-xs">
          <Clock className="h-3.5 w-3.5" />
          Linhas com mais de 1h são marcadas como <strong>histórico</strong>
        </p>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">Nível</th>
              <th className="px-4 py-3 font-medium">Quando</th>
              <th className="px-4 py-3 font-medium">Mensagem</th>
              <th className="px-4 py-3 font-medium">Rota</th>
              <th className="px-4 py-3 font-medium">Contexto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!safeLogs.length && <EmptyRow />}
            {safeLogs.map((log) => {
              const ageMs = Date.now() - new Date(log.created_at).getTime()
              const isActive = ageMs <= ACTIVE_THRESHOLD_MS
              return (
                <tr
                  key={log.id}
                  className={`hover:bg-slate-50 ${isActive ? '' : 'bg-slate-50/40 opacity-70'}`}
                >
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                        log.level === 'error'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {log.level}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <div className="flex flex-col">
                        <span
                          className={`text-xs font-medium ${
                            isActive ? 'text-slate-700' : 'text-slate-500'
                          }`}
                        >
                          há {formatDistanceToNowStrict(new Date(log.created_at), { locale: ptBR })}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {format(new Date(log.created_at), 'dd/MM/yy HH:mm:ss', { locale: ptBR })}
                        </span>
                      </div>
                      {!isActive && (
                        <span
                          className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
                          title="Ocorreu há mais de 1 hora — pode já estar mitigado"
                        >
                          histórico
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="max-w-sm px-4 py-3">
                    <span className="font-mono text-xs break-all text-slate-700">
                      {log.message}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{log.route ?? '—'}</td>
                  <td className="px-4 py-3">
                    {log.context ? (
                      <details className="cursor-pointer">
                        <summary className="text-xs text-blue-600 hover:underline">ver</summary>
                        <pre className="mt-1 max-h-32 max-w-xs overflow-auto rounded bg-slate-100 p-2 text-xs">
                          {JSON.stringify(log.context, null, 2)}
                        </pre>
                      </details>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────

async function countLogs(
  admin: ReturnType<typeof createAdminClient>,
  level: 'error' | 'warn',
  sinceIso: string | null
): Promise<number> {
  let q = admin.from('server_logs').select('id', { count: 'exact', head: true }).eq('level', level)
  if (sinceIso) q = q.gte('created_at', sinceIso)
  const { count, error } = await q
  if (error) return 0
  return count ?? 0
}

interface BannerProps {
  windowLabel: string
  windowErr: number
  windowWarn: number
  activeErr: number
  activeWarn: number
}

/**
 * Card de status no topo. Verde quando a janela inteira está limpa,
 * vermelho se há erros (ativos ou no período), amarelo só com warns.
 * O destaque é "ativos (última hora)" — esse é o número que importa
 * para decidir se está acontecendo algo agora.
 */
function HealthBanner({ windowLabel, windowErr, windowWarn, activeErr, activeWarn }: BannerProps) {
  if (windowErr === 0 && windowWarn === 0) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-600" />
        <div>
          <p className="font-semibold text-emerald-900">Tudo limpo</p>
          <p className="text-sm text-emerald-700">
            Nenhum warn ou error em <strong>{windowLabel.toLowerCase()}</strong>.
          </p>
        </div>
      </div>
    )
  }

  const hasActiveErrors = activeErr > 0
  const hasActiveWarns = activeWarn > 0
  const tone = hasActiveErrors
    ? 'red'
    : hasActiveWarns
      ? 'amber'
      : windowErr > 0
        ? 'amber'
        : 'slate'

  const styles =
    tone === 'red'
      ? {
          box: 'border-red-200 bg-red-50',
          icon: 'text-red-600',
          title: 'text-red-900',
          body: 'text-red-700',
        }
      : tone === 'amber'
        ? {
            box: 'border-amber-200 bg-amber-50',
            icon: 'text-amber-600',
            title: 'text-amber-900',
            body: 'text-amber-700',
          }
        : {
            box: 'border-slate-200 bg-slate-50',
            icon: 'text-slate-500',
            title: 'text-slate-800',
            body: 'text-slate-600',
          }

  const Icon = tone === 'red' ? OctagonX : AlertTriangle
  const headline =
    hasActiveErrors || hasActiveWarns ? 'Atividade na última hora' : 'Apenas histórico residual'

  return (
    <div className={`flex items-start gap-3 rounded-xl border p-4 ${styles.box}`}>
      <Icon className={`mt-0.5 h-5 w-5 flex-shrink-0 ${styles.icon}`} />
      <div className="flex-1">
        <p className={`font-semibold ${styles.title}`}>{headline}</p>
        <div className={`mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm ${styles.body}`}>
          <Stat label="Ativos (última hora)" highlight>
            <span className={hasActiveErrors ? 'font-bold text-red-700' : ''}>
              {activeErr} error{activeErr === 1 ? '' : 's'}
            </span>
            {' · '}
            <span className={hasActiveWarns ? 'font-bold text-amber-700' : ''}>
              {activeWarn} warn{activeWarn === 1 ? '' : 's'}
            </span>
          </Stat>
          <Stat label={`Total na janela (${windowLabel.toLowerCase()})`}>
            {windowErr} error{windowErr === 1 ? '' : 's'} · {windowWarn} warn
            {windowWarn === 1 ? '' : 's'}
          </Stat>
        </div>
        {!hasActiveErrors && !hasActiveWarns && (windowErr > 0 || windowWarn > 0) && (
          <p className={`mt-2 text-xs ${styles.body}`}>
            Os logs da tabela são de mais de 1 hora atrás — provavelmente já foram corrigidos.
            Verifique se algum cron de alerta ainda está disparando.
          </p>
        )}
      </div>
    </div>
  )
}

function Stat({
  label,
  children,
  highlight = false,
}: {
  label: string
  children: React.ReactNode
  highlight?: boolean
}) {
  return (
    <span className="inline-flex flex-col">
      <span className="text-[10px] tracking-wide uppercase opacity-80">{label}</span>
      <span className={highlight ? 'font-medium' : 'opacity-90'}>{children}</span>
    </span>
  )
}

function EmptyRow() {
  return (
    <tr>
      <td colSpan={5} className="px-4 py-12 text-center">
        <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-300" />
        <p className="text-sm text-slate-400">
          Nenhum log na janela selecionada — sistema saudável.
        </p>
      </td>
    </tr>
  )
}
