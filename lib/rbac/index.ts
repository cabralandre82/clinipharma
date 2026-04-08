import { requireAuth } from '@/lib/auth/session'
import type { ProfileWithRoles, UserRole } from '@/types'
import { redirect } from 'next/navigation'

export function hasRole(user: ProfileWithRoles, role: UserRole): boolean {
  return user.roles.includes(role)
}

export function hasAnyRole(user: ProfileWithRoles, roles: UserRole[]): boolean {
  return roles.some((r) => user.roles.includes(r))
}

export function isAdmin(user: ProfileWithRoles): boolean {
  return hasAnyRole(user, ['SUPER_ADMIN', 'PLATFORM_ADMIN'])
}

export function isSuperAdmin(user: ProfileWithRoles): boolean {
  return hasRole(user, 'SUPER_ADMIN')
}

/**
 * Server-side guard. Throws error if user doesn't have required role.
 * Use in Server Actions and Route Handlers.
 */
export async function requireRole(allowedRoles: UserRole[]): Promise<ProfileWithRoles> {
  const user = await requireAuth()

  if (!hasAnyRole(user, allowedRoles)) {
    throw new Error('FORBIDDEN')
  }

  return user
}

/**
 * Server-side page guard. Redirects to /unauthorized if user doesn't have role.
 * Use in page.tsx Server Components.
 */
export async function requireRolePage(allowedRoles: UserRole[]): Promise<ProfileWithRoles> {
  const user = await requireAuth().catch(() => null)

  if (!user) {
    redirect('/login')
  }

  if (!hasAnyRole(user, allowedRoles)) {
    redirect('/unauthorized')
  }

  return user
}

/**
 * Checks if user can manage a specific clinic.
 */
export function canManageClinic(
  user: ProfileWithRoles,
  clinicId: string,
  userClinicId?: string
): boolean {
  if (isAdmin(user)) return true
  if (hasRole(user, 'CLINIC_ADMIN') && clinicId === userClinicId) return true
  return false
}

/**
 * Checks if user can manage a specific pharmacy.
 */
export function canManagePharmacy(
  user: ProfileWithRoles,
  pharmacyId: string,
  userPharmacyId?: string
): boolean {
  if (isAdmin(user)) return true
  if (hasRole(user, 'PHARMACY_ADMIN') && pharmacyId === userPharmacyId) return true
  return false
}
