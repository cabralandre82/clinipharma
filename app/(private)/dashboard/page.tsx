import { Metadata } from 'next'
import { getCurrentUser } from '@/lib/auth/session'
import { redirect } from 'next/navigation'
import { AdminDashboard } from '@/components/dashboard/admin-dashboard'
import { ClinicDashboard } from '@/components/dashboard/clinic-dashboard'
import { DoctorDashboard } from '@/components/dashboard/doctor-dashboard'
import { PharmacyDashboard } from '@/components/dashboard/pharmacy-dashboard'

export const metadata: Metadata = {
  title: 'Dashboard',
}

export default async function DashboardPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const primaryRole = user.roles[0]

  if (primaryRole === 'SUPER_ADMIN' || primaryRole === 'PLATFORM_ADMIN') {
    return <AdminDashboard user={user} />
  }

  if (primaryRole === 'CLINIC_ADMIN') {
    return <ClinicDashboard user={user} />
  }

  if (primaryRole === 'DOCTOR') {
    return <DoctorDashboard user={user} />
  }

  if (primaryRole === 'PHARMACY_ADMIN') {
    return <PharmacyDashboard user={user} />
  }

  redirect('/unauthorized')
}
