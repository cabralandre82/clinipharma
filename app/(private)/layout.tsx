import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { Shell } from '@/components/layout/shell'

export default async function PrivateLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/login')
  }

  if (!user.is_active) {
    redirect('/unauthorized')
  }

  return <Shell user={user}>{children}</Shell>
}
