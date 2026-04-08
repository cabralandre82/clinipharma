import { Metadata } from 'next'
import { createClient } from '@/lib/db/server'
import { requireRolePage } from '@/lib/rbac'
import { SettingsForm } from '@/components/shared/settings-form'

export const metadata: Metadata = { title: 'Configurações' }

export default async function SettingsPage() {
  const user = await requireRolePage(['SUPER_ADMIN'])
  const supabase = await createClient()

  const { data: settings } = await supabase.from('app_settings').select('*').order('key')

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Configurações</h1>
        <p className="mt-0.5 text-sm text-gray-500">Parâmetros globais da plataforma</p>
      </div>
      <SettingsForm settings={settings ?? []} userId={user.id} />
    </div>
  )
}
