import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeQueryBuilder, mockSupabaseClient } from '../../setup'
import * as adminModule from '@/lib/db/admin'
import * as serverModule from '@/lib/db/server'
import * as sessionModule from '@/lib/auth/session'
import * as auditModule from '@/lib/audit'
import { createOrder, updateOrderStatus } from '@/services/orders'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/db/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/auth/session', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  AuditAction: { CREATE: 'CREATE', STATUS_CHANGE: 'STATUS_CHANGE' },
  AuditEntity: { ORDER: 'ORDER' },
}))
vi.mock('@/lib/orders/status-machine', () => ({
  isValidTransition: vi.fn().mockReturnValue(true),
}))

// Valid UUIDs for test inputs
const CLINIC_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const DOCTOR_ID = 'b1eec100-0d1c-5fg9-cc7e-7cc0ce491b22'.replace('f', 'e').replace('g', 'f')
const PRODUCT_ID = 'c2ffd211-1e2d-4a0e-dd8f-8dd1df502c33'.replace(/[g-z]/gi, '0')
const ORDER_ID = 'd3fee322-2f3e-5b1f-ee90-9ee2eg613d44'.replace(/[g-z]/gi, '0')

// Use crypto-safe UUIDs
const CID = '11111111-1111-4111-a111-111111111111'
const DID = '22222222-2222-4222-a222-222222222222'
const PID = '33333333-3333-4333-a333-333333333333'
const OID = '44444444-4444-4444-a444-444444444444'

const userMock = {
  id: 'user-1',
  roles: ['CLINIC_ADMIN'] as ['CLINIC_ADMIN'],
  full_name: 'User',
  email: 'u@test.com',
  is_active: true,
  registration_status: 'APPROVED' as const,
  notification_preferences: {},
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
}

const adminMock = {
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
  vi.mocked(sessionModule.requireAuth).mockResolvedValue(userMock)
  vi.mocked(auditModule.createAuditLog).mockResolvedValue(undefined)
})

describe('createOrder — validation', () => {
  it('returns error for empty items array', async () => {
    const result = await createOrder({ clinic_id: CID, doctor_id: DID, items: [] })
    expect(result.error).toBeTruthy()
  })

  it('returns error for invalid UUID in clinic_id', async () => {
    const result = await createOrder({
      clinic_id: 'not-a-uuid',
      doctor_id: DID,
      items: [{ product_id: PID, quantity: 1 }],
    })
    expect(result.error).toBeTruthy()
  })

  it('returns error when user is not authenticated', async () => {
    vi.mocked(sessionModule.requireAuth).mockRejectedValue(new Error('UNAUTHORIZED'))
    const result = await createOrder({
      clinic_id: CID,
      doctor_id: DID,
      items: [{ product_id: PID, quantity: 1 }],
    })
    expect(result.error).toContain('Sessão expirada')
  })
})

describe('createOrder — products validation', () => {
  it('returns error when products are not found', async () => {
    const supabase = mockSupabaseClient()
    const qb = makeQueryBuilder(null, null)
    // Override .in() to resolve with error
    qb.in = vi.fn().mockReturnValue({
      then: (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: { message: 'not found' } }),
    })
    supabase.from = vi.fn().mockReturnValue(qb)
    vi.mocked(serverModule.createClient).mockResolvedValue(
      supabase as ReturnType<typeof mockSupabaseClient>
    )

    const result = await createOrder({
      clinic_id: CID,
      doctor_id: DID,
      items: [{ product_id: PID, quantity: 1 }],
    })
    expect(result.error).toBe('Produtos não encontrados')
  })

  it('returns error when a product is inactive', async () => {
    const products = [
      {
        id: PID,
        pharmacy_id: 'ph-1',
        price_current: 100,
        name: 'Prod A',
        estimated_deadline_days: 3,
        active: false,
      },
    ]
    const supabase = mockSupabaseClient()
    const qb = makeQueryBuilder(products, null)
    supabase.from = vi.fn().mockReturnValue(qb)
    vi.mocked(serverModule.createClient).mockResolvedValue(
      supabase as ReturnType<typeof mockSupabaseClient>
    )

    const result = await createOrder({
      clinic_id: CID,
      doctor_id: DID,
      items: [{ product_id: PID, quantity: 1 }],
    })
    expect(result.error).toBe('Um ou mais produtos estão inativos')
  })

  it('returns error when products are from multiple pharmacies', async () => {
    const PID2 = '55555555-5555-4555-a555-555555555555'
    const products = [
      {
        id: PID,
        pharmacy_id: 'ph-1',
        price_current: 100,
        name: 'A',
        estimated_deadline_days: 3,
        active: true,
      },
      {
        id: PID2,
        pharmacy_id: 'ph-2',
        price_current: 200,
        name: 'B',
        estimated_deadline_days: 3,
        active: true,
      },
    ]
    const supabase = mockSupabaseClient()
    const qb = makeQueryBuilder(products, null)
    supabase.from = vi.fn().mockReturnValue(qb)
    vi.mocked(serverModule.createClient).mockResolvedValue(
      supabase as ReturnType<typeof mockSupabaseClient>
    )

    const result = await createOrder({
      clinic_id: CID,
      doctor_id: DID,
      items: [
        { product_id: PID, quantity: 1 },
        { product_id: PID2, quantity: 1 },
      ],
    })
    expect(result.error).toBe('Todos os produtos devem ser da mesma farmácia')
  })
})

describe('updateOrderStatus', () => {
  it('returns error when order not found', async () => {
    vi.mocked(sessionModule.requireAuth).mockResolvedValue(adminMock)

    const qb = makeQueryBuilder(null, null)
    qb.single = vi.fn().mockResolvedValue({ data: null, error: null })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updateOrderStatus(OID, 'AWAITING_PAYMENT', 'note')
    expect(result.error).toBe('Pedido não encontrado')
  })

  it('returns permission error for CLINIC_ADMIN', async () => {
    vi.mocked(sessionModule.requireAuth).mockResolvedValue(userMock) // CLINIC_ADMIN

    const qb = makeQueryBuilder(
      { id: OID, order_status: 'DRAFT', pharmacy_id: 'ph-1', created_by_user_id: 'user-1' },
      null
    )
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updateOrderStatus(OID, 'AWAITING_PAYMENT', 'note')
    expect(result.error).toBe('Sem permissão para alterar status do pedido')
  })

  it('returns error when transition is invalid', async () => {
    vi.mocked(sessionModule.requireAuth).mockResolvedValue(adminMock)

    const { isValidTransition } = await import('@/lib/orders/status-machine')
    vi.mocked(isValidTransition).mockReturnValueOnce(false)

    const qb = makeQueryBuilder(
      { id: OID, order_status: 'COMPLETED', pharmacy_id: 'ph-1', created_by_user_id: 'user-x' },
      null
    )
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updateOrderStatus(OID, 'AWAITING_PAYMENT', 'note')
    expect(result.error).toContain('Transição inválida')
  })

  it('returns Erro interno when requireAuth throws', async () => {
    vi.mocked(sessionModule.requireAuth).mockRejectedValue(new Error('UNAUTHORIZED'))
    const result = await updateOrderStatus(OID, 'AWAITING_PAYMENT', 'note')
    expect(result.error).toBe('Erro interno')
  })
})
