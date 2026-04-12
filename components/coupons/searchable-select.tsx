'use client'
import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Search, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SelectOption {
  id: string
  label: string
  sublabel?: string
}

interface Props {
  options: SelectOption[]
  value: string
  onChange: (id: string) => void
  placeholder: string
  disabled?: boolean
  className?: string
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  disabled,
  className,
}: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = options.find((o) => o.id === value)

  const filtered = search.trim()
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(search.toLowerCase()) ||
          o.sublabel?.toLowerCase().includes(search.toLowerCase())
      )
    : options

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function handleOpen() {
    if (disabled) return
    setOpen((v) => !v)
    // focus search input after state update
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  function handleSelect(id: string) {
    onChange(id)
    setOpen(false)
    setSearch('')
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={handleOpen}
        className={cn(
          'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors',
          'focus:ring-2 focus:ring-indigo-200 focus:outline-none',
          open ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-gray-300',
          disabled
            ? 'cursor-not-allowed bg-gray-50 text-gray-400'
            : 'bg-white hover:border-gray-400'
        )}
      >
        <span className={cn('truncate', !selected && 'text-gray-400')}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          className={cn(
            'ml-2 h-4 w-4 shrink-0 text-gray-400 transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
          {/* Search input */}
          <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar..."
              className="w-full text-sm outline-none placeholder:text-gray-400"
            />
          </div>

          {/* Options list */}
          <ul className="max-h-52 overflow-y-auto py-1">
            {!filtered.length ? (
              <li className="px-3 py-2.5 text-xs text-gray-400">Nenhum resultado encontrado</li>
            ) : (
              filtered.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(o.id)}
                    className={cn(
                      'flex w-full items-start gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-indigo-50',
                      value === o.id && 'bg-indigo-50'
                    )}
                  >
                    <Check
                      className={cn(
                        'mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-600',
                        value === o.id ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <span>
                      <span
                        className={cn('block', value === o.id && 'font-medium text-indigo-700')}
                      >
                        {o.label}
                      </span>
                      {o.sublabel && <span className="text-xs text-gray-400">{o.sublabel}</span>}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
