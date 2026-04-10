import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as adminModule from '@/lib/db/admin'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))

// Explicitly unmock audit so we test the REAL implementation
vi.unmock('@/lib/audit')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createAuditLog — real implementation', () => {
  it('inserts an audit log with all required fields', async () => {
    const insertMock = vi.fn().mockReturnValue({
      then: (resolve: (v: unknown) => void) => resolve({ error: null }),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ insert: insertMock }),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const { createAuditLog, AuditEntity, AuditAction } = await import('@/lib/audit')

    await createAuditLog({
      actorUserId: 'user-1',
      actorRole: 'SUPER_ADMIN',
      entityType: AuditEntity.ORDER,
      entityId: 'ord-1',
      action: AuditAction.STATUS_CHANGE,
      oldValues: { status: 'PENDING' },
      newValues: { status: 'ACTIVE' },
    })

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_user_id: 'user-1',
        actor_role: 'SUPER_ADMIN',
        entity_type: 'ORDER',
        entity_id: 'ord-1',
        action: 'STATUS_CHANGE',
        old_values_json: { status: 'PENDING' },
        new_values_json: { status: 'ACTIVE' },
      })
    )
  })

  it('uses null for optional fields when not provided', async () => {
    const insertMock = vi.fn().mockReturnValue({
      then: (resolve: (v: unknown) => void) => resolve({ error: null }),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ insert: insertMock }),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const { createAuditLog, AuditEntity, AuditAction } = await import('@/lib/audit')

    await createAuditLog({
      entityType: AuditEntity.PRODUCT,
      entityId: 'prod-1',
      action: AuditAction.UPDATE,
    })

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_user_id: null,
        actor_role: null,
        old_values_json: null,
        new_values_json: null,
        ip: null,
        user_agent: null,
      })
    )
  })

  it('does not throw when DB insert fails (swallows error)', async () => {
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          then: (_resolve: unknown, reject: (e: Error) => void) =>
            reject ? reject(new Error('DB down')) : undefined,
        }),
      }),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const { createAuditLog, AuditEntity, AuditAction } = await import('@/lib/audit')

    // Should not throw
    await expect(
      createAuditLog({
        entityType: AuditEntity.CLINIC,
        entityId: 'clinic-1',
        action: AuditAction.CREATE,
      })
    ).resolves.toBeUndefined()
  })
})

describe('AuditAction constants', () => {
  it('has all expected action types', async () => {
    const { AuditAction } = await import('@/lib/audit')
    expect(AuditAction.LOGIN).toBe('LOGIN')
    expect(AuditAction.LOGOUT).toBe('LOGOUT')
    expect(AuditAction.CREATE).toBe('CREATE')
    expect(AuditAction.UPDATE).toBe('UPDATE')
    expect(AuditAction.DELETE).toBe('DELETE')
    expect(AuditAction.STATUS_CHANGE).toBe('STATUS_CHANGE')
    expect(AuditAction.PRICE_CHANGE).toBe('PRICE_CHANGE')
    expect(AuditAction.PAYMENT_CONFIRMED).toBe('PAYMENT_CONFIRMED')
    expect(AuditAction.TRANSFER_REGISTERED).toBe('TRANSFER_REGISTERED')
    expect(AuditAction.SETTING_CHANGED).toBe('SETTING_CHANGED')
  })
})

describe('AuditEntity constants', () => {
  it('has all expected entity types', async () => {
    const { AuditEntity } = await import('@/lib/audit')
    expect(AuditEntity.PROFILE).toBe('PROFILE')
    expect(AuditEntity.CLINIC).toBe('CLINIC')
    expect(AuditEntity.DOCTOR).toBe('DOCTOR')
    expect(AuditEntity.PHARMACY).toBe('PHARMACY')
    expect(AuditEntity.PRODUCT).toBe('PRODUCT')
    expect(AuditEntity.ORDER).toBe('ORDER')
    expect(AuditEntity.PAYMENT).toBe('PAYMENT')
    expect(AuditEntity.TRANSFER).toBe('TRANSFER')
    expect(AuditEntity.APP_SETTING).toBe('APP_SETTING')
  })
})
