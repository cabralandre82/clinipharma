'use client'

import { useState } from 'react'
import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { MessageSquare, Clock, User } from 'lucide-react'

interface Ticket {
  id: string
  code: string
  title: string
  category: string
  priority: string
  status: string
  created_at: string
  updated_at: string
  created_by: { id: string; full_name: string } | null
  assigned_to: { id: string; full_name: string } | null
}

interface TicketListProps {
  tickets: Ticket[]
  isAdmin: boolean
  categoryLabels: Record<string, string>
  statusLabels: Record<string, string>
  statusColors: Record<string, string>
  priorityLabels: Record<string, string>
  priorityColors: Record<string, string>
}

const STATUS_FILTERS = ['TODOS', 'OPEN', 'IN_PROGRESS', 'WAITING_CLIENT', 'RESOLVED', 'CLOSED']

export function TicketList({
  tickets,
  isAdmin,
  categoryLabels,
  statusLabels,
  statusColors,
  priorityLabels,
  priorityColors,
}: TicketListProps) {
  const [filter, setFilter] = useState('TODOS')

  const filtered = filter === 'TODOS' ? tickets : tickets.filter((t) => t.status === filter)

  const counts: Record<string, number> = { TODOS: tickets.length }
  for (const t of tickets) counts[t.status] = (counts[t.status] ?? 0) + 1

  return (
    <div className="space-y-4">
      {/* Status filter tabs */}
      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === s
                ? 'bg-primary text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {s === 'TODOS' ? 'Todos' : statusLabels[s]}
            {(counts[s] ?? 0) > 0 && <span className="ml-1.5 opacity-70">{counts[s]}</span>}
          </button>
        ))}
      </div>

      {/* Ticket table */}
      <div className="overflow-hidden rounded-xl border bg-white">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-400">
            {filter === 'TODOS'
              ? 'Nenhum ticket ainda. Clique em "Abrir ticket" para começar.'
              : `Nenhum ticket com status "${statusLabels[filter] ?? filter}".`}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left text-xs font-semibold tracking-wider text-slate-500 uppercase">
                <th className="px-4 py-3">Ticket</th>
                {isAdmin && <th className="hidden px-4 py-3 md:table-cell">Solicitante</th>}
                <th className="hidden px-4 py-3 sm:table-cell">Categoria</th>
                <th className="px-4 py-3">Status</th>
                <th className="hidden px-4 py-3 lg:table-cell">Prioridade</th>
                <th className="hidden px-4 py-3 md:table-cell">Atualizado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((ticket) => (
                <tr key={ticket.id} className="transition-colors hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <Link href={`/support/${ticket.id}`} className="group block">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="group-hover:text-primary h-4 w-4 shrink-0 text-slate-300" />
                        <div>
                          <p className="group-hover:text-primary font-medium text-slate-900">
                            {ticket.title}
                          </p>
                          <p className="font-mono text-[11px] text-slate-400">{ticket.code}</p>
                        </div>
                      </div>
                    </Link>
                  </td>
                  {isAdmin && (
                    <td className="hidden px-4 py-3 md:table-cell">
                      <div className="flex items-center gap-1.5 text-xs text-slate-600">
                        <User className="h-3.5 w-3.5 text-slate-300" />
                        {ticket.created_by?.full_name ?? '—'}
                      </div>
                      {ticket.assigned_to && (
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          Atendendo: {ticket.assigned_to.full_name}
                        </p>
                      )}
                    </td>
                  )}
                  <td className="hidden px-4 py-3 sm:table-cell">
                    <span className="text-xs text-slate-500">
                      {categoryLabels[ticket.category] ?? ticket.category}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      className={`text-xs ${statusColors[ticket.status] ?? 'bg-slate-100 text-slate-500'}`}
                    >
                      {statusLabels[ticket.status] ?? ticket.status}
                    </Badge>
                  </td>
                  <td className="hidden px-4 py-3 lg:table-cell">
                    <Badge
                      className={`text-xs ${priorityColors[ticket.priority] ?? 'bg-slate-100'}`}
                    >
                      {priorityLabels[ticket.priority] ?? ticket.priority}
                    </Badge>
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">
                    <div className="flex items-center gap-1 text-xs text-slate-400">
                      <Clock className="h-3.5 w-3.5" />
                      {formatDate(ticket.updated_at)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
