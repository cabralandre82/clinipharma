'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Send, AlertCircle, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createTicket } from '@/services/support'

const BODY_MAX = 2000

export function NewTicketForm() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  const bodyRemaining = BODY_MAX - body.length
  const bodyTooLong = body.length > BODY_MAX

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (bodyTooLong) {
      toast.error('Descrição muito longa')
      return
    }

    startTransition(async () => {
      const result = await createTicket({ title, body })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`Ticket ${result.code} aberto! Nossa equipe responderá em breve.`)
      router.push(`/support/${result.id}`)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* AI classification notice */}
      <div className="flex items-start gap-2.5 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" />
        <p className="text-xs text-indigo-700">
          Nossa IA analisa automaticamente seu ticket e classifica a categoria e prioridade com base
          no conteúdo. Você não precisa escolher — basta descrever o problema com detalhes.
        </p>
      </div>

      {/* Title */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="title">
            Assunto <span className="text-red-400">*</span>
          </Label>
          <span className="text-xs text-slate-400">{title.length}/120</span>
        </div>
        <Input
          id="title"
          placeholder="Resumo claro do problema em uma linha..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          required
          minLength={5}
          disabled={isPending}
        />
      </div>

      {/* Body */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="body">
            Descrição <span className="text-red-400">*</span>
          </Label>
          <span
            className={`text-xs ${bodyTooLong ? 'font-medium text-red-500' : 'text-slate-400'}`}
          >
            {bodyTooLong ? (
              <span className="flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {Math.abs(bodyRemaining)} caracteres a mais
              </span>
            ) : (
              `${body.length}/${BODY_MAX}`
            )}
          </span>
        </div>
        <Textarea
          id="body"
          placeholder="Descreva o problema com o máximo de detalhes. Se for sobre um pedido, informe o número. Se for financeiro, informe o valor e a data..."
          rows={8}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          minLength={10}
          disabled={isPending}
          className={bodyTooLong ? 'border-red-300 focus:ring-red-400' : ''}
        />
        <p className="text-xs text-slate-400">
          💡 Quanto mais detalhes você fornecer, mais rápido nossa equipe consegue ajudar.
        </p>
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={isPending || bodyTooLong} className="gap-2">
          <Send className="h-4 w-4" />
          {isPending ? 'Abrindo ticket…' : 'Abrir ticket'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={isPending}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
