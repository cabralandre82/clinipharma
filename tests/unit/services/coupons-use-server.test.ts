// @vitest-environment node
/**
 * TC-COUP-SRV-01
 * Garante que services/coupons.ts não viola a restrição do App Router:
 * em arquivos 'use server', apenas async functions podem ser exportadas
 * em runtime (tipos e interfaces são apagados pelo compilador TypeScript).
 *
 * Esse teste protege contra regressão do bug corrigido em v5.3.2, onde
 * `createCouponSchema` (objeto Zod) era exportado, causando falha silenciosa
 * do módulo e quebrando a página /coupons e o sidebar.
 */

import { describe, it, expect, vi } from 'vitest'

// Mock de todas as dependências server-side para permitir importar o módulo real
vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/db/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/auth/session', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/rbac', () => ({ requireRole: vi.fn() }))
vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn(),
  AuditAction: { CREATE: 'CREATE', UPDATE: 'UPDATE' },
  AuditEntity: { COUPON: 'COUPON', ORDER: 'ORDER' },
}))
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))

describe('TC-COUP-SRV-01 — services/coupons: conformidade com use server', () => {
  it('todos os exports runtime devem ser AsyncFunction (não objetos, não sync functions)', async () => {
    const couponsModule = await import('@/services/coupons')

    const runtimeExports = Object.entries(couponsModule).filter(
      ([, value]) => typeof value !== 'undefined'
    )

    expect(runtimeExports.length).toBeGreaterThan(0)

    for (const [name, value] of runtimeExports) {
      const isAsyncFn = typeof value === 'function' && value.constructor.name === 'AsyncFunction'

      expect(
        isAsyncFn,
        `Export "${name}" deve ser uma async function num arquivo 'use server'. ` +
          `Tipo atual: ${typeof value === 'function' ? value.constructor.name : typeof value}`
      ).toBe(true)
    }
  })

  it('o módulo exporta as 6 funções esperadas', async () => {
    const couponsModule = await import('@/services/coupons')
    const exportNames = Object.keys(couponsModule)

    expect(exportNames).toContain('createCoupon')
    expect(exportNames).toContain('deactivateCoupon')
    expect(exportNames).toContain('activateCoupon')
    expect(exportNames).toContain('getClinicCoupons')
    expect(exportNames).toContain('getAdminCoupons')
    expect(exportNames).toContain('getActiveCouponsForOrder')
  })

  it('não exporta objetos Zod, constantes ou valores não-função', async () => {
    const couponsModule = await import('@/services/coupons')

    for (const [name, value] of Object.entries(couponsModule)) {
      const isFn = typeof value === 'function'
      expect(
        isFn,
        `Export "${name}" é do tipo "${typeof value}" — apenas funções são permitidas em 'use server'`
      ).toBe(true)
    }
  })
})
