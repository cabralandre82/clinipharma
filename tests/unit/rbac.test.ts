import { describe, it, expect } from 'vitest'
import { hasRole, hasAnyRole, isAdmin, isSuperAdmin } from '@/lib/rbac'
import type { ProfileWithRoles } from '@/types'

function makeUser(roles: string[]): ProfileWithRoles {
  return {
    id: 'test-id',
    full_name: 'Test User',
    email: 'test@test.com',
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    roles: roles as ProfileWithRoles['roles'],
  }
}

describe('hasRole', () => {
  it('returns true when user has the role', () => {
    const user = makeUser(['PLATFORM_ADMIN'])
    expect(hasRole(user, 'PLATFORM_ADMIN')).toBe(true)
  })

  it('returns false when user does not have the role', () => {
    const user = makeUser(['CLINIC_ADMIN'])
    expect(hasRole(user, 'PLATFORM_ADMIN')).toBe(false)
  })
})

describe('hasAnyRole', () => {
  it('returns true if user has at least one of the roles', () => {
    const user = makeUser(['CLINIC_ADMIN'])
    expect(hasAnyRole(user, ['SUPER_ADMIN', 'CLINIC_ADMIN'])).toBe(true)
  })

  it('returns false if user has none of the roles', () => {
    const user = makeUser(['DOCTOR'])
    expect(hasAnyRole(user, ['SUPER_ADMIN', 'PLATFORM_ADMIN'])).toBe(false)
  })
})

describe('isAdmin', () => {
  it('returns true for SUPER_ADMIN', () => {
    expect(isAdmin(makeUser(['SUPER_ADMIN']))).toBe(true)
  })

  it('returns true for PLATFORM_ADMIN', () => {
    expect(isAdmin(makeUser(['PLATFORM_ADMIN']))).toBe(true)
  })

  it('returns false for CLINIC_ADMIN', () => {
    expect(isAdmin(makeUser(['CLINIC_ADMIN']))).toBe(false)
  })

  it('returns false for DOCTOR', () => {
    expect(isAdmin(makeUser(['DOCTOR']))).toBe(false)
  })

  it('returns false for PHARMACY_ADMIN', () => {
    expect(isAdmin(makeUser(['PHARMACY_ADMIN']))).toBe(false)
  })
})

describe('isSuperAdmin', () => {
  it('returns true only for SUPER_ADMIN', () => {
    expect(isSuperAdmin(makeUser(['SUPER_ADMIN']))).toBe(true)
    expect(isSuperAdmin(makeUser(['PLATFORM_ADMIN']))).toBe(false)
  })
})
