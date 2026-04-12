import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'

interface Recommendation {
  id: string
  name: string
  slug: string
  price_current: number
  category?: string
  confidence: number
  support: number
}

export function ProductRecommendations({ recommendations }: { recommendations: Recommendation[] }) {
  if (recommendations.length === 0) return null

  return (
    <section className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-5">
      <div className="mb-4 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-indigo-500" />
        <h3 className="text-sm font-semibold text-indigo-900">Frequentemente comprados juntos</h3>
        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-500">
          IA
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {recommendations.map((rec) => (
          <Link
            key={rec.id}
            href={`/catalog/${rec.slug}`}
            className="group flex flex-col rounded-lg border border-indigo-100 bg-white p-3 shadow-sm transition-shadow hover:shadow-md"
          >
            <span className="mb-1 text-[10px] font-medium tracking-wide text-indigo-400 uppercase">
              {rec.category ?? 'Produto'}
            </span>
            <span className="mb-2 line-clamp-2 text-sm font-medium text-gray-800 group-hover:text-indigo-700">
              {rec.name}
            </span>
            <span className="mt-auto text-sm font-semibold text-gray-900">
              {formatCurrency(rec.price_current)}
            </span>
            <span className="mt-1 text-[10px] text-gray-400">
              {Math.round(rec.confidence * 100)}% dos pedidos com este produto
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
