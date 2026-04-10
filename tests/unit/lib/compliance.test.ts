import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as adminModule from '@/lib/db/admin'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))

// Mock global fetch for ReceitaWS calls
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

beforeEach(() => {
  vi.clearAllMocks()
})

// ── validateCNPJ ─────────────────────────────────────────────────────────────

describe('validateCNPJ', () => {
  it('returns valid=false for CNPJ with wrong length', async () => {
    const { validateCNPJ } = await import('@/lib/compliance')
    const result = await validateCNPJ('123')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('14 dígitos')
  })

  it('returns valid=true for ATIVA situation', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ situacao: 'ATIVA', nome: 'Farmácia Teste Ltda' }),
    })

    const { validateCNPJ } = await import('@/lib/compliance')
    const result = await validateCNPJ('11.222.333/0001-44')
    expect(result.valid).toBe(true)
    expect(result.situation).toBe('ATIVA')
    expect(result.name).toBe('Farmácia Teste Ltda')
    expect(result.error).toBeUndefined()
  })

  it('returns valid=false for BAIXADA situation', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ situacao: 'BAIXADA', nome: 'Old Company' }),
    })

    const { validateCNPJ } = await import('@/lib/compliance')
    const result = await validateCNPJ('11222333000144')
    expect(result.valid).toBe(false)
    expect(result.situation).toBe('BAIXADA')
    expect(result.error).toContain('BAIXADA')
  })

  it('returns valid=false for SUSPENSA situation', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ situacao: 'SUSPENSA' }),
    })

    const { validateCNPJ } = await import('@/lib/compliance')
    const result = await validateCNPJ('11222333000144')
    expect(result.valid).toBe(false)
    expect(result.situation).toBe('SUSPENSA')
  })

  it('fails open (valid=true) when rate limited (429)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429 })

    const { validateCNPJ } = await import('@/lib/compliance')
    const result = await validateCNPJ('11222333000144')
    expect(result.valid).toBe(true)
    expect(result.error).toBe('rate_limited')
  })

  it('returns valid=false when API returns ERROR status', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ERROR', message: 'CNPJ inválido' }),
    })

    const { validateCNPJ } = await import('@/lib/compliance')
    const result = await validateCNPJ('11222333000144')
    expect(result.valid).toBe(false)
    expect(result.error).toBe('CNPJ inválido')
  })

  it('fails open when fetch throws (network error)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network error'))

    const { validateCNPJ } = await import('@/lib/compliance')
    const result = await validateCNPJ('11222333000144')
    expect(result.valid).toBe(true)
    expect(result.situation).toBe('UNKNOWN')
  })

  it('normalizes CNPJ by stripping non-digits before request', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ situacao: 'ATIVA' }),
    })

    const { validateCNPJ } = await import('@/lib/compliance')
    await validateCNPJ('11.222.333/0001-44')

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('11222333000144'),
      expect.any(Object)
    )
  })
})

// ── canPlaceOrder ─────────────────────────────────────────────────────────────

describe('canPlaceOrder', () => {
  function makeAdminWithData(clinic: unknown, pharmacy: unknown, product?: unknown) {
    return {
      from: vi.fn().mockImplementation((table: string) => {
        const chain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn(),
          update: vi.fn().mockReturnThis(),
          or: vi.fn().mockReturnThis(),
        }
        if (table === 'clinics') {
          chain.single.mockResolvedValue({
            data: clinic,
            error: clinic ? null : { message: 'not found' },
          })
        } else if (table === 'pharmacies') {
          chain.single.mockResolvedValue({
            data: pharmacy,
            error: pharmacy ? null : { message: 'not found' },
          })
          chain.update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
        } else if (table === 'products') {
          chain.single.mockResolvedValue({ data: product ?? null, error: null })
        }
        return chain
      }),
    }
  }

  it('returns allowed=false when clinic not found', async () => {
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdminWithData(null, null) as unknown as ReturnType<typeof adminModule.createAdminClient>
    )
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ situacao: 'ATIVA' }),
    })

    const { canPlaceOrder } = await import('@/lib/compliance')
    const result = await canPlaceOrder('clinic-1', 'pharmacy-1')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Clínica não encontrada')
  })

  it('returns allowed=false when clinic is not ACTIVE', async () => {
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdminWithData({ id: 'c1', status: 'PENDING' }, null) as unknown as ReturnType<
        typeof adminModule.createAdminClient
      >
    )

    const { canPlaceOrder } = await import('@/lib/compliance')
    const result = await canPlaceOrder('clinic-1', 'pharmacy-1')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('não está ativa')
  })

  it('returns allowed=false when pharmacy not found', async () => {
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdminWithData({ id: 'c1', status: 'ACTIVE' }, null) as unknown as ReturnType<
        typeof adminModule.createAdminClient
      >
    )

    const { canPlaceOrder } = await import('@/lib/compliance')
    const result = await canPlaceOrder('clinic-1', 'pharmacy-1')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Farmácia não encontrada')
  })

  it('returns allowed=true for valid clinic + active pharmacy with fresh CNPJ validation', async () => {
    const pharmacy = {
      id: 'p1',
      status: 'ACTIVE',
      cnpj: '11222333000144',
      cnpj_validated_at: new Date().toISOString(), // fresh — no revalidation needed
      cnpj_situation: 'ATIVA',
    }
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdminWithData({ id: 'c1', status: 'ACTIVE' }, pharmacy) as unknown as ReturnType<
        typeof adminModule.createAdminClient
      >
    )

    const { canPlaceOrder } = await import('@/lib/compliance')
    const result = await canPlaceOrder('clinic-1', 'pharmacy-1')
    expect(result.allowed).toBe(true)
  })

  it('returns allowed=false when known cnpj_situation is irregular', async () => {
    const pharmacy = {
      id: 'p1',
      status: 'ACTIVE',
      cnpj: '11222333000144',
      cnpj_validated_at: new Date().toISOString(),
      cnpj_situation: 'BAIXADA',
    }
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdminWithData({ id: 'c1', status: 'ACTIVE' }, pharmacy) as unknown as ReturnType<
        typeof adminModule.createAdminClient
      >
    )

    const { canPlaceOrder } = await import('@/lib/compliance')
    const result = await canPlaceOrder('clinic-1', 'pharmacy-1')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('BAIXADA')
  })
})

// ── canAcceptOrder ────────────────────────────────────────────────────────────

describe('canAcceptOrder', () => {
  it('returns allowed=false when order not found', async () => {
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const { canAcceptOrder } = await import('@/lib/compliance')
    const result = await canAcceptOrder('order-1')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Pedido não encontrado')
  })

  it('returns allowed=true for valid order with active pharmacy', async () => {
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'o1',
            order_status: 'AWAITING_PAYMENT',
            pharmacy_id: 'p1',
            pharmacies: { status: 'ACTIVE' },
          },
          error: null,
        }),
      }),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const { canAcceptOrder } = await import('@/lib/compliance')
    const result = await canAcceptOrder('order-1')
    expect(result.allowed).toBe(true)
  })

  it('returns allowed=false for completed order', async () => {
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'o1',
            order_status: 'COMPLETED',
            pharmacy_id: 'p1',
            pharmacies: { status: 'ACTIVE' },
          },
          error: null,
        }),
      }),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const { canAcceptOrder } = await import('@/lib/compliance')
    const result = await canAcceptOrder('order-1')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('COMPLETED')
  })
})
