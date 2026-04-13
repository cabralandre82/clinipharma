import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeQueryBuilder } from '../../setup'
import * as adminModule from '@/lib/db/admin'
import * as rbacModule from '@/lib/rbac'
import * as auditModule from '@/lib/audit'
import {
  createDoctor,
  updateDoctor,
  updateDoctorStatus,
  linkDoctorToClinic,
} from '@/services/doctors'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/rbac', () => ({ requireRole: vi.fn() }))
vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  AuditAction: { CREATE: 'CREATE', UPDATE: 'UPDATE', STATUS_CHANGE: 'STATUS_CHANGE' },
  AuditEntity: { DOCTOR: 'DOCTOR' },
}))
vi.mock('@/lib/validators', () => ({
  doctorSchema: {
    safeParse: vi.fn().mockReturnValue({
      success: true,
      data: { full_name: 'Dr. Teste', crm: '12345', crm_uf: 'SP', specialty: 'Geral' },
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

const clinicAdminMock = {
  id: 'clinic-user-1',
  roles: ['CLINIC_ADMIN'] as ['CLINIC_ADMIN'],
  full_name: 'Admin Clínica',
  email: 'admin@clinica.com',
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

describe('createDoctor', () => {
  it('creates doctor and returns id', async () => {
    const qb = makeQueryBuilder({ id: 'doc-1' }, null)
    qb.single = vi.fn().mockResolvedValue({ data: { id: 'doc-1' }, error: null })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await createDoctor({
      full_name: 'Dr. Teste',
      crm: '12345',
      crm_uf: 'SP',
    } as Parameters<typeof createDoctor>[0])
    expect(result.id).toBe('doc-1')
    expect(result.error).toBeUndefined()
  })

  it('returns CRM duplicate error', async () => {
    const qb = makeQueryBuilder(null, null)
    qb.single = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: '23505', message: 'crm dup' } })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await createDoctor({
      full_name: 'Dr.',
      crm: '12345',
      crm_uf: 'SP',
    } as Parameters<typeof createDoctor>[0])
    expect(result.error).toBe('CRM já cadastrado para este estado')
  })

  it('returns generic error on other DB failure', async () => {
    const qb = makeQueryBuilder(null, null)
    qb.single = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: '99999', message: 'other' } })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await createDoctor({
      full_name: 'Dr.',
      crm: '12345',
      crm_uf: 'SP',
    } as Parameters<typeof createDoctor>[0])
    expect(result.error).toBe('Erro ao criar médico')
  })

  it('returns Sem permissão when FORBIDDEN', async () => {
    vi.mocked(rbacModule.requireRole).mockRejectedValue(new Error('FORBIDDEN'))
    const result = await createDoctor({
      full_name: 'Dr.',
      crm: '12345',
      crm_uf: 'SP',
    } as Parameters<typeof createDoctor>[0])
    expect(result.error).toBe('Sem permissão')
  })

  it('CLINIC_ADMIN creates doctor and auto-links to their clinic', async () => {
    vi.mocked(rbacModule.requireRole).mockResolvedValue(clinicAdminMock)

    const doctorQb = makeQueryBuilder({ id: 'doc-2' }, null)
    doctorQb.single = vi.fn().mockResolvedValue({ data: { id: 'doc-2' }, error: null })

    const membershipQb = makeQueryBuilder(null, null)
    membershipQb.maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { clinic_id: 'clinic-1' }, error: null })

    const upsertQb = makeQueryBuilder(null, null)

    let callCount = 0
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) return doctorQb // insert doctor
        if (callCount === 2) return membershipQb // fetch clinic_id from clinic_members
        return upsertQb // upsert doctor_clinic_links
      }),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await createDoctor({
      full_name: 'Dr. Novo',
      crm: '99999',
      crm_uf: 'SP',
    } as Parameters<typeof createDoctor>[0])
    expect(result.id).toBe('doc-2')
    expect(result.error).toBeUndefined()
    expect(callCount).toBe(3) // insert + fetch membership + upsert link
  })

  it('CLINIC_ADMIN with no clinic membership still creates doctor (no link)', async () => {
    vi.mocked(rbacModule.requireRole).mockResolvedValue(clinicAdminMock)

    const doctorQb = makeQueryBuilder({ id: 'doc-3' }, null)
    doctorQb.single = vi.fn().mockResolvedValue({ data: { id: 'doc-3' }, error: null })

    const membershipQb = makeQueryBuilder(null, null)
    membershipQb.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })

    let callCount = 0
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) return doctorQb
        return membershipQb
      }),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await createDoctor({
      full_name: 'Dr. Sem Clinica',
      crm: '77777',
      crm_uf: 'RJ',
    } as Parameters<typeof createDoctor>[0])
    expect(result.id).toBe('doc-3')
    expect(result.error).toBeUndefined()
  })

  it('returns validation error when schema fails', async () => {
    const validators = await import('@/lib/validators')
    vi.mocked(
      (validators as Record<string, unknown>).doctorSchema as {
        safeParse: ReturnType<typeof vi.fn>
      }
    ).safeParse.mockReturnValueOnce({
      success: false,
      error: { issues: [{ message: 'CRM inválido' }] },
    })

    const result = await createDoctor({ full_name: 'Dr.', crm: 'bad', crm_uf: 'SP' } as Parameters<
      typeof createDoctor
    >[0])
    expect(result.error).toBe('CRM inválido')
  })
})

describe('updateDoctor', () => {
  it('updates doctor successfully', async () => {
    const qb = makeQueryBuilder({ id: 'doc-1', full_name: 'Dr. Old' }, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updateDoctor('doc-1', { full_name: 'Dr. New' })
    expect(result.error).toBeUndefined()
  })

  it('returns error when DB update fails', async () => {
    const qb = makeQueryBuilder(null, null)
    qb.update = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: { message: 'fail' } }),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updateDoctor('doc-1', { full_name: 'Dr. New' })
    expect(result.error).toBe('Erro ao atualizar médico')
  })
})

describe('updateDoctorStatus', () => {
  it('updates status successfully', async () => {
    const qb = makeQueryBuilder(null, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updateDoctorStatus('doc-1', 'ACTIVE')
    expect(result.error).toBeUndefined()
  })
})

describe('linkDoctorToClinic', () => {
  it('links doctor to clinic successfully', async () => {
    const qb = makeQueryBuilder(null, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await linkDoctorToClinic('doc-1', 'clinic-1', true)
    expect(result.error).toBeUndefined()
  })

  it('returns error when upsert fails', async () => {
    const qb = makeQueryBuilder(null, null)
    qb.upsert = vi.fn().mockResolvedValue({ error: { message: 'fail' } })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await linkDoctorToClinic('doc-1', 'clinic-1')
    expect(result.error).toBe('Erro ao vincular médico à clínica')
  })
})
