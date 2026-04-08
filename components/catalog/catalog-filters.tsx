'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search, X } from 'lucide-react'
import { useCallback, useState } from 'react'

interface CatalogFiltersProps {
  categories: { id: string; name: string; slug: string }[]
  pharmacies: { id: string; trade_name: string }[]
  currentCategory?: string
  currentPharmacy?: string
  currentSearch?: string
}

export function CatalogFilters({
  categories,
  pharmacies,
  currentCategory,
  currentPharmacy,
  currentSearch,
}: CatalogFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [search, setSearch] = useState(currentSearch ?? '')

  const updateFilter = useCallback(
    (key: string, value: string | undefined) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) {
        params.set(key, value)
      } else {
        params.delete(key)
      }
      router.push(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams]
  )

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    updateFilter('search', search || undefined)
  }

  const clearAll = () => {
    setSearch('')
    router.push(pathname)
  }

  const hasFilters = currentCategory || currentPharmacy || currentSearch

  return (
    <div className="space-y-3">
      {/* Search bar */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            type="text"
            placeholder="Buscar por nome, concentração..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="outline">
          Buscar
        </Button>
        {hasFilters && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={clearAll}
            title="Limpar filtros"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </form>

      {/* Category filters */}
      <div className="flex flex-wrap gap-2">
        <span className="mr-1 self-center text-xs text-gray-500">Categoria:</span>
        <button
          onClick={() => updateFilter('category', undefined)}
          className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
            !currentCategory
              ? 'border-[hsl(213,75%,24%)] bg-[hsl(213,75%,24%)] text-white'
              : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'
          }`}
        >
          Todos
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() =>
              updateFilter('category', cat.slug === currentCategory ? undefined : cat.slug)
            }
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              currentCategory === cat.slug
                ? 'border-[hsl(213,75%,24%)] bg-[hsl(213,75%,24%)] text-white'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Pharmacy filters */}
      {pharmacies.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <span className="mr-1 self-center text-xs text-gray-500">Farmácia:</span>
          <button
            onClick={() => updateFilter('pharmacy', undefined)}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              !currentPharmacy
                ? 'border-[hsl(196,91%,36%)] bg-[hsl(196,91%,36%)] text-white'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'
            }`}
          >
            Todas
          </button>
          {pharmacies.map((ph) => (
            <button
              key={ph.id}
              onClick={() =>
                updateFilter('pharmacy', ph.id === currentPharmacy ? undefined : ph.id)
              }
              className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                currentPharmacy === ph.id
                  ? 'border-[hsl(196,91%,36%)] bg-[hsl(196,91%,36%)] text-white'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'
              }`}
            >
              {ph.trade_name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
