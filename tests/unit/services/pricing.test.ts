import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeQueryBuilder } from '../../setup'
import * as adminModule from '@/lib/db/admin'
import * as rbacModule from '@/lib/rbac'
import * as auditModule from '@/lib/audit'
import {
  togglePricingMode,
  savePricingProfile,
  createBuyerOverride,
  expireBuyerOverride,
  getActivePricingProfile,
  listOverridesForProduct,
} from '@/services/pricing'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/rbac', () => ({ requireRole: vi.fn() }))
vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  AuditAction: {
    CREATE: 'CREATE',
    UPDATE: 'UPDATE',
    DELETE: 'DELETE',
  },
  AuditEntity: { PRODUCT: 'PRODUCT', CLINIC: 'CLINIC' },
}))

const actorMock = {
  id: '11111111-1111-1111-1111-111111111111',
  roles: ['SUPER_ADMIN'] as ['SUPER_ADMIN'],
  full_name: 'Admin',
  email: 'a@test.com',
  is_active: true,
  registration_status: 'APPROVED' as const,
  notification_preferences: {},
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
}

const PRODUCT_ID = '22222222-2222-2222-2222-222222222222'
const CLINIC_ID = '33333333-3333-3333-3333-333333333333'
const DOCTOR_ID = '44444444-4444-4444-4444-444444444444'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(rbacModule.requireRole).mockResolvedValue(actorMock)
  vi.mocked(auditModule.createAuditLog).mockResolvedValue(undefined)
})

// ── togglePricingMode ────────────────────────────────────────────────────

describe('togglePricingMode', () => {
  it('flips FIXED → TIERED_PROFILE and writes audit', async () => {
    const productsRead = makeQueryBuilder({ pricing_mode: 'FIXED' }, null)
    productsRead.single = vi
      .fn()
      .mockResolvedValue({ data: { pricing_mode: 'FIXED' }, error: null })

    const productsUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    })

    let callIdx = 0
    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table !== 'products') return makeQueryBuilder(null, null)
      callIdx += 1
      // First call is the read (.select.eq.single), second is update.
      if (callIdx === 1) return productsRead
      return { update: productsUpdate }
    })

    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: fromMock,
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const res = await togglePricingMode(PRODUCT_ID, 'TIERED_PROFILE', 'ativando tirzepatida')
    expect(res.error).toBeUndefined()
    expect(productsUpdate).toHaveBeenCalledOnce()
    const updateCall = productsUpdate.mock.calls[0]?.[0] as { pricing_mode: string }
    expect(updateCall?.pricing_mode).toBe('TIERED_PROFILE')
    expect(auditModule.createAuditLog).toHaveBeenCalledOnce()
  })

  it('is a no-op (audited) when target mode equals current', async () => {
    const productsRead = makeQueryBuilder({ pricing_mode: 'FIXED' }, null)
    productsRead.single = vi
      .fn()
      .mockResolvedValue({ data: { pricing_mode: 'FIXED' }, error: null })

    const productsUpdate = vi.fn()

    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'products') return productsRead
        return makeQueryBuilder(null, null)
      }),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const res = await togglePricingMode(PRODUCT_ID, 'FIXED', 'mantendo')
    expect(res.error).toBeUndefined()
    expect(productsUpdate).not.toHaveBeenCalled()
    // Audit row still emitted with noop=true so the operator's intent
    // is visible to compliance.
    expect(auditModule.createAuditLog).toHaveBeenCalledOnce()
    const auditArg = vi.mocked(auditModule.createAuditLog).mock.calls[0]?.[0] as
      | { newValues?: { noop?: boolean } }
      | undefined
    expect(auditArg?.newValues?.noop).toBe(true)
  })

  it('returns produto não encontrado when the read fails', async () => {
    const qb = makeQueryBuilder(null, { code: 'PGRST116', message: 'not found' })
    qb.single = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'not found' } })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const res = await togglePricingMode(PRODUCT_ID, 'TIERED_PROFILE', 'reason')
    expect(res.error).toBe('Produto não encontrado')
  })

  it('returns Sem permissão when caller is not SUPER_ADMIN', async () => {
    vi.mocked(rbacModule.requireRole).mockRejectedValueOnce(new Error('FORBIDDEN'))
    const res = await togglePricingMode(PRODUCT_ID, 'TIERED_PROFILE', 'reason')
    expect(res.error).toBe('Sem permissão')
  })
})

// ── savePricingProfile (RPC) ─────────────────────────────────────────────

describe('savePricingProfile', () => {
  function mockRpc(rpcResponse: { data?: unknown; error?: unknown }) {
    const rpc = vi.fn().mockResolvedValue(rpcResponse)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      rpc,
      from: vi.fn().mockReturnValue(makeQueryBuilder(null, null)),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)
    return rpc
  }

  const VALID_INPUT = {
    pharmacy_cost_unit_cents: 50000,
    platform_min_unit_cents: 12000,
    platform_min_unit_pct: 8,
    consultant_commission_basis: 'TOTAL_PRICE' as const,
    consultant_commission_fixed_per_unit_cents: null,
    change_reason: 'criando v1 da tirzepatida',
    tiers: [
      { min_quantity: 1, max_quantity: 1, unit_price_cents: 150000 },
      { min_quantity: 2, max_quantity: 3, unit_price_cents: 140000 },
      { min_quantity: 4, max_quantity: 10, unit_price_cents: 130000 },
    ],
  }

  it('persists via RPC and returns profile_id + tier_ids', async () => {
    const rpc = mockRpc({
      data: {
        profile_id: 'profile-1',
        tier_ids: ['t1', 't2', 't3'],
        expired_previous: null,
      },
      error: null,
    })

    const res = await savePricingProfile(PRODUCT_ID, VALID_INPUT)
    expect(res.error).toBeUndefined()
    expect(res.profileId).toBe('profile-1')
    expect(res.tierIds).toEqual(['t1', 't2', 't3'])
    expect(res.expiredPreviousId).toBeNull()
    expect(rpc).toHaveBeenCalledWith('set_pricing_profile_atomic', expect.any(Object))
    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>
    expect(args.p_product_id).toBe(PRODUCT_ID)
    expect((args.p_tiers as unknown[]).length).toBe(3)
    expect(auditModule.createAuditLog).toHaveBeenCalledOnce()
  })

  it('rejects overlapping tiers client-side via Zod', async () => {
    const rpc = mockRpc({ data: null, error: null })
    const res = await savePricingProfile(PRODUCT_ID, {
      ...VALID_INPUT,
      tiers: [
        { min_quantity: 1, max_quantity: 5, unit_price_cents: 100000 },
        { min_quantity: 3, max_quantity: 8, unit_price_cents: 90000 },
      ],
    })
    expect(res.error).toMatch(/sobrepostas/i)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects FIXED_PER_UNIT consultant exceeding platform_min_unit_cents', async () => {
    const rpc = mockRpc({ data: null, error: null })
    const res = await savePricingProfile(PRODUCT_ID, {
      ...VALID_INPUT,
      consultant_commission_basis: 'FIXED_PER_UNIT',
      consultant_commission_fixed_per_unit_cents: 13000, // > 12000
    })
    expect(res.error).toMatch(/não pode exceder o piso/i)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('maps RPC product_not_found to friendly error', async () => {
    mockRpc({
      data: null,
      error: { message: 'product_not_found', code: 'P0001' },
    })
    const res = await savePricingProfile(PRODUCT_ID, VALID_INPUT)
    expect(res.error).toBe('Produto não encontrado')
  })

  it('maps RPC invalid_tier (overlap missed by client) to friendly error', async () => {
    mockRpc({
      data: null,
      error: { message: 'invalid_tier: ...', code: 'P0001' },
    })
    const res = await savePricingProfile(PRODUCT_ID, VALID_INPUT)
    expect(res.error).toMatch(/Tiers com sobreposição/i)
  })

  it('returns Sem permissão when not SUPER_ADMIN', async () => {
    vi.mocked(rbacModule.requireRole).mockRejectedValueOnce(new Error('FORBIDDEN'))
    const res = await savePricingProfile(PRODUCT_ID, VALID_INPUT)
    expect(res.error).toBe('Sem permissão')
  })
})

// ── createBuyerOverride ──────────────────────────────────────────────────

describe('createBuyerOverride', () => {
  const VALID_CLINIC_INPUT = {
    product_id: PRODUCT_ID,
    clinic_id: CLINIC_ID,
    doctor_id: null,
    platform_min_unit_cents: 6000,
    platform_min_unit_pct: null,
    change_reason: 'piso negociado clínica X',
  }

  function mockInsertResult(returning: unknown, error: unknown = null) {
    const insertChain = {
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: returning, error }),
      }),
    }
    const insert = vi.fn().mockReturnValue(insertChain)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'buyer_pricing_overrides') return { insert }
        return makeQueryBuilder(null, null)
      }),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)
    return insert
  }

  it('creates a clinic override and audits', async () => {
    const insert = mockInsertResult({ id: 'ovr-1' })

    const res = await createBuyerOverride(VALID_CLINIC_INPUT)
    expect(res.error).toBeUndefined()
    expect(res.overrideId).toBe('ovr-1')
    expect(insert).toHaveBeenCalledOnce()
    const insertedRow = insert.mock.calls[0]?.[0] as {
      clinic_id: string | null
      doctor_id: string | null
    }
    expect(insertedRow?.clinic_id).toBe(CLINIC_ID)
    expect(insertedRow?.doctor_id).toBeNull()
    expect(auditModule.createAuditLog).toHaveBeenCalledOnce()
  })

  it('creates a doctor override (XOR alternative path)', async () => {
    const insert = mockInsertResult({ id: 'ovr-2' })

    const res = await createBuyerOverride({
      ...VALID_CLINIC_INPUT,
      clinic_id: null,
      doctor_id: DOCTOR_ID,
    })
    expect(res.error).toBeUndefined()
    expect(res.overrideId).toBe('ovr-2')
    const row = insert.mock.calls[0]?.[0] as { clinic_id: unknown; doctor_id: unknown }
    expect(row.clinic_id).toBeNull()
    expect(row.doctor_id).toBe(DOCTOR_ID)
  })

  it('rejects both buyers set (XOR violated client-side)', async () => {
    const insert = mockInsertResult({ id: 'never' })
    const res = await createBuyerOverride({
      ...VALID_CLINIC_INPUT,
      doctor_id: DOCTOR_ID,
    })
    expect(res.error).toMatch(/exatamente um destinatário/i)
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects no floor at all', async () => {
    const insert = mockInsertResult({ id: 'never' })
    const res = await createBuyerOverride({
      ...VALID_CLINIC_INPUT,
      platform_min_unit_cents: null,
      platform_min_unit_pct: null,
    })
    expect(res.error).toMatch(/pelo menos um piso/i)
    expect(insert).not.toHaveBeenCalled()
  })

  it('translates 23505 (overlap) to friendly Portuguese', async () => {
    mockInsertResult(null, {
      code: '23505',
      message: 'overlap detected for product=...',
    })
    const res = await createBuyerOverride(VALID_CLINIC_INPUT)
    expect(res.error).toMatch(/já existe um override ativo/i)
  })
})

// ── expireBuyerOverride ──────────────────────────────────────────────────

describe('expireBuyerOverride', () => {
  it('sets effective_until and audits', async () => {
    const updateEq = vi.fn().mockResolvedValue({ data: null, error: null })
    const update = vi.fn().mockReturnValue({ eq: updateEq })

    const select = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'ovr-1',
            product_id: PRODUCT_ID,
            effective_from: new Date(Date.now() - 60_000).toISOString(),
            effective_until: null,
            clinic_id: CLINIC_ID,
            doctor_id: null,
          },
          error: null,
        }),
      }),
    })

    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'buyer_pricing_overrides') return { select, update }
        return makeQueryBuilder(null, null)
      }),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const res = await expireBuyerOverride('11111111-2222-3333-4444-555555555555', 'fim do contrato')
    expect(res.error).toBeUndefined()
    expect(update).toHaveBeenCalledOnce()
    const patch = update.mock.calls[0]?.[0] as { effective_until: string }
    expect(typeof patch.effective_until).toBe('string')
    expect(auditModule.createAuditLog).toHaveBeenCalledOnce()
  })

  it('refuses to expire an already-expired override', async () => {
    const select = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'ovr-1',
            product_id: PRODUCT_ID,
            effective_from: new Date(Date.now() - 60_000).toISOString(),
            effective_until: new Date(Date.now() - 30_000).toISOString(),
            clinic_id: CLINIC_ID,
            doctor_id: null,
          },
          error: null,
        }),
      }),
    })
    const update = vi.fn()

    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'buyer_pricing_overrides') return { select, update }
        return makeQueryBuilder(null, null)
      }),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const res = await expireBuyerOverride('11111111-2222-3333-4444-555555555555', 'reason')
    expect(res.error).toMatch(/já estava encerrado/i)
    expect(update).not.toHaveBeenCalled()
  })
})

// ── Read helpers ─────────────────────────────────────────────────────────

describe('getActivePricingProfile', () => {
  it('returns profile + tiers ordered by min_quantity', async () => {
    const profileQB = makeQueryBuilder(
      {
        id: 'profile-1',
        product_id: PRODUCT_ID,
        pharmacy_cost_unit_cents: 50000,
        platform_min_unit_cents: 12000,
        platform_min_unit_pct: 8,
        consultant_commission_basis: 'TOTAL_PRICE',
        effective_from: '2026-01-01',
        effective_until: null,
        created_by_user_id: 'admin',
        change_reason: 'init',
        created_at: '2026-01-01',
      },
      null
    )
    profileQB.maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'profile-1',
        product_id: PRODUCT_ID,
        pharmacy_cost_unit_cents: 50000,
        platform_min_unit_cents: 12000,
      },
      error: null,
    })

    const tiers = [
      { id: 't1', min_quantity: 1, max_quantity: 1, unit_price_cents: 150000 },
      { id: 't2', min_quantity: 2, max_quantity: 3, unit_price_cents: 140000 },
    ]
    const tiersQB = makeQueryBuilder(tiers, null)

    let callCount = 0
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        callCount += 1
        if (table === 'pricing_profiles') return profileQB
        if (table === 'pricing_profile_tiers') return tiersQB
        return makeQueryBuilder(null, null)
      }),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await getActivePricingProfile(PRODUCT_ID)
    expect(result.profile?.id).toBe('profile-1')
    expect(result.tiers.length).toBe(2)
    expect(callCount).toBe(2)
  })

  it('returns nulls/[] when no live profile exists', async () => {
    const profileQB = makeQueryBuilder(null, null)
    profileQB.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })

    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(profileQB),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const r = await getActivePricingProfile(PRODUCT_ID)
    expect(r.profile).toBeNull()
    expect(r.tiers).toEqual([])
  })
})

describe('listOverridesForProduct', () => {
  it('joins clinic/doctor names into buyer_label', async () => {
    const overrideRows = [
      {
        id: 'ovr-1',
        product_id: PRODUCT_ID,
        clinic_id: CLINIC_ID,
        doctor_id: null,
        platform_min_unit_cents: 6000,
        platform_min_unit_pct: null,
        effective_from: '2026-04-01',
        effective_until: null,
        created_by_user_id: 'admin',
        change_reason: 'clínica',
        created_at: '2026-04-01',
      },
      {
        id: 'ovr-2',
        product_id: PRODUCT_ID,
        clinic_id: null,
        doctor_id: DOCTOR_ID,
        platform_min_unit_cents: null,
        platform_min_unit_pct: 5,
        effective_from: '2026-03-15',
        effective_until: null,
        created_by_user_id: 'admin',
        change_reason: 'médico',
        created_at: '2026-03-15',
      },
    ]
    const ovrQB = makeQueryBuilder(overrideRows, null)

    const clinicsQB = makeQueryBuilder([{ id: CLINIC_ID, trade_name: 'Clínica X' }], null)
    const doctorsQB = makeQueryBuilder([{ id: DOCTOR_ID, full_name: 'Dr. Y' }], null)

    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'buyer_pricing_overrides') return ovrQB
        if (table === 'clinics') return clinicsQB
        if (table === 'doctors') return doctorsQB
        return makeQueryBuilder(null, null)
      }),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const rows = await listOverridesForProduct(PRODUCT_ID)
    expect(rows.length).toBe(2)
    const clinicRow = rows.find((r) => r.id === 'ovr-1')
    const doctorRow = rows.find((r) => r.id === 'ovr-2')
    expect(clinicRow?.buyer_label).toBe('Clínica X')
    expect(clinicRow?.buyer_kind).toBe('clinic')
    expect(doctorRow?.buyer_label).toBe('Dr. Y')
    expect(doctorRow?.buyer_kind).toBe('doctor')
  })
})
