'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { deactivateUser, reactivateUser } from '@/services/users'
import { UserX, UserCheck } from 'lucide-react'

interface Props {
  userId: string
  userName: string
  isBanned: boolean
}

export function DeactivateUserDialog({ userId, userName, isBanned }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleConfirm() {
    setLoading(true)
    const result = isBanned ? await reactivateUser(userId) : await deactivateUser(userId)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success(isBanned ? 'Usuário reativado com sucesso.' : 'Usuário desativado com sucesso.')
      setOpen(false)
      router.refresh()
    }
    setLoading(false)
  }

  if (isBanned) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button variant="outline" size="sm" />}>
          <UserCheck className="mr-2 h-4 w-4 text-green-600" />
          Reativar usuário
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reativar usuário — {userName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              O usuário <strong>{userName}</strong> está atualmente{' '}
              <span className="font-semibold text-red-600">desativado</span>. Ao reativar, ele
              poderá fazer login novamente.
            </p>
            <div className="flex gap-3">
              <Button onClick={handleConfirm} disabled={loading}>
                {loading ? 'Reativando...' : 'Confirmar reativação'}
              </Button>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <UserX className="mr-2 h-4 w-4 text-red-600" />
        Desativar usuário
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Desativar usuário — {userName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            O usuário <strong>{userName}</strong> será impedido de fazer login imediatamente. Todos
            os tokens ativos serão revogados. Os dados do usuário são preservados.
          </p>
          <div className="rounded-md border border-red-200 bg-red-50 p-3">
            <p className="text-xs text-red-700">
              Esta ação pode ser desfeita a qualquer momento reativando o usuário.
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="destructive" onClick={handleConfirm} disabled={loading}>
              {loading ? 'Desativando...' : 'Confirmar desativação'}
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
