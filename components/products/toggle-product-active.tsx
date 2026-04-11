'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { toggleProductActive } from '@/services/products'
import { Eye, EyeOff } from 'lucide-react'

interface Props {
  productId: string
  active: boolean
}

export function ToggleProductActive({ productId, active }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleToggle() {
    setLoading(true)
    const result = await toggleProductActive(productId, !active)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success(active ? 'Produto desativado.' : 'Produto ativado.')
      router.refresh()
    }
    setLoading(false)
  }

  return (
    <Button variant="outline" size="sm" onClick={handleToggle} disabled={loading}>
      {active ? (
        <>
          <EyeOff className="mr-2 h-4 w-4" />
          Desativar
        </>
      ) : (
        <>
          <Eye className="mr-2 h-4 w-4" />
          Ativar
        </>
      )}
    </Button>
  )
}
