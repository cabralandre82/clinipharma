/**
 * Buyer-facing tier table — the "preço por quantidade" surface on
 * /catalog/[slug] for `pricing_mode='TIERED_PROFILE'` products.
 *
 * Tom suave (ANVISA RDC 67/2007)
 * --------------------------------
 * O diretor de vendas pediu que produtos manipulados (Tirzepatida
 * etc.) NÃO se apresentem como produtos industriais — não devem
 * exibir estoque, preço fixo "atacadista" ou linguagem de varejo.
 * Esta tabela:
 *   - usa "valor unitário sugerido" em vez de "preço";
 *   - separa explicitamente cada faixa em linhas de leitura
 *     orgânica, sem destaque comercial;
 *   - antecede a tabela com a nota magistral "Preparado conforme
 *     prescrição médica" para reforçar o caráter individualizado.
 *
 * É um componente puramente de apresentação (RSC). A interatividade
 * acontece no `<BuyerPriceSimulator/>` ao lado.
 */

import { Pill } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { formatTierRange, type BuyerTierRow } from '@/lib/pricing/buyer-tiers-shared'

interface BuyerTierTableProps {
  tiers: BuyerTierRow[]
  /** Optional: when set, this tier row is highlighted to mark
   *  "your current quantity falls in this bracket". */
  activeTierId?: string | null
  /** Magistral products carry a softer header. Industrial TIERED
   *  products (rare, but valid) skip the magistral copy. */
  isManipulated?: boolean
}

export function BuyerTierTable({
  tiers,
  activeTierId = null,
  isManipulated = false,
}: BuyerTierTableProps) {
  if (!tiers.length) return null

  return (
    <div className="rounded-2xl border border-blue-100 bg-blue-50/40 p-4">
      <div className="mb-3 flex items-start gap-2">
        <Pill className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-700" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-blue-900">
            {isManipulated ? 'Valor unitário sugerido' : 'Preço por quantidade'}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-blue-800/80">
            {isManipulated
              ? 'Preparado magistral conforme prescrição médica. O valor unitário varia conforme a quantidade pedida — confira a faixa abaixo antes de submeter.'
              : 'O valor unitário varia conforme a quantidade pedida.'}
          </p>
        </div>
      </div>

      <ul className="divide-y divide-blue-100/70 rounded-lg bg-white/60">
        {tiers.map((tier) => {
          const isActive = tier.id === activeTierId
          return (
            <li
              key={tier.id}
              className={`flex items-center justify-between px-3 py-2 text-sm ${
                isActive ? 'bg-blue-100/70 font-medium text-blue-900' : 'text-gray-700'
              }`}
              aria-current={isActive ? 'true' : undefined}
            >
              <span>{formatTierRange(tier)}</span>
              <span className="tabular-nums">{formatCurrency(tier.unit_price_cents / 100)}/un</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
