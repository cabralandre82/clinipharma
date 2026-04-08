'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Save } from 'lucide-react'
import { updateSetting } from '@/services/settings'

interface AppSetting {
  id: string
  key: string
  value_json: unknown
  description: string | null
}

interface SettingsFormProps {
  settings: AppSetting[]
  userId: string
}

export function SettingsForm({ settings, userId }: SettingsFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(
      settings.map((s) => [
        s.key,
        typeof s.value_json === 'string'
          ? s.value_json.replace(/^"|"$/g, '')
          : String(s.value_json),
      ])
    )
  )

  async function handleSave() {
    setLoading(true)
    try {
      for (const setting of settings) {
        const newValue = values[setting.key]
        if (newValue !== undefined) {
          await updateSetting(setting.key, newValue, userId)
        }
      }
      toast.success('Configurações salvas!')
      router.refresh()
    } catch {
      toast.error('Erro ao salvar configurações')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Parâmetros financeiros</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {settings.map((setting) => (
            <div key={setting.key} className="space-y-1.5">
              <Label htmlFor={setting.key}>
                {setting.key === 'default_commission_percentage'
                  ? 'Comissão padrão (%)'
                  : setting.key}
              </Label>
              {setting.description && (
                <p className="text-xs text-gray-500">{setting.description}</p>
              )}
              <Input
                id={setting.key}
                value={values[setting.key] ?? ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [setting.key]: e.target.value }))}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={loading}>
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Salvando...
          </>
        ) : (
          <>
            <Save className="mr-2 h-4 w-4" />
            Salvar configurações
          </>
        )}
      </Button>
    </div>
  )
}
