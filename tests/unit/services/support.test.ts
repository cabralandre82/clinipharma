import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeQueryBuilder } from '../../setup'
import * as adminModule from '@/lib/db/admin'
import * as sessionModule from '@/lib/auth/session'
import * as notificationsModule from '@/lib/notifications'
import * as rbacModule from '@/lib/rbac'
import {
  createTicket,
  addMessage,
  updateTicketStatus,
  updateTicketPriority,
} from '@/services/support'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/auth/session', () => ({ requireAuth: vi.fn(), getCurrentUser: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
vi.mock('@/lib/notifications', () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
  createNotificationForRole: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/rbac', () => ({ requireRole: vi.fn() }))

const clientMock = {
  id: 'user-client',
  roles: ['CLINIC_ADMIN'] as ['CLINIC_ADMIN'],
  full_name: 'Clinic User',
  email: 'clinic@test.com',
  is_active: true,
  registration_status: 'APPROVED' as const,
  notification_preferences: {},
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
}

const adminMock = {
  id: 'user-admin',
  roles: ['SUPER_ADMIN'] as ['SUPER_ADMIN'],
  full_name: 'Admin User',
  email: 'admin@test.com',
  is_active: true,
  registration_status: 'APPROVED' as const,
  notification_preferences: {},
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
}

function mockAdmin(fromImpl: (table: string) => unknown) {
  const admin = { from: vi.fn().mockImplementation(fromImpl) }
  vi.mocked(adminModule.createAdminClient).mockReturnValue(
    admin as unknown as ReturnType<typeof adminModule.createAdminClient>
  )
  return admin
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── createTicket ─────────────────────────────────────────────────────────────

describe('createTicket', () => {
  it('returns ticket id and code on success', async () => {
    vi.mocked(sessionModule.requireAuth).mockResolvedValue(clientMock)

    const ticketQb = makeQueryBuilder({ id: 'ticket-1', code: 'TKT-2026-00001' }, null)
    ticketQb.single = vi.fn().mockResolvedValue({
      data: { id: 'ticket-1', code: 'TKT-2026-00001' },
      error: null,
    })
    const msgQb = makeQueryBuilder(null, null)

    let call = 0
    mockAdmin(() => {
      call++
      return call === 1 ? ticketQb : msgQb
    })

    const result = await createTicket({
      title: 'Problema no pedido',
      category: 'ORDER',
      body: 'Meu pedido não chegou após 5 dias.',
    })

    expect(result.id).toBe('ticket-1')
    expect(result.code).toBe('TKT-2026-00001')
    expect(result.error).toBeUndefined()
    expect(notificationsModule.createNotificationForRole).toHaveBeenCalledWith(
      'SUPER_ADMIN',
      expect.objectContaining({ type: 'SUPPORT_TICKET' })
    )
  })

  it('returns validation error for short title', async () => {
    vi.mocked(sessionModule.requireAuth).mockResolvedValue(clientMock)
    mockAdmin(() => makeQueryBuilder(null, null))

    const result = await createTicket({
      title: 'Hi',
      category: 'GENERAL',
      body: 'Some body text with enough length.',
    })

    expect(result.error).toMatch(/ao menos 5 caracteres/)
  })

  it('returns error when ticket insert fails', async () => {
    vi.mocked(sessionModule.requireAuth).mockResolvedValue(clientMock)

    const failQb = makeQueryBuilder(null, { message: 'db error' })
    failQb.single = vi.fn().mockResolvedValue({ data: null, error: { message: 'db error' } })

    mockAdmin(() => failQb)

    const result = await createTicket({
      title: 'Valid title here',
      category: 'TECHNICAL',
      body: 'Descreva o problema aqui com detalhes.',
    })

    expect(result.error).toBe('Erro ao abrir ticket')
  })

  it('returns session error for unauthenticated user', async () => {
    vi.mocked(sessionModule.requireAuth).mockRejectedValue(new Error('UNAUTHORIZED'))
    mockAdmin(() => makeQueryBuilder(null, null))

    const result = await createTicket({
      title: 'Valid title here',
      category: 'GENERAL',
      body: 'Some body text to test session expiry.',
    })

    expect(result.error).toBe('Sessão expirada')
  })
})

// ─── addMessage ───────────────────────────────────────────────────────────────

describe('addMessage', () => {
  const TID_1 = 'aaaaaaaa-0001-4000-8000-000000000001'
  const TID_2 = 'aaaaaaaa-0002-4000-8000-000000000002'
  const TID_3 = 'aaaaaaaa-0003-4000-8000-000000000003'
  const TID_4 = 'aaaaaaaa-0004-4000-8000-000000000004'

  it('client can reply to own open ticket', async () => {
    vi.mocked(sessionModule.requireAuth).mockResolvedValue(clientMock)

    const ticketRow = {
      id: TID_1,
      code: 'TKT-2026-00001',
      title: 'Problema',
      created_by_user_id: 'user-client',
      assigned_to_user_id: null,
      status: 'OPEN',
    }
    const fetchQb = makeQueryBuilder(ticketRow, null)
    fetchQb.single = vi.fn().mockResolvedValue({ data: ticketRow, error: null })
    const insertQb = makeQueryBuilder(null, null)
    const updateQb = makeQueryBuilder(null, null)

    let call = 0
    mockAdmin(() => {
      call++
      if (call === 1) return fetchQb
      if (call === 2) return insertQb
      return updateQb
    })

    const result = await addMessage({ ticket_id: TID_1, body: 'Obrigado pela resposta.' })
    expect(result.error).toBeUndefined()
  })

  it('client cannot reply to resolved ticket', async () => {
    vi.mocked(sessionModule.requireAuth).mockResolvedValue(clientMock)

    const ticketRow = {
      id: TID_2,
      code: 'TKT-2026-00002',
      title: 'Resolvido',
      created_by_user_id: 'user-client',
      assigned_to_user_id: null,
      status: 'RESOLVED',
    }
    const fetchQb = makeQueryBuilder(ticketRow, null)
    fetchQb.single = vi.fn().mockResolvedValue({ data: ticketRow, error: null })

    mockAdmin(() => fetchQb)

    const result = await addMessage({ ticket_id: TID_2, body: 'Teste' })
    expect(result.error).toBe('Este ticket já foi encerrado')
  })

  it('client cannot post internal notes', async () => {
    vi.mocked(sessionModule.requireAuth).mockResolvedValue(clientMock)
    mockAdmin(() => makeQueryBuilder(null, null))

    const result = await addMessage({
      ticket_id: TID_1,
      body: 'Internal note',
      is_internal: true,
    })
    expect(result.error).toBe('Sem permissão')
  })

  it('admin auto-assigns on first reply', async () => {
    vi.mocked(sessionModule.requireAuth).mockResolvedValue(adminMock)

    const ticketRow = {
      id: TID_3,
      code: 'TKT-2026-00003',
      title: 'Novo',
      created_by_user_id: 'user-client',
      assigned_to_user_id: null,
      status: 'OPEN',
    }
    const fetchQb = makeQueryBuilder(ticketRow, null)
    fetchQb.single = vi.fn().mockResolvedValue({ data: ticketRow, error: null })
    const insertQb = makeQueryBuilder(null, null)
    const assignQb = makeQueryBuilder(null, null)

    let call = 0
    const admin = mockAdmin(() => {
      call++
      if (call === 1) return fetchQb
      if (call === 2) return insertQb
      return assignQb
    })

    const result = await addMessage({ ticket_id: TID_3, body: 'Olá, vou ajudá-lo.' })
    expect(result.error).toBeUndefined()
    // fetch ticket, insert message, auto-assign (3 from() calls)
    expect(admin.from).toHaveBeenCalledTimes(3)
  })

  it('returns error when message insert fails', async () => {
    vi.mocked(sessionModule.requireAuth).mockResolvedValue(clientMock)

    const ticketRow = {
      id: TID_4,
      code: 'TKT-2026-00004',
      title: 'Falha',
      created_by_user_id: 'user-client',
      assigned_to_user_id: null,
      status: 'IN_PROGRESS',
    }
    const fetchQb = makeQueryBuilder(ticketRow, null)
    fetchQb.single = vi.fn().mockResolvedValue({ data: ticketRow, error: null })
    const failQb = makeQueryBuilder(null, { message: 'insert failed' })

    let call = 0
    mockAdmin(() => {
      call++
      return call === 1 ? fetchQb : failQb
    })

    const result = await addMessage({ ticket_id: TID_4, body: 'Teste' })
    expect(result.error).toBe('Erro ao enviar mensagem')
  })
})

// ─── updateTicketStatus ────────────────────────────────────────────────────────

describe('updateTicketStatus', () => {
  it('updates status and notifies creator on RESOLVED', async () => {
    vi.mocked(rbacModule.requireRole).mockResolvedValue(adminMock)

    const updateQb = makeQueryBuilder(null, null)
    const ticketRow = {
      created_by_user_id: 'user-client',
      code: 'TKT-2026-00001',
      title: 'Problema',
    }
    const fetchQb = makeQueryBuilder(ticketRow, null)
    fetchQb.single = vi.fn().mockResolvedValue({ data: ticketRow, error: null })

    let call = 0
    mockAdmin(() => {
      call++
      return call === 1 ? updateQb : fetchQb
    })

    const result = await updateTicketStatus('ticket-1', 'RESOLVED')
    expect(result.error).toBeUndefined()
    expect(notificationsModule.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SUPPORT_RESOLVED', userId: 'user-client' })
    )
  })

  it('returns error when update fails', async () => {
    vi.mocked(rbacModule.requireRole).mockResolvedValue(adminMock)

    const failQb = makeQueryBuilder(null, { message: 'db error' })
    mockAdmin(() => failQb)

    const result = await updateTicketStatus('ticket-1', 'CLOSED')
    expect(result.error).toBe('Erro ao atualizar status')
  })
})

// ─── updateTicketPriority ──────────────────────────────────────────────────────

describe('updateTicketPriority', () => {
  it('updates priority successfully', async () => {
    vi.mocked(rbacModule.requireRole).mockResolvedValue(adminMock)

    const updateQb = makeQueryBuilder(null, null)
    mockAdmin(() => updateQb)

    const result = await updateTicketPriority('ticket-1', 'HIGH')
    expect(result.error).toBeUndefined()
  })

  it('returns error when update fails', async () => {
    vi.mocked(rbacModule.requireRole).mockResolvedValue(adminMock)

    const failQb = makeQueryBuilder(null, { message: 'db error' })
    mockAdmin(() => failQb)

    const result = await updateTicketPriority('ticket-1', 'URGENT')
    expect(result.error).toBe('Erro ao atualizar prioridade')
  })
})
