import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeQueryBuilder } from '../../setup'
import * as adminModule from '@/lib/db/admin'
import * as rbacModule from '@/lib/rbac'
import * as auditModule from '@/lib/audit'
import {
  createConsultant,
  updateConsultantStatus,
  assignConsultantToClinic,
  registerConsultantTransfer,
} from '@/services/consultants'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/rbac', () => ({ requireRole: vi.fn() }))
vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  AuditAction: { CREATE: 'CREATE', UPDATE: 'UPDATE', TRANSFER_REGISTERED: 'TRANSFER_REGISTERED' },
  AuditEntity: { PROFILE: 'PROFILE', CLINIC: 'CLINIC', TRANSFER: 'TRANSFER' },
}))
vi.mock('@/lib/validators', () => ({
  salesConsultantSchema: {
    safeParse: vi.fn().mockReturnValue({
      success: true,
      data: { full_name: 'Consultor', email: 'c@test.com', cnpj: '11222333000181' },
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

describe('createConsultant', () => {
  it('creates consultant and returns id', async () => {
    const qb = makeQueryBuilder({ id: 'cons-1' }, null)
    qb.single = vi.fn().mockResolvedValue({ data: { id: 'cons-1' }, error: null })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await createConsultant({
      full_name: 'C',
      email: 'c@test.com',
      cnpj: '11222333000181',
    } as Parameters<typeof createConsultant>[0])
    expect(result.id).toBe('cons-1')
  })

  it('returns CNPJ error on cnpj duplicate', async () => {
    const qb = makeQueryBuilder(null, null)
    qb.single = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: '23505', message: 'cnpj dup' } })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await createConsultant({
      full_name: 'C',
      email: 'c@test.com',
      cnpj: '11222333000181',
    } as Parameters<typeof createConsultant>[0])
    expect(result.error).toBe('CNPJ já cadastrado')
  })

  it('returns email error on email duplicate', async () => {
    const qb = makeQueryBuilder(null, null)
    qb.single = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: '23505', message: 'email dup' } })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await createConsultant({
      full_name: 'C',
      email: 'c@test.com',
      cnpj: '11222333000181',
    } as Parameters<typeof createConsultant>[0])
    expect(result.error).toBe('Email já cadastrado')
  })

  it('returns Sem permissão when FORBIDDEN', async () => {
    vi.mocked(rbacModule.requireRole).mockRejectedValue(new Error('FORBIDDEN'))
    const result = await createConsultant({
      full_name: 'C',
      email: 'c@test.com',
      cnpj: '11222333000181',
    } as Parameters<typeof createConsultant>[0])
    expect(result.error).toBe('Sem permissão')
  })
})

describe('updateConsultantStatus', () => {
  it('updates to INACTIVE successfully', async () => {
    const qb = makeQueryBuilder(null, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updateConsultantStatus('cons-1', 'INACTIVE')
    expect(result.error).toBeUndefined()
  })

  it('returns error when db fails', async () => {
    const qb = makeQueryBuilder(null, null)
    qb.update = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: { message: 'fail' } }),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updateConsultantStatus('cons-1', 'ACTIVE')
    expect(result.error).toBe('Erro ao atualizar status')
  })
})

describe('assignConsultantToClinic', () => {
  it('assigns consultant successfully', async () => {
    const qb = makeQueryBuilder(null, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await assignConsultantToClinic('clinic-1', 'cons-1')
    expect(result.error).toBeUndefined()
  })

  it('allows unassigning (null consultantId)', async () => {
    const qb = makeQueryBuilder(null, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await assignConsultantToClinic('clinic-1', null)
    expect(result.error).toBeUndefined()
  })
})

describe('updateConsultant', () => {
  it('updates consultant data successfully', async () => {
    const qb = makeQueryBuilder({ id: 'cons-1', full_name: 'Old' }, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const { updateConsultant } = await import('@/services/consultants')
    const result = await updateConsultant('cons-1', { full_name: 'New' })
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

    const { updateConsultant } = await import('@/services/consultants')
    const result = await updateConsultant('cons-1', { full_name: 'New' })
    expect(result.error).toBe('Erro ao atualizar consultor')
  })
})

describe('linkConsultantUser', () => {
  it('links user to consultant profile', async () => {
    const qb = makeQueryBuilder(null, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const { linkConsultantUser } = await import('@/services/consultants')
    const result = await linkConsultantUser('cons-1', 'user-1')
    expect(result.error).toBeUndefined()
  })

  it('returns error when update fails', async () => {
    const qb = makeQueryBuilder(null, null)
    qb.update = vi
      .fn()
      .mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: { message: 'fail' } }) })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const { linkConsultantUser } = await import('@/services/consultants')
    const result = await linkConsultantUser('cons-1', 'user-1')
    expect(result.error).toBe('Erro ao vincular usuário')
  })
})

describe('registerConsultantTransfer', () => {
  it('returns error for empty commissionIds', async () => {
    const result = await registerConsultantTransfer('cons-1', [], 'REF-001')
    expect(result.error).toBe('Nenhuma comissão selecionada')
  })

  it('returns error when no commissions found or already paid', async () => {
    const qb = makeQueryBuilder(null, null)
    qb.in = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
      }),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await registerConsultantTransfer('cons-1', ['comm-1'], 'REF-001')
    expect(result.error).toBe('Comissões não encontradas ou já pagas')
  })

  it('returns error when empty array returned', async () => {
    const qb = makeQueryBuilder([], null)
    qb.in = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await registerConsultantTransfer('cons-1', ['comm-1'], 'REF-001')
    expect(result.error).toBe('Comissões não encontradas ou já pagas')
  })
})
