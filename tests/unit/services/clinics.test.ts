import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeQueryBuilder } from '../../setup'
import * as adminModule from '@/lib/db/admin'
import * as rbacModule from '@/lib/rbac'
import * as auditModule from '@/lib/audit'
import * as validatorsModule from '@/lib/validators'
import { createClinic, updateClinic, updateClinicStatus } from '@/services/clinics'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/rbac', () => ({ requireRole: vi.fn() }))
vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  AuditAction: { CREATE: 'CREATE', UPDATE: 'UPDATE', STATUS_CHANGE: 'STATUS_CHANGE' },
  AuditEntity: { CLINIC: 'CLINIC' },
}))
vi.mock('@/lib/validators', () => ({
  clinicSchema: {
    safeParse: vi.fn().mockReturnValue({
      success: true,
      data: { trade_name: 'Clínica Teste', cnpj: '11222333000181', email: 'clinica@test.com' },
    }),
  },
}))

const actorMock = {
  id: 'admin-1',
  roles: ['SUPER_ADMIN'] as ['SUPER_ADMIN'],
  full_name: 'Admin',
  email: 'a@test.com',
  is_active: true,
  registration_status: 'APPROVED' as const,
  notification_preferences: {},
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(rbacModule.requireRole).mockResolvedValue(actorMock)
  vi.mocked(auditModule.createAuditLog).mockResolvedValue(undefined)
})

describe('createClinic', () => {
  it('returns clinic id on success', async () => {
    const qb = makeQueryBuilder({ id: 'clinic-abc' }, null)
    qb.single = vi.fn().mockResolvedValue({ data: { id: 'clinic-abc' }, error: null })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await createClinic({
      trade_name: 'Clínica',
      cnpj: '11222333000181',
      email: 'c@test.com',
    } as Parameters<typeof createClinic>[0])
    expect(result.id).toBe('clinic-abc')
    expect(result.error).toBeUndefined()
  })

  it('returns CNPJ error on duplicate', async () => {
    const qb = makeQueryBuilder(null, null)
    qb.single = vi.fn().mockResolvedValue({ data: null, error: { code: '23505', message: 'cnpj' } })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await createClinic({
      trade_name: 'X',
      cnpj: '11222333000181',
      email: 'c@test.com',
    } as Parameters<typeof createClinic>[0])
    expect(result.error).toBe('CNPJ já cadastrado')
  })

  it('returns error when not authorized', async () => {
    vi.mocked(rbacModule.requireRole).mockRejectedValue(new Error('FORBIDDEN'))

    const result = await createClinic({
      trade_name: 'X',
      cnpj: '00',
      email: 'x@test.com',
    } as Parameters<typeof createClinic>[0])
    expect(result.error).toBe('Sem permissão')
  })

  it('returns validation error when schema fails', async () => {
    vi.mocked(
      (validatorsModule as Record<string, unknown>).clinicSchema as {
        safeParse: ReturnType<typeof vi.fn>
      }
    ).safeParse.mockReturnValueOnce({
      success: false,
      error: { issues: [{ message: 'CNPJ inválido' }] },
    })

    const result = await createClinic({
      trade_name: 'X',
      cnpj: 'bad',
      email: 'x@test.com',
    } as Parameters<typeof createClinic>[0])
    expect(result.error).toBe('CNPJ inválido')
  })

  it('returns generic error on unexpected DB failure', async () => {
    const qb = makeQueryBuilder(null, null)
    qb.single = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: '99999', message: 'other error' } })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await createClinic({
      trade_name: 'X',
      cnpj: '11222333000181',
      email: 'c@test.com',
    } as Parameters<typeof createClinic>[0])
    expect(result.error).toBe('Erro ao criar clínica')
  })
})

describe('updateClinic', () => {
  it('updates clinic data successfully', async () => {
    const qb = makeQueryBuilder({ id: 'clinic-1', trade_name: 'Old' }, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updateClinic('clinic-1', { trade_name: 'New' })
    expect(result.error).toBeUndefined()
  })

  it('returns error when db update fails', async () => {
    const qb = makeQueryBuilder(null, null)
    qb.update = vi
      .fn()
      .mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: { message: 'fail' } }) })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updateClinic('clinic-1', { trade_name: 'New' })
    expect(result.error).toBe('Erro ao atualizar clínica')
  })
})

describe('updateClinicStatus', () => {
  it('updates status successfully', async () => {
    const qb = makeQueryBuilder({ status: 'PENDING' }, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updateClinicStatus('clinic-1', 'ACTIVE')
    expect(result.error).toBeUndefined()
  })

  it('returns error when db update fails', async () => {
    const qb = makeQueryBuilder({ status: 'PENDING' }, null)
    qb.update = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: { message: 'DB error' } }),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updateClinicStatus('clinic-1', 'ACTIVE')
    expect(result.error).toBe('Erro ao atualizar status')
  })
})
