'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronDown } from 'lucide-react'
import { updateDoctorStatus } from '@/services/doctors'
import type { EntityStatus } from '@/types'

const transitions: Partial<Record<EntityStatus, EntityStatus[]>> = {
  PENDING: ['ACTIVE', 'INACTIVE'],
  ACTIVE: ['INACTIVE', 'SUSPENDED'],
  INACTIVE: ['ACTIVE', 'SUSPENDED'],
  SUSPENDED: ['ACTIVE', 'INACTIVE'],
  BLOCKED: ['ACTIVE'],
}

const statusLabels: Partial<Record<EntityStatus, string>> = {
  ACTIVE: 'Ativar',
  INACTIVE: 'Inativar',
  SUSPENDED: 'Suspender',
  BLOCKED: 'Bloquear',
}

interface Props {
  doctorId: string
  currentStatus: EntityStatus
}

export function DoctorStatusActions({ doctorId, currentStatus }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const available: EntityStatus[] = transitions[currentStatus] ?? []

  if (available.length === 0) return null

  async function handleStatus(status: EntityStatus) {
    setLoading(true)
    const result = await updateDoctorStatus(doctorId, status)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Status atualizado!')
      router.refresh()
    }
    setLoading(false)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" disabled={loading} />}>
        Alterar status <ChevronDown className="ml-1 h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {available.map((status) => (
          <DropdownMenuItem key={status} onClick={() => handleStatus(status)}>
            {statusLabels[status] ?? status}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
