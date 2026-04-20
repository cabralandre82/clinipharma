/**
 * Shared test helper for routes wrapped by `withCronGuard` (Wave 2).
 *
 * The guard adds two new dependencies on top of whatever the route itself
 * needs:
 *
 *   1. `admin.rpc('cron_try_lock' | 'cron_release_lock', …)`
 *   2. `admin.from('cron_runs').insert(…).select('id').single()` and
 *      `admin.from('cron_runs').update(…).eq('id', …)`
 *
 * This helper augments any existing `from` implementation so that callers
 * keep their domain-specific stubs (e.g. `from('orders')…`) and only need
 * to pre-pend the cron_runs branch here. It also provides a default
 * `rpc` stub that always grants the lock.
 *
 * Usage:
 *
 *   const adminStub = attachCronGuard({
 *     from: (table) => {
 *       if (table === 'orders') return buildOrdersChain()
 *       return {}
 *     },
 *   })
 *   vi.mocked(createAdminClient).mockReturnValue(adminStub as any)
 */

import { vi, type Mock } from 'vitest'

type FromFn = (table: string) => unknown

export interface GuardStubOptions {
  from: FromFn
  lockGranted?: boolean
  cronRunId?: number
  /**
   * Extra RPC handlers, keyed by RPC name. If provided, they take precedence
   * over the cron-lock defaults. Each handler receives the `args` object the
   * caller passed to `admin.rpc()` and must return the Supabase result
   * envelope (`{ data, error }`).
   */
  rpcHandlers?: Record<string, (args: unknown) => Promise<{ data: unknown; error: unknown }>>
  /**
   * Optional override for `from('cron_runs').delete().lt(...).select(...)`.
   * Consumed by `purge-server-logs`, which now deletes stale `cron_runs`
   * rows as part of RP-14 enforcement. Defaulting to `{ data: [], error: null }`
   * keeps all existing tests that don't invoke delete on cron_runs green.
   */
  cronRunsDelete?: { data?: Array<{ id: number }> | null; error?: { message: string } | null }
}

export interface GuardStubHandle {
  admin: { from: FromFn; rpc: Mock }
  rpc: Mock
  cronRunsInsert: Mock
  cronRunsUpdateEq: Mock
}

export function attachCronGuard(opts: GuardStubOptions): GuardStubHandle {
  const lockGranted = opts.lockGranted ?? true
  const cronRunId = opts.cronRunId ?? 1

  const cronRunsInsert = vi.fn()
  const cronRunsUpdateEq = vi.fn().mockResolvedValue({ error: null })

  const extra = opts.rpcHandlers ?? {}
  const rpc = vi.fn().mockImplementation((name: string, args?: unknown) => {
    if (extra[name]) return extra[name](args)
    if (name === 'cron_try_lock') {
      return Promise.resolve({ data: lockGranted, error: null })
    }
    if (name === 'cron_release_lock' || name === 'cron_extend_lock') {
      return Promise.resolve({ data: true, error: null })
    }
    return Promise.resolve({ data: null, error: { message: `unexpected rpc: ${name}` } })
  })

  const deleteResult = {
    data: opts.cronRunsDelete?.data ?? [],
    error: opts.cronRunsDelete?.error ?? null,
  }

  const cronRunsFrom = () => ({
    insert: (row: unknown) => {
      cronRunsInsert(row)
      return {
        select: () => ({
          single: () => Promise.resolve({ data: { id: cronRunId }, error: null }),
        }),
      }
    },
    update: (row: unknown) => ({
      eq: (col: string, val: unknown) => {
        cronRunsUpdateEq(row, col, val)
        return Promise.resolve({ error: null })
      },
    }),
    delete: () => ({
      lt: () => ({
        select: () => Promise.resolve(deleteResult),
      }),
    }),
  })

  const from: FromFn = (table) => {
    if (table === 'cron_runs') return cronRunsFrom()
    return opts.from(table)
  }

  return {
    admin: { from, rpc },
    rpc,
    cronRunsInsert,
    cronRunsUpdateEq,
  }
}

/**
 * Default shape used by `vi.mock('@/lib/logger', …)` for tests that
 * exercise cron routes. Contains every export the guard touches.
 */
export function loggerMock() {
  const calls: Array<[string, unknown]> = []
  const log = (level: string) =>
    vi.fn((msg: string, ctx: unknown) => {
      calls.push([`${level}:${msg}`, ctx])
    })

  return {
    logger: {
      debug: log('debug'),
      info: log('info'),
      warn: log('warn'),
      error: log('error'),
    },
    withCronContext: <Args extends unknown[], R>(_name: string, fn: (...a: Args) => R) => fn,
    withWebhookContext: <Args extends unknown[], R>(_name: string, fn: (...a: Args) => R) => fn,
    _calls: calls,
  }
}
