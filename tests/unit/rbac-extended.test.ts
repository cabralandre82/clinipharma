import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  hasRole,
  hasAnyRole,
  isAdmin,
  isSuperAdmin,
  isSalesConsultant,
  canManageClinic,
  canManagePharmacy,
} from '@/lib/rbac'
import type { ProfileWithRoles } from '@/types'

// Mock getCurrentUser so requireRole/requireRolePage can be tested
vi.mock('@/lib/auth/session', () => ({
  getCurrentUser: vi.fn(),
  requireAuth: vi.fn(),
  getSession: vi.fn(),
}))

function makeUser(roles: string[], opts: Partial<ProfileWithRoles> = {}): ProfileWithRoles {
  return {
    id: 'user-test',
    full_name: 'Test User',
    email: 'test@test.com',
    is_active: true,
    registration_status: 'APPROVED',
    notification_preferences: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    roles: roles as ProfileWithRoles['roles'],
    ...opts,
  }
}

describe('isSalesConsultant', () => {
  it('returns true for SALES_CONSULTANT', () => {
    expect(isSalesConsultant(makeUser(['SALES_CONSULTANT']))).toBe(true)
  })

  it('returns false for non-consultant roles', () => {
    expect(isSalesConsultant(makeUser(['CLINIC_ADMIN']))).toBe(false)
    expect(isSalesConsultant(makeUser(['SUPER_ADMIN']))).toBe(false)
  })
})

describe('canManageClinic', () => {
  it('admin can manage any clinic', () => {
    expect(canManageClinic(makeUser(['SUPER_ADMIN']), 'clinic-x', 'clinic-y')).toBe(true)
  })

  it('PLATFORM_ADMIN can manage any clinic', () => {
    expect(canManageClinic(makeUser(['PLATFORM_ADMIN']), 'clinic-x', 'clinic-z')).toBe(true)
  })

  it('CLINIC_ADMIN can manage own clinic', () => {
    expect(canManageClinic(makeUser(['CLINIC_ADMIN']), 'clinic-1', 'clinic-1')).toBe(true)
  })

  it('CLINIC_ADMIN cannot manage another clinic', () => {
    expect(canManageClinic(makeUser(['CLINIC_ADMIN']), 'clinic-1', 'clinic-2')).toBe(false)
  })

  it('CLINIC_ADMIN with no userClinicId cannot manage', () => {
    expect(canManageClinic(makeUser(['CLINIC_ADMIN']), 'clinic-1', undefined)).toBe(false)
  })

  it('PHARMACY_ADMIN cannot manage clinics', () => {
    expect(canManageClinic(makeUser(['PHARMACY_ADMIN']), 'clinic-1', 'clinic-1')).toBe(false)
  })
})

describe('canManagePharmacy', () => {
  it('admin can manage any pharmacy', () => {
    expect(canManagePharmacy(makeUser(['SUPER_ADMIN']), 'ph-1', 'ph-2')).toBe(true)
  })

  it('PHARMACY_ADMIN can manage own pharmacy', () => {
    expect(canManagePharmacy(makeUser(['PHARMACY_ADMIN']), 'ph-1', 'ph-1')).toBe(true)
  })

  it('PHARMACY_ADMIN cannot manage other pharmacy', () => {
    expect(canManagePharmacy(makeUser(['PHARMACY_ADMIN']), 'ph-1', 'ph-2')).toBe(false)
  })
})

describe('requireRole (via requireAuth mock)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns user when role is allowed', async () => {
    const session = await import('@/lib/auth/session')
    vi.mocked(session.requireAuth).mockResolvedValueOnce(makeUser(['SUPER_ADMIN']))

    const { requireRole } = await import('@/lib/rbac')
    const result = await requireRole(['SUPER_ADMIN'])
    expect(result.roles).toContain('SUPER_ADMIN')
  })

  it('throws FORBIDDEN when role is not allowed', async () => {
    const session = await import('@/lib/auth/session')
    vi.mocked(session.requireAuth).mockResolvedValueOnce(makeUser(['CLINIC_ADMIN']))

    const { requireRole } = await import('@/lib/rbac')
    await expect(requireRole(['SUPER_ADMIN'])).rejects.toThrow('FORBIDDEN')
  })

  it('throws UNAUTHORIZED when user is not logged in', async () => {
    const session = await import('@/lib/auth/session')
    vi.mocked(session.requireAuth).mockRejectedValueOnce(new Error('UNAUTHORIZED'))

    const { requireRole } = await import('@/lib/rbac')
    await expect(requireRole(['SUPER_ADMIN'])).rejects.toThrow('UNAUTHORIZED')
  })

  it('allows any of multiple allowed roles', async () => {
    const session = await import('@/lib/auth/session')
    vi.mocked(session.requireAuth).mockResolvedValueOnce(makeUser(['PLATFORM_ADMIN']))

    const { requireRole } = await import('@/lib/rbac')
    const result = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    expect(result.roles).toContain('PLATFORM_ADMIN')
  })
})

describe('requireRolePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects to /login when requireAuth throws (no session)', async () => {
    const session = await import('@/lib/auth/session')
    // requireRolePage calls requireAuth().catch(() => null) → null → redirect
    vi.mocked(session.requireAuth).mockRejectedValueOnce(new Error('UNAUTHORIZED'))

    const { requireRolePage } = await import('@/lib/rbac')
    await expect(requireRolePage(['SUPER_ADMIN'])).rejects.toThrow(/REDIRECT:\/login/)
  })

  it('redirects to /unauthorized when wrong role', async () => {
    const session = await import('@/lib/auth/session')
    vi.mocked(session.requireAuth).mockResolvedValueOnce(makeUser(['CLINIC_ADMIN']))

    const { requireRolePage } = await import('@/lib/rbac')
    await expect(requireRolePage(['SUPER_ADMIN'])).rejects.toThrow(/REDIRECT:\/unauthorized/)
  })

  it('returns user when role matches', async () => {
    const session = await import('@/lib/auth/session')
    vi.mocked(session.requireAuth).mockResolvedValueOnce(makeUser(['SUPER_ADMIN']))

    const { requireRolePage } = await import('@/lib/rbac')
    const result = await requireRolePage(['SUPER_ADMIN'])
    expect(result.roles).toContain('SUPER_ADMIN')
  })
})
