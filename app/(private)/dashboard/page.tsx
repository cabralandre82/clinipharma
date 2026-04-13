import { Metadata } from 'next'
import { getCurrentUser } from '@/lib/auth/session'
import { redirect } from 'next/navigation'
import { AdminDashboard } from '@/components/dashboard/admin-dashboard'

export const dynamic = 'force-dynamic'
import { ClinicDashboard } from '@/components/dashboard/clinic-dashboard'
import { DoctorDashboard } from '@/components/dashboard/doctor-dashboard'
import { PharmacyDashboard } from '@/components/dashboard/pharmacy-dashboard'
import { ConsultantDashboard } from '@/components/dashboard/consultant-dashboard'
import { RegistrationStatusBanner } from '@/components/dashboard/registration-status-banner'

export const metadata: Metadata = {
  title: 'Dashboard',
}

export default async function DashboardPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const primaryRole = user.roles[0]
  const regStatus = user.registration_status ?? 'APPROVED'

  const banner =
    regStatus !== 'APPROVED' ? (
      <div className="mb-6">
        <RegistrationStatusBanner status={regStatus} />
      </div>
    ) : null

  if (primaryRole === 'SUPER_ADMIN' || primaryRole === 'PLATFORM_ADMIN') {
    return <AdminDashboard user={user} />
  }

  if (primaryRole === 'CLINIC_ADMIN') {
    return (
      <>
        {banner}
        <ClinicDashboard user={user} />
      </>
    )
  }

  if (primaryRole === 'DOCTOR') {
    return (
      <>
        {banner}
        <DoctorDashboard user={user} />
      </>
    )
  }

  if (primaryRole === 'PHARMACY_ADMIN') {
    return (
      <>
        {banner}
        <PharmacyDashboard user={user} />
      </>
    )
  }

  if (primaryRole === 'SALES_CONSULTANT') {
    return <ConsultantDashboard user={user} />
  }

  redirect('/unauthorized')
}
