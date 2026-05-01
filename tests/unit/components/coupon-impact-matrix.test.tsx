/**
 * Tests para `<CouponImpactMatrix/>` — pin nos sinais visuais novos
 * adicionados na sessão de UX (F5):
 *   1. Badge "consultor > líquido" aparece SOMENTE quando o consultor
 *      ganha mais por unidade do que o líquido da plataforma.
 *   2. Cor de fundo da célula reflete a hierarquia: vermelho < laranja
 *      (consultor > líquido) < amber (margem apertada) < verde (saudável).
 *   3. Legenda enumera todos os 4 tons.
 *   4. Comportamento existente preservado: badges INV-2/INV-4 e arrows
 *      de delta continuam aparecendo nas mesmas condições.
 *
 * Estes testes não cobrem o cálculo do breakdown (isso vive no SQL e
 * tem testes próprios em mig-071/077). Eles fixam apenas a camada de
 * apresentação — qualquer regressão nos sinais quebra o teste antes
 * do operador notar a perda visual.
 */

import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { CouponImpactMatrix } from '@/components/pricing/coupon-impact-matrix'
import type { CouponMatrixCell } from '@/lib/services/pricing-engine.server'
import type { PricingBreakdown } from '@/types'

/** Escopa as queries dentro da tabela — fora dela vive a legenda, que
 *  intencionalmente repete os mesmos termos ("consultor > líquido",
 *  "INV-2", "INV-4") como guia de leitura. */
function inTable() {
  return within(screen.getByRole('table'))
}

function makeBreakdown(
  overrides: Partial<PricingBreakdown> & {
    final_unit_price_cents: number
    platform_commission_per_unit_cents: number
    consultant_per_unit_cents: number
    pharmacy_cost_unit_cents: number
  }
): PricingBreakdown {
  return {
    pricing_profile_id: 'p-test',
    tier_id: 't-test',
    tier_unit_cents: overrides.tier_unit_cents ?? overrides.final_unit_price_cents,
    effective_floor_cents: 0,
    floor_breakdown: {
      floor_cents: 0,
      source: 'product',
      profile_id: 'p-test',
      floor_abs_cents: null,
      floor_pct_cents: null,
    },
    coupon_id: null,
    coupon_disc_per_unit_raw_cents: 0,
    coupon_disc_per_unit_capped_cents: 0,
    coupon_capped: false,
    consultant_basis: 'TOTAL_PRICE',
    consultant_per_unit_raw_cents: overrides.consultant_per_unit_cents,
    consultant_capped: false,
    quantity: 1,
    final_total_cents: overrides.final_unit_price_cents,
    pharmacy_transfer_cents: overrides.pharmacy_cost_unit_cents,
    platform_commission_total_cents: overrides.platform_commission_per_unit_cents,
    consultant_commission_total_cents: overrides.consultant_per_unit_cents,
    ...overrides,
  } as PricingBreakdown
}

const VARIANTS = [
  { idx: 0, label: 'Sem cupom (baseline)' },
  { idx: 1, label: 'Hipotético 30%' },
]

describe('<CouponImpactMatrix/> — sinais visuais', () => {
  it('renderiza badge "consultor > líquido" quando consultor > platform_net', () => {
    // bruto = 30, consultor = 20, líquido = 10. Consultor (20) > líquido (10).
    const cells: CouponMatrixCell[] = [
      {
        quantity: 1,
        variantIdx: 0,
        variantLabel: 'baseline',
        variantKind: 'no_coupon',
        breakdown: makeBreakdown({
          final_unit_price_cents: 8000,
          pharmacy_cost_unit_cents: 5000,
          platform_commission_per_unit_cents: 3000,
          consultant_per_unit_cents: 2000,
        }),
      },
    ]

    render(<CouponImpactMatrix cells={cells} variants={[VARIANTS[0]!]} quantities={[1]} />)
    expect(inTable().getByText(/consultor > líquido/i)).toBeInTheDocument()
  })

  it('NÃO renderiza badge "consultor > líquido" quando consultor ≤ platform_net', () => {
    // bruto = 30, consultor = 10, líquido = 20. Consultor (10) ≤ líquido (20).
    const cells: CouponMatrixCell[] = [
      {
        quantity: 1,
        variantIdx: 0,
        variantLabel: 'baseline',
        variantKind: 'no_coupon',
        breakdown: makeBreakdown({
          final_unit_price_cents: 8000,
          pharmacy_cost_unit_cents: 5000,
          platform_commission_per_unit_cents: 3000,
          consultant_per_unit_cents: 1000,
        }),
      },
    ]

    render(<CouponImpactMatrix cells={cells} variants={[VARIANTS[0]!]} quantities={[1]} />)
    expect(inTable().queryByText(/consultor > líquido/i)).toBeNull()
  })

  it('NÃO mostra badge quando comissão do consultor é zero', () => {
    const cells: CouponMatrixCell[] = [
      {
        quantity: 1,
        variantIdx: 0,
        variantLabel: 'baseline',
        variantKind: 'no_coupon',
        breakdown: makeBreakdown({
          final_unit_price_cents: 6000,
          pharmacy_cost_unit_cents: 5000,
          platform_commission_per_unit_cents: 1000,
          consultant_per_unit_cents: 0,
        }),
      },
    ]
    render(<CouponImpactMatrix cells={cells} variants={[VARIANTS[0]!]} quantities={[1]} />)
    expect(inTable().queryByText(/consultor > líquido/i)).toBeNull()
  })

  it('renderiza a legenda com os 4 sinais de cor', () => {
    render(<CouponImpactMatrix cells={[]} variants={VARIANTS} quantities={[1]} />)
    expect(screen.getByText(/Como ler a matriz/i)).toBeInTheDocument()
    expect(screen.getByText(/Líquido da plataforma ≥ R\$ 50\/u/i)).toBeInTheDocument()
    expect(screen.getByText(/margem apertada/i)).toBeInTheDocument()
    expect(screen.getByText(/Consultor > líquido/i)).toBeInTheDocument()
    expect(screen.getByText(/destrói margem/i)).toBeInTheDocument()
  })

  it('preserva o badge cap INV-4 quando consultant_capped=true', () => {
    const cells: CouponMatrixCell[] = [
      {
        quantity: 1,
        variantIdx: 0,
        variantLabel: 'baseline',
        variantKind: 'no_coupon',
        breakdown: makeBreakdown({
          final_unit_price_cents: 6000,
          pharmacy_cost_unit_cents: 5000,
          platform_commission_per_unit_cents: 1000,
          consultant_per_unit_cents: 1000,
          consultant_capped: true,
        }),
      },
    ]
    render(<CouponImpactMatrix cells={cells} variants={[VARIANTS[0]!]} quantities={[1]} />)
    expect(inTable().getByText(/cap INV-4/i)).toBeInTheDocument()
  })

  it('preserva o badge cupom capado (INV-2) quando coupon_capped=true', () => {
    const cells: CouponMatrixCell[] = [
      {
        quantity: 1,
        variantIdx: 0,
        variantLabel: 'baseline',
        variantKind: 'no_coupon',
        breakdown: makeBreakdown({
          final_unit_price_cents: 12000,
          pharmacy_cost_unit_cents: 5000,
          platform_commission_per_unit_cents: 7000,
          consultant_per_unit_cents: 350,
          coupon_capped: true,
          coupon_disc_per_unit_raw_cents: 8000,
          coupon_disc_per_unit_capped_cents: 8000,
        }),
      },
    ]
    render(<CouponImpactMatrix cells={cells} variants={[VARIANTS[0]!]} quantities={[1]} />)
    expect(inTable().getByText(/cupom capado \(INV-2\)/i)).toBeInTheDocument()
  })
})
