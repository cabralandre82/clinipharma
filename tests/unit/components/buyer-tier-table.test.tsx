/**
 * Tests for `<BuyerTierTable/>` — the buyer-facing tier list.
 *
 * Pin:
 *   1. Manipulated copy ("preparado magistral conforme prescrição")
 *      shows up only when isManipulated=true. (Tom suave ANVISA.)
 *   2. Industrial-TIERED rows omit the magistral copy but still
 *      show "preço por quantidade".
 *   3. The active tier row gets `aria-current="true"` — assistive
 *      tech announces the user's current bracket.
 *   4. Each row formats price as cents/100 (no float drift).
 */

import { describe, it, expect } from 'vitest'
import { render, within } from '@testing-library/react'
import { BuyerTierTable } from '@/components/catalog/buyer-tier-table'
import type { BuyerTierRow } from '@/lib/pricing/buyer-tiers'

const TIERS: BuyerTierRow[] = [
  { id: 't1', min_quantity: 1, max_quantity: 1, unit_price_cents: 150_000 },
  { id: 't2', min_quantity: 2, max_quantity: 3, unit_price_cents: 140_000 },
  { id: 't3', min_quantity: 4, max_quantity: null, unit_price_cents: 120_000 },
]

describe('<BuyerTierTable/>', () => {
  it('renders all tiers with brackets and per-unit price', () => {
    const { container } = render(<BuyerTierTable tiers={TIERS} />)
    const rows = container.querySelectorAll('li')
    expect(rows).toHaveLength(3)
    expect(rows[0].textContent).toContain('1 un')
    expect(rows[0].textContent).toMatch(/1\.500,00/)
    expect(rows[1].textContent).toContain('2-3 un')
    expect(rows[1].textContent).toMatch(/1\.400,00/)
    expect(rows[2].textContent).toContain('4+ un')
    expect(rows[2].textContent).toMatch(/1\.200,00/)
  })

  it('shows magistral copy when isManipulated=true', () => {
    const { getByText } = render(<BuyerTierTable tiers={TIERS} isManipulated />)
    expect(getByText(/preparado magistral conforme prescrição/i)).toBeInTheDocument()
    expect(getByText(/Valor unitário sugerido/i)).toBeInTheDocument()
  })

  it('uses commercial copy when isManipulated=false', () => {
    const { getByText, queryByText } = render(<BuyerTierTable tiers={TIERS} />)
    expect(getByText(/Preço por quantidade/i)).toBeInTheDocument()
    expect(queryByText(/preparado magistral conforme prescrição/i)).toBeNull()
  })

  it('marks the active tier with aria-current', () => {
    const { container } = render(<BuyerTierTable tiers={TIERS} activeTierId="t2" />)
    const rows = container.querySelectorAll('li')
    expect(rows[0].getAttribute('aria-current')).toBeNull()
    expect(rows[1].getAttribute('aria-current')).toBe('true')
    expect(rows[2].getAttribute('aria-current')).toBeNull()
  })

  it('returns null when there are no tiers', () => {
    const { container } = render(<BuyerTierTable tiers={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('keeps each row independently navigable for assistive tech', () => {
    const { container } = render(<BuyerTierTable tiers={TIERS} activeTierId="t3" />)
    const list = container.querySelector('ul')
    expect(list).not.toBeNull()
    // Items must be plain <li> children — no nested buttons or links —
    // so screen readers walk them as a static list rather than a
    // landmark forest.
    const items = within(list!).queryAllByRole('listitem')
    expect(items).toHaveLength(3)
    for (const li of items) {
      expect(within(li).queryByRole('button')).toBeNull()
      expect(within(li).queryByRole('link')).toBeNull()
    }
  })
})
