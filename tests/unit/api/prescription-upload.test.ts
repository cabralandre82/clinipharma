// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { File } from 'node:buffer'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/session', () => ({ getCurrentUser: vi.fn() }))
vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: () => ({ check: vi.fn().mockResolvedValue({ ok: true }) }),
}))
vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  AuditEntity: { ORDER: 'ORDER' },
  AuditAction: { UPDATE: 'UPDATE' },
}))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))
// prescription-rules is used by the prescription-state route — mock it for isolation
vi.mock('@/lib/prescription-rules', () => ({
  getPrescriptionState: vi.fn().mockResolvedValue({ met: true, items: [] }),
}))

import { getCurrentUser } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/db/admin'

const CLINIC_USER = { id: 'user-1', roles: ['CLINIC_ADMIN'] }
const ADMIN_USER = { id: 'admin-1', roles: ['SUPER_ADMIN'] }

/** Build a fake FormData map that req.formData() will return. */
function fakeFormData(fields: Record<string, string | File | null>) {
  return {
    get: (key: string) => fields[key] ?? null,
    getAll: () => [],
  }
}

function makePdfFile(size = 1024) {
  return new File(['x'.repeat(size)], 'receita.pdf', { type: 'application/pdf' })
}

function makeRequest(formFields: Record<string, string | File | null>) {
  const req = new NextRequest('http://localhost/api/orders/order-1/prescriptions', {
    method: 'POST',
    body: 'placeholder', // body content doesn't matter — formData() is mocked below
    headers: { 'Content-Type': 'multipart/form-data; boundary=x' },
  })
  // Override formData() to return our controlled map
  req.formData = async () => fakeFormData(formFields) as unknown as FormData
  return req
}

function makeParams(id = 'order-1') {
  return { params: Promise.resolve({ id }) }
}

function defaultFormFields(): Record<string, string | File | null> {
  return {
    file: makePdfFile(),
    orderItemId: 'item-uuid-1',
    unitsCovered: '1',
  }
}

function makeAdmin({
  order = { id: 'order-1', clinic_id: 'clinic-1' } as object | null,
  clinicMember = { id: 'mem-1' } as object | null,
  orderItem = {
    id: 'item-uuid-1',
    product_id: 'prod-1',
    quantity: 3,
    products: {
      name: 'Controlado Z',
      requires_prescription: true,
      max_units_per_prescription: 1,
    },
  } as object | null,
  existingDocs = [] as object[],
  uploadPath = 'order-1/items/item-uuid-1/123-receita.pdf',
} = {}) {
  const storageUpload = vi.fn().mockResolvedValue({
    data: { path: uploadPath },
    error: null,
  })
  const insertRecord = vi.fn().mockResolvedValue({
    data: { id: 'rx-id-1' },
    error: null,
  })

  return {
    from: (table: string) => {
      if (table === 'orders')
        return {
          select: () => ({
            eq: () => ({ single: () => Promise.resolve({ data: order, error: null }) }),
          }),
        }
      if (table === 'clinic_members')
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ single: () => Promise.resolve({ data: clinicMember, error: null }) }),
            }),
          }),
        }
      if (table === 'order_items')
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ single: () => Promise.resolve({ data: orderItem, error: null }) }),
            }),
          }),
        }
      if (table === 'order_item_prescriptions')
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: existingDocs, error: null }),
          }),
          insert: () => ({
            select: () => ({ single: () => insertRecord() }),
          }),
        }
      return {}
    },
    storage: {
      from: () => ({ upload: storageUpload }),
    },
    _storageUpload: storageUpload,
    _insertRecord: insertRecord,
  }
}

// ─── POST /api/orders/[id]/prescriptions ──────────────────────────────────────

describe('POST /api/orders/[id]/prescriptions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('TC-RXU-01: unauthenticated → 401', async () => {
    ;(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const { POST } = await import('@/app/api/orders/[id]/prescriptions/route')
    const res = await POST(makeRequest(defaultFormFields()), makeParams())
    expect(res.status).toBe(401)
  })

  it('TC-RXU-02: missing file → 400', async () => {
    ;(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(CLINIC_USER)
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdmin())
    const fields = { ...defaultFormFields(), file: null }
    const { POST } = await import('@/app/api/orders/[id]/prescriptions/route')
    const res = await POST(makeRequest(fields), makeParams())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('Arquivo')
  })

  it('TC-RXU-03: missing orderItemId → 400', async () => {
    ;(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(CLINIC_USER)
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdmin())
    const fields = { ...defaultFormFields(), orderItemId: null }
    const { POST } = await import('@/app/api/orders/[id]/prescriptions/route')
    const res = await POST(makeRequest(fields), makeParams())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('orderItemId')
  })

  it('TC-RXU-04: disallowed file type (text/plain) → 400', async () => {
    ;(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(CLINIC_USER)
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdmin())
    const badFile = new File(['data'], 'rx.txt', { type: 'text/plain' })
    const fields = { ...defaultFormFields(), file: badFile }
    const { POST } = await import('@/app/api/orders/[id]/prescriptions/route')
    const res = await POST(makeRequest(fields), makeParams())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('não permitido')
  })

  it('TC-RXU-05: user not in clinic → 403', async () => {
    ;(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(CLINIC_USER)
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdmin({ clinicMember: null })
    )
    const { POST } = await import('@/app/api/orders/[id]/prescriptions/route')
    const res = await POST(makeRequest(defaultFormFields()), makeParams())
    expect(res.status).toBe(403)
  })

  it('TC-RXU-06: product does not require prescription → 422', async () => {
    ;(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(CLINIC_USER)
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdmin({
        orderItem: {
          id: 'item-uuid-1',
          product_id: 'prod-1',
          quantity: 2,
          products: {
            name: 'Vitamina C',
            requires_prescription: false,
            max_units_per_prescription: null,
          },
        },
      })
    )
    const { POST } = await import('@/app/api/orders/[id]/prescriptions/route')
    const res = await POST(makeRequest(defaultFormFields()), makeParams())
    expect(res.status).toBe(422)
    expect((await res.json()).error).toContain('não exige receita')
  })

  it('TC-RXU-07: all units already covered → 422', async () => {
    ;(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(CLINIC_USER)
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdmin({
        orderItem: {
          id: 'item-uuid-1',
          product_id: 'prod-1',
          quantity: 2,
          products: {
            name: 'Controlado',
            requires_prescription: true,
            max_units_per_prescription: 1,
          },
        },
        existingDocs: [{ units_covered: 1 }, { units_covered: 1 }],
      })
    )
    const { POST } = await import('@/app/api/orders/[id]/prescriptions/route')
    const res = await POST(makeRequest(defaultFormFields()), makeParams())
    expect(res.status).toBe(422)
    expect((await res.json()).error).toContain('já têm receita')
  })

  it('TC-RXU-08: valid upload by admin bypasses clinic membership check → 200', async () => {
    ;(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN_USER)
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdmin())
    const { POST } = await import('@/app/api/orders/[id]/prescriptions/route')
    const res = await POST(makeRequest(defaultFormFields()), makeParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.id).toBe('rx-id-1')
  })

  it('TC-RXU-09: order not found → 404', async () => {
    ;(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(CLINIC_USER)
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdmin({ order: null }))
    const { POST } = await import('@/app/api/orders/[id]/prescriptions/route')
    const res = await POST(makeRequest(defaultFormFields()), makeParams())
    expect(res.status).toBe(404)
  })

  it('TC-RXU-10: unitsCovered=0 → 400', async () => {
    ;(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(CLINIC_USER)
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdmin())
    const fields = { ...defaultFormFields(), unitsCovered: '0' }
    const { POST } = await import('@/app/api/orders/[id]/prescriptions/route')
    const res = await POST(makeRequest(fields), makeParams())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('>= 1')
  })

  // ──────────────────────────────────────────────────────────────────
  //  Onda 4 / issue #11 — automatic order status transition.
  //  When a prescription upload completes the Rx requirement set,
  //  the order must move from AWAITING_DOCUMENTS to READY_FOR_REVIEW
  //  so the pharmacy sees the work in their queue. When some receipts
  //  are still missing, the order must stay parked.
  // ──────────────────────────────────────────────────────────────────

  it('TC-RXU-11: upload completes Rx set → response carries transitioned=true', async () => {
    ;(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(CLINIC_USER)
    const { getPrescriptionState } = await import('@/lib/prescription-rules')
    ;(getPrescriptionState as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      met: true,
      items: [],
    })
    // Mock advanceOrderAfterDocumentUpload via module mock so we don't
    // have to thread auth/postgres through the test admin client.
    const transitions = await import('@/lib/orders/document-transitions')
    const advanceSpy = vi
      .spyOn(transitions, 'advanceOrderAfterDocumentUpload')
      .mockResolvedValue({ transitioned: true, status: 'READY_FOR_REVIEW' })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdmin())

    const { POST } = await import('@/app/api/orders/[id]/prescriptions/route')
    const res = await POST(makeRequest(defaultFormFields()), makeParams())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.transitioned).toBe(true)
    expect(body.order_status).toBe('READY_FOR_REVIEW')
    expect(advanceSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        changedByUserId: 'user-1',
      })
    )
    advanceSpy.mockRestore()
  })

  it('TC-RXU-12: upload still leaves Rx pending → no transition, transitioned=false', async () => {
    ;(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(CLINIC_USER)
    const { getPrescriptionState } = await import('@/lib/prescription-rules')
    ;(getPrescriptionState as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      met: false,
      reason: '"Outro": receita não enviada',
      items: [],
    })
    const transitions = await import('@/lib/orders/document-transitions')
    const advanceSpy = vi.spyOn(transitions, 'advanceOrderAfterDocumentUpload')
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdmin())

    const { POST } = await import('@/app/api/orders/[id]/prescriptions/route')
    const res = await POST(makeRequest(defaultFormFields()), makeParams())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.transitioned).toBe(false)
    expect(body.order_status).toBeNull()
    // Critical: when state isn't met yet, advance must NOT be invoked.
    expect(advanceSpy).not.toHaveBeenCalled()
    advanceSpy.mockRestore()
  })

  it('TC-RXU-13: transition error never fails the upload itself', async () => {
    ;(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(CLINIC_USER)
    const { getPrescriptionState } = await import('@/lib/prescription-rules')
    ;(getPrescriptionState as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      met: true,
      items: [],
    })
    const transitions = await import('@/lib/orders/document-transitions')
    const advanceSpy = vi
      .spyOn(transitions, 'advanceOrderAfterDocumentUpload')
      .mockRejectedValue(new Error('temporary db blip'))
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdmin())

    const { POST } = await import('@/app/api/orders/[id]/prescriptions/route')
    const res = await POST(makeRequest(defaultFormFields()), makeParams())

    // The receipt is already saved; we MUST NOT 5xx because of a
    // secondary state-update failure. The clinic gets success and the
    // operator can re-run the transition out-of-band.
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.transitioned).toBe(false)
    advanceSpy.mockRestore()
  })
})

// ─── GET /api/orders/[id]/prescription-state ──────────────────────────────────

describe('GET /api/orders/[id]/prescription-state', () => {
  beforeEach(() => vi.clearAllMocks())

  function makeGET(id = 'order-1') {
    return new NextRequest(`http://localhost/api/orders/${id}/prescription-state`)
  }

  function makeStateAdmin({
    order = { id: 'order-1', clinic_id: 'clinic-1', pharmacy_id: 'pharm-1' } as object | null,
    clinicMember = null as object | null,
    pharmacyMember = null as object | null,
  } = {}) {
    return {
      from: (table: string) => {
        if (table === 'orders')
          return {
            select: () => ({
              eq: () => ({ single: () => Promise.resolve({ data: order, error: null }) }),
            }),
          }
        if (table === 'clinic_members')
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: clinicMember, error: null }),
                }),
              }),
            }),
          }
        if (table === 'pharmacy_members')
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: pharmacyMember, error: null }),
                }),
              }),
            }),
          }
        return {
          select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        }
      },
    }
  }

  it('TC-RXS-01: unauthenticated → 401', async () => {
    ;(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const { GET } = await import('@/app/api/orders/[id]/prescription-state/route')
    const res = await GET(makeGET(), makeParams())
    expect(res.status).toBe(401)
  })

  it('TC-RXS-02: order not found → 404', async () => {
    ;(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN_USER)
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeStateAdmin({ order: null })
    )
    const { GET } = await import('@/app/api/orders/[id]/prescription-state/route')
    const res = await GET(makeGET(), makeParams())
    expect(res.status).toBe(404)
  })

  it('TC-RXS-03: non-member user (not clinic, not pharmacy) → 403', async () => {
    ;(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(CLINIC_USER)
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeStateAdmin({ clinicMember: null, pharmacyMember: null })
    )
    const { GET } = await import('@/app/api/orders/[id]/prescription-state/route')
    const res = await GET(makeGET(), makeParams())
    expect(res.status).toBe(403)
  })

  it('TC-RXS-04: clinic member gets state → 200 with met and items', async () => {
    ;(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(CLINIC_USER)
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeStateAdmin({ clinicMember: { id: 'mem-1' } })
    )
    const { GET } = await import('@/app/api/orders/[id]/prescription-state/route')
    const res = await GET(makeGET(), makeParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.met).toBe('boolean')
    expect(Array.isArray(body.items)).toBe(true)
  })

  it('TC-RXS-05: admin gets state without membership check → 200', async () => {
    ;(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN_USER)
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeStateAdmin())
    const { GET } = await import('@/app/api/orders/[id]/prescription-state/route')
    const res = await GET(makeGET(), makeParams())
    expect(res.status).toBe(200)
  })
})

// ─── productSchema — prescription fields ──────────────────────────────────────

const VALID_CAT_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const VALID_PHARM_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e'

const BASE_PRODUCT = {
  category_id: VALID_CAT_ID,
  pharmacy_id: VALID_PHARM_ID,
  name: 'Produto Teste',
  slug: 'produto-teste',
  concentration: '10mg',
  presentation: 'Cápsula 30un',
  short_description: 'Descrição suficientemente longa para passar',
  price_current: 50,
  pharmacy_cost: 20,
  estimated_deadline_days: 5,
}

describe('productSchema — prescription fields', () => {
  it('TC-PSCH-01: valid product with requires_prescription=false passes', async () => {
    const { productSchema } = await import('@/lib/validators')
    const result = productSchema.safeParse({
      ...BASE_PRODUCT,
      requires_prescription: false,
      prescription_type: null,
      max_units_per_prescription: null,
    })
    expect(result.success).toBe(true)
  })

  it('TC-PSCH-02: valid product with SPECIAL_CONTROL and max_units=1 passes', async () => {
    const { productSchema } = await import('@/lib/validators')
    const result = productSchema.safeParse({
      ...BASE_PRODUCT,
      requires_prescription: true,
      prescription_type: 'SPECIAL_CONTROL',
      max_units_per_prescription: 1,
    })
    expect(result.success).toBe(true)
  })

  it('TC-PSCH-03: invalid prescription_type value → fails validation', async () => {
    const { productSchema } = await import('@/lib/validators')
    const result = productSchema.safeParse({
      ...BASE_PRODUCT,
      requires_prescription: true,
      prescription_type: 'INVALID_TYPE',
    })
    expect(result.success).toBe(false)
  })

  it('TC-PSCH-04: max_units_per_prescription=0 → fails (must be >= 1)', async () => {
    const { productSchema } = await import('@/lib/validators')
    const result = productSchema.safeParse({
      ...BASE_PRODUCT,
      max_units_per_prescription: 0,
    })
    expect(result.success).toBe(false)
  })

  it('TC-PSCH-05: prescription fields are optional (omitting them passes)', async () => {
    const { productSchema } = await import('@/lib/validators')
    const result = productSchema.safeParse(BASE_PRODUCT)
    expect(result.success).toBe(true)
  })

  it('TC-PSCH-06: ANTIMICROBIAL type passes', async () => {
    const { productSchema } = await import('@/lib/validators')
    const result = productSchema.safeParse({
      ...BASE_PRODUCT,
      requires_prescription: true,
      prescription_type: 'ANTIMICROBIAL',
      max_units_per_prescription: null,
    })
    expect(result.success).toBe(true)
  })
})
