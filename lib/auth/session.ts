import { createClient } from '@/lib/db/server'
import type { ProfileWithRoles, UserRole } from '@/types'

export async function getSession() {
  const supabase = await createClient()
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession()

  if (error || !session) return null
  return session
}

export async function getCurrentUser(): Promise<ProfileWithRoles | null> {
  const supabase = await createClient()

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) return null

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()

  if (!profile) return null

  const { data: rolesData } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)

  const roles: UserRole[] = (rolesData ?? []).map((r) => r.role as UserRole)

  return { ...profile, roles }
}

export async function requireAuth(): Promise<ProfileWithRoles> {
  const user = await getCurrentUser()
  if (!user) {
    throw new Error('UNAUTHORIZED')
  }
  return user
}
