import { Sidebar } from './sidebar'
import { Header } from './header'
import type { ProfileWithRoles } from '@/types'

interface ShellProps {
  user: ProfileWithRoles
  title?: string
  children: React.ReactNode
}

export function Shell({ user, title, children }: ShellProps) {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar userRoles={user.roles} />
      <div className="ml-64 flex min-h-screen flex-1 flex-col">
        <Header user={user} title={title} />
        <main id="main" className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
