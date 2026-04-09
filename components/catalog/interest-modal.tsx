'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Bell, Loader2, CheckCircle2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const schema = z.object({
  name: z.string().min(2, 'Nome é obrigatório'),
  whatsapp: z.string().min(8, 'WhatsApp inválido'),
})

type FormData = z.infer<typeof schema>

interface InterestModalProps {
  open: boolean
  onClose: () => void
  productId: string
  productName: string
}

export function InterestModal({ open, onClose, productId, productName }: InterestModalProps) {
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  async function onSubmit(data: FormData) {
    setLoading(true)
    try {
      const res = await fetch('/api/products/interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId, ...data }),
      })

      if (!res.ok) {
        toast.error('Erro ao registrar interesse. Tente novamente.')
        return
      }

      setDone(true)
    } catch {
      toast.error('Ocorreu um erro. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  function handleClose() {
    onClose()
    setTimeout(() => {
      setDone(false)
      reset()
    }, 300)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-amber-500" />
            Tenho interesse
          </DialogTitle>
          <DialogDescription>
            Deixe seus dados e entraremos em contato quando <strong>{productName}</strong> estiver
            disponível.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-500" />
            <p className="text-sm font-medium text-gray-700">Interesse registrado com sucesso!</p>
            <p className="text-xs text-gray-500">
              Nossa equipe entrará em contato assim que o produto estiver disponível.
            </p>
            <Button variant="outline" size="sm" onClick={handleClose} className="mt-2">
              Fechar
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="interest-name">Seu nome</Label>
              <Input
                id="interest-name"
                placeholder="Nome completo"
                {...register('name')}
                className={errors.name ? 'border-red-500' : ''}
              />
              {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="interest-whatsapp">WhatsApp</Label>
              <Input
                id="interest-whatsapp"
                placeholder="(11) 99999-9999"
                {...register('whatsapp')}
                className={errors.whatsapp ? 'border-red-500' : ''}
              />
              {errors.whatsapp && <p className="text-xs text-red-500">{errors.whatsapp.message}</p>}
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={handleClose}>
                Cancelar
              </Button>
              <Button type="submit" className="flex-1" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Enviando...
                  </>
                ) : (
                  'Registrar interesse'
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
