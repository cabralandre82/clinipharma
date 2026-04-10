import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeQueryBuilder } from '../../setup'
import * as adminModule from '@/lib/db/admin'
import * as rbacModule from '@/lib/rbac'
import * as auditModule from '@/lib/audit'
import { updateSetting } from '@/services/settings'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/rbac', () => ({ requireRole: vi.fn() }))
vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  AuditAction: { SETTING_CHANGED: 'SETTING_CHANGED' },
  AuditEntity: { APP_SETTING: 'APP_SETTING' },
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

describe('updateSetting', () => {
  it('updates a string setting successfully', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null })
    const qb = makeQueryBuilder({ key: 'test_key', value_json: 'old' }, null)
    qb.upsert = upsertMock
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updateSetting('test_key', 'new_value', 'admin-1')
    expect(result.error).toBeUndefined()
  })

  it('parses numeric JSON values correctly', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null })
    const qb = makeQueryBuilder(null, null)
    qb.upsert = upsertMock
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    await updateSetting('rate', '5.5', 'admin-1')
    expect(upsertMock).toHaveBeenCalledWith(expect.objectContaining({ value_json: 5.5 }))
  })

  it('parses boolean JSON values', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null })
    const qb = makeQueryBuilder(null, null)
    qb.upsert = upsertMock
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    await updateSetting('feature_flag', 'true', 'admin-1')
    expect(upsertMock).toHaveBeenCalledWith(expect.objectContaining({ value_json: true }))
  })

  it('keeps string value when not valid JSON', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null })
    const qb = makeQueryBuilder(null, null)
    qb.upsert = upsertMock
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    await updateSetting('name', 'Clinipharma', 'admin-1')
    expect(upsertMock).toHaveBeenCalledWith(expect.objectContaining({ value_json: 'Clinipharma' }))
  })

  it('returns error when FORBIDDEN', async () => {
    vi.mocked(rbacModule.requireRole).mockRejectedValue(new Error('FORBIDDEN'))
    const result = await updateSetting('key', 'val', 'user-1')
    expect(result.error).toBeTruthy()
  })

  it('audits the change', async () => {
    const qb = makeQueryBuilder({ key: 'k', value_json: 'old' }, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    await updateSetting('k', 'new', 'admin-1')
    expect(auditModule.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SETTING_CHANGED' })
    )
  })
})
