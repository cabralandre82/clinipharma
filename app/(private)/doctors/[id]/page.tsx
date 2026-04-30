import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRolePage } from '@/lib/rbac'
import { createAdminClient } from '@/lib/db/admin'
import { formatPhone, formatDate } from '@/lib/utils'
import { EntityStatusBadge } from '@/components/shared/status-badge'
import { ButtonLink } from '@/components/ui/button-link'
import { DoctorStatusActions } from '@/components/doctors/doctor-status-actions'
import { AssignConsultantToDoctorDialog } from '@/components/consultants/assign-consultant-to-doctor-dialog'
import { BackButton } from '@/components/ui/back-button'
import { logger } from '@/lib/logger'
import type { Doctor, EntityStatus, SalesConsultant } from '@/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Detalhe do Médico | Clinipharma' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function DoctorDetailPage({ params }: PageProps) {
  const { id } = await params
  const currentUser = await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN', 'CLINIC_ADMIN'])
  const isSuperAdmin = currentUser.roles.includes('SUPER_ADMIN')

  const supabase = createAdminClient()
  const { data: doctor } = await supabase.from('doctors').select('*').eq('id', id).single()

  if (!doctor) notFound()

  // CLINIC_ADMIN can only view doctors linked to their clinic
  if (
    currentUser.roles.includes('CLINIC_ADMIN') &&
    !currentUser.roles.some((r) => ['SUPER_ADMIN', 'PLATFORM_ADMIN'].includes(r))
  ) {
    const { data: membership } = await supabase
      .from('clinic_members')
      .select('clinic_id')
      .eq('user_id', currentUser.id)
      .single()
    if (membership) {
      const { data: link } = await supabase
        .from('doctor_clinic_links')
        .select('doctor_id')
        .eq('doctor_id', id)
        .eq('clinic_id', membership.clinic_id)
        .single()
      if (!link) notFound()
    }
  }

  const typedDoctor = doctor as unknown as Doctor

  const { data: linksRaw } = await supabase
    .from('doctor_clinic_links')
    .select('is_primary, clinics(id, trade_name)')
    .eq('doctor_id', id)

  const links = linksRaw as unknown as Array<{
    is_primary: boolean
    clinics: { id: string; trade_name: string } | null
  }>

  // Consultant assignment is super-admin only. Loaded eagerly so the
  // section renders both the current state ("linked to X") and the
  // dialog (with the picker populated). Errors are logged but do not
  // block the rest of the page — same defensive pattern used in
  // /clinics/[id] after the 2026-04-29 silent-empty-state regression.
  type ConsultantRow = Pick<SalesConsultant, 'id' | 'full_name' | 'status'>
  let linkedConsultant: ConsultantRow | null = null
  let allConsultants: ConsultantRow[] = []
  if (isSuperAdmin) {
    if (typedDoctor.consultant_id) {
      const { data: linked } = await supabase
        .from('sales_consultants')
        .select('id, full_name, status')
        .eq('id', typedDoctor.consultant_id)
        .single()
      linkedConsultant = (linked ?? null) as unknown as ConsultantRow | null
    }

    const { data: consultantsList, error: consultantsErr } = await supabase
      .from('sales_consultants')
      .select('id, full_name, status')
      .order('full_name')
    if (consultantsErr) {
      logger.error('[doctors/:id] failed to load consultants list', {
        doctorId: id,
        code: consultantsErr.code,
        message: consultantsErr.message,
      })
    }
    allConsultants = (consultantsList ?? []) as unknown as ConsultantRow[]
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <BackButton href="/doctors" label="Médicos" />
          <h1 className="mt-1 text-2xl font-bold text-gray-900">{typedDoctor.full_name}</h1>
          <p className="text-sm text-gray-500">
            CRM {typedDoctor.crm}/{typedDoctor.crm_state}
          </p>
        </div>
        <div className="flex gap-2">
          <DoctorStatusActions doctorId={id} currentStatus={typedDoctor.status as EntityStatus} />
          <ButtonLink href={`/doctors/${id}/edit`} variant="outline">
            Editar
          </ButtonLink>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4 rounded-lg border bg-white p-6">
          <h2 className="font-semibold text-gray-900">Informações</h2>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Status</dt>
              <dd>
                <EntityStatusBadge status={typedDoctor.status as EntityStatus} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">CRM</dt>
              <dd className="text-sm font-medium">
                {typedDoctor.crm}/{typedDoctor.crm_state}
              </dd>
            </div>
            {typedDoctor.specialty && (
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Especialidade</dt>
                <dd className="text-sm font-medium">{typedDoctor.specialty}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Email</dt>
              <dd className="text-sm font-medium">{typedDoctor.email}</dd>
            </div>
            {typedDoctor.phone && (
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Telefone</dt>
                <dd className="text-sm font-medium">{formatPhone(typedDoctor.phone)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Cadastrado em</dt>
              <dd className="text-sm font-medium">{formatDate(typedDoctor.created_at)}</dd>
            </div>
          </dl>
        </div>

        {links && links.length > 0 && (
          <div className="space-y-4 rounded-lg border bg-white p-6">
            <h2 className="font-semibold text-gray-900">Clínicas Vinculadas</h2>
            <div className="divide-y">
              {links.map((link, i) => (
                <div key={i} className="flex items-center justify-between py-3">
                  <Link
                    href={`/clinics/${link.clinics?.id}`}
                    className="text-primary text-sm font-medium hover:underline"
                  >
                    {link.clinics?.trade_name}
                  </Link>
                  {link.is_primary && (
                    <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
                      Principal
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {isSuperAdmin && (
          <div className="space-y-3 rounded-lg border bg-white p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Consultor de vendas</h2>
              <AssignConsultantToDoctorDialog
                doctorId={id}
                currentConsultantId={typedDoctor.consultant_id}
                consultants={allConsultants as unknown as SalesConsultant[]}
              />
            </div>
            {linkedConsultant ? (
              <div className="flex items-center justify-between rounded-lg bg-blue-50 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-blue-900">{linkedConsultant.full_name}</p>
                  <p className="text-xs text-blue-700">Taxa global configurada em Configurações</p>
                </div>
                <Link
                  href={`/consultants/${linkedConsultant.id}`}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Ver perfil
                </Link>
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                Nenhum consultor vinculado — comissão integral para a plataforma.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
