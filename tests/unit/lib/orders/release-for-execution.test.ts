import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Tests the operational invariant introduced on 2026-04-29:
 *
 *   "When a paid order arrives at the post-payment branch — through
 *    manual admin confirmation, the Asaas synchronous webhook, or the
 *    Asaas inngest worker — it is moved to RELEASED_FOR_EXECUTION
 *    immediately and the pharmacy is notified."
 *
 * Before this helper, an order paid manually by the admin landed in
 * COMMISSION_CALCULATED with NO admin action visible (SKIP_STATUSES
 * hid every button) and the pharmacy received NO notification — the
 * order simply disappeared into a black hole until somebody noticed
 * and clicked through three intermediate states by hand.
 *
 * The helper has three responsibilities tested below:
 *   1. Idempotent transition (only emits once even if called twice)
 *   2. status_history row inserted with the supplied reason
 *   3. Pharmacy admins notified in three channels (in-app, push, email)
 */

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn() }))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/push', () => ({ sendPushToUser: vi.fn() }))
vi.mock('@/lib/email/templates', () => ({
  orderStatusUpdatedEmail: vi.fn(() => ({ subject: 's', html: '<x/>' })),
}))

import * as adminModule from '@/lib/db/admin'
import * as notifications from '@/lib/notifications'
import * as email from '@/lib/email'
import * as push from '@/lib/push'
import { releaseOrderForExecution } from '@/lib/orders/release-for-execution'

interface MockOrder {
  id: string
  code: string
  order_status: string
  pharmacy_id: string
  total_price: number
}

interface MockMember {
  user_id: string
  profiles: {
    email: string | null
    full_name: string | null
    notification_preferences: Record<string, boolean> | null
  } | null
}

function buildAdminClient(opts: { order: MockOrder; members: MockMember[] }) {
  const orderSingle = vi.fn().mockResolvedValue({ data: opts.order, error: null })
  const orderEq2 = vi.fn().mockReturnValue({ single: orderSingle })
  const orderUpdateEq2 = vi.fn().mockResolvedValue({ data: null, error: null })
  const orderUpdateEq1 = vi.fn().mockReturnValue({ eq: orderUpdateEq2 })
  const orderUpdate = vi.fn().mockReturnValue({ eq: orderUpdateEq1 })
  const orderSelect = vi.fn().mockReturnValue({ eq: orderEq2 })

  const historyInsert = vi.fn().mockResolvedValue({ data: null, error: null })
  const memberEq = vi.fn().mockResolvedValue({ data: opts.members, error: null })
  const memberSelect = vi.fn().mockReturnValue({ eq: memberEq })

  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'orders') return { select: orderSelect, update: orderUpdate }
    if (table === 'order_status_history') return { insert: historyInsert }
    if (table === 'pharmacy_members') return { select: memberSelect }
    throw new Error(`unexpected table ${table}`)
  })

  return {
    client: { from },
    spies: { orderUpdate, historyInsert, orderUpdateEq1, orderUpdateEq2 },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('releaseOrderForExecution', () => {
  it('moves COMMISSION_CALCULATED → RELEASED_FOR_EXECUTION and notifies pharmacy admins', async () => {
    const { client, spies } = buildAdminClient({
      order: {
        id: 'o1',
        code: 'CP-2026-001',
        order_status: 'COMMISSION_CALCULATED',
        pharmacy_id: 'ph1',
        total_price: 180.5,
      },
      members: [
        {
          user_id: 'u1',
          profiles: { email: 'op1@pharm.com', full_name: 'Op 1', notification_preferences: {} },
        },
        {
          user_id: 'u2',
          profiles: { email: 'op2@pharm.com', full_name: 'Op 2', notification_preferences: {} },
        },
      ],
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await releaseOrderForExecution({
      orderId: 'o1',
      reason: 'Pagamento confirmado via teste',
    })

    expect(result.ok).toBe(true)
    expect(result.released).toBe(true)
    expect(result.pharmacyRecipients.sort()).toEqual(['u1', 'u2'])

    expect(spies.orderUpdate).toHaveBeenCalledTimes(1)
    expect(spies.orderUpdate.mock.calls[0]?.[0]).toMatchObject({
      order_status: 'RELEASED_FOR_EXECUTION',
    })
    expect(spies.historyInsert).toHaveBeenCalledTimes(1)
    expect(spies.historyInsert.mock.calls[0]?.[0]).toMatchObject({
      old_status: 'COMMISSION_CALCULATED',
      new_status: 'RELEASED_FOR_EXECUTION',
      reason: 'Pagamento confirmado via teste',
    })
    expect(notifications.createNotification).toHaveBeenCalledTimes(2)
    expect(push.sendPushToUser).toHaveBeenCalledTimes(2)
    expect(email.sendEmail).toHaveBeenCalledTimes(2)
  })

  it('also covers PAYMENT_CONFIRMED → RELEASED_FOR_EXECUTION (webhook path)', async () => {
    const { client, spies } = buildAdminClient({
      order: {
        id: 'o2',
        code: 'CP-2026-002',
        order_status: 'PAYMENT_CONFIRMED',
        pharmacy_id: 'ph1',
        total_price: 50,
      },
      members: [],
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await releaseOrderForExecution({
      orderId: 'o2',
      reason: 'Asaas PAYMENT_CONFIRMED',
    })

    expect(result.released).toBe(true)
    expect(spies.historyInsert.mock.calls[0]?.[0]).toMatchObject({
      old_status: 'PAYMENT_CONFIRMED',
      new_status: 'RELEASED_FOR_EXECUTION',
    })
  })

  it('is idempotent — running on an already-released order is a no-op', async () => {
    const { client, spies } = buildAdminClient({
      order: {
        id: 'o3',
        code: 'CP-2026-003',
        order_status: 'RELEASED_FOR_EXECUTION',
        pharmacy_id: 'ph1',
        total_price: 50,
      },
      members: [
        {
          user_id: 'u1',
          profiles: { email: 'op1@pharm.com', full_name: 'Op 1', notification_preferences: {} },
        },
      ],
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await releaseOrderForExecution({
      orderId: 'o3',
      reason: 'duplicate webhook delivery',
    })

    expect(result.ok).toBe(true)
    expect(result.released).toBe(false)
    expect(spies.orderUpdate).not.toHaveBeenCalled()
    expect(spies.historyInsert).not.toHaveBeenCalled()
    expect(notifications.createNotification).not.toHaveBeenCalled()
    expect(push.sendPushToUser).not.toHaveBeenCalled()
    expect(email.sendEmail).not.toHaveBeenCalled()
  })

  it('also treats execution-stage states as already-released (idempotency)', async () => {
    for (const status of ['IN_EXECUTION', 'READY', 'SHIPPED', 'DELIVERED', 'COMPLETED']) {
      const { client } = buildAdminClient({
        order: {
          id: 'ox',
          code: 'CP-2026-x',
          order_status: status,
          pharmacy_id: 'ph1',
          total_price: 1,
        },
        members: [],
      })
      vi.mocked(adminModule.createAdminClient).mockReturnValue(
        client as unknown as ReturnType<typeof adminModule.createAdminClient>
      )
      const result = await releaseOrderForExecution({ orderId: 'ox', reason: 'dup' })
      expect(result.released, `state=${status}`).toBe(false)
    }
  })

  it('returns ok=false when the order does not exist', async () => {
    const { client, spies } = buildAdminClient({
      order: { id: 'no', code: '', order_status: '', pharmacy_id: '', total_price: 0 },
      members: [],
    })
    // Override the order fetch to simulate a 404
    client.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'orders') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: null, error: { code: 'PGRST116' } }),
            }),
          }),
          update: spies.orderUpdate,
        }
      }
      throw new Error(`unexpected table ${table}`)
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await releaseOrderForExecution({ orderId: 'missing', reason: 'x' })
    expect(result.ok).toBe(false)
    expect(result.released).toBe(false)
    expect(spies.orderUpdate).not.toHaveBeenCalled()
  })
})
