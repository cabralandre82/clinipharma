/**
 * Tests for `<BuyerPriceSimulator/>` — the live qty-driven preview.
 *
 * Pin the contract:
 *   1. Initial render shows "Calculando…" while the preview is in
 *      flight (no flash of stale price).
 *   2. After the API resolves, the unit price + total reflect the
 *      RPC breakdown — to the cent.
 *   3. + / - / direct input changes the qty and triggers a refetch
 *      via the cached hook.
 *   4. Coupon chip appears only when there is a per-unit discount.
 *   5. Error states render friendly Portuguese instead of the raw
 *      `errorReason` from the API.
 *   6. CTA navigates with `?cart=productId:qty`.
 *   7. Out-of-tier quantities disable the CTA.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BuyerPriceSimulator } from '@/components/catalog/buyer-price-simulator'
import type { BuyerTierRow } from '@/lib/pricing/buyer-tiers'

const push = vi.fn()
vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<typeof import('next/navigation')>('next/navigation')
  return {
    ...actual,
    useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  }
})

const TIERS: BuyerTierRow[] = [
  { id: 't1', min_quantity: 1, max_quantity: 1, unit_price_cents: 150_000 },
  { id: 't2', min_quantity: 2, max_quantity: 3, unit_price_cents: 140_000 },
  { id: 't3', min_quantity: 4, max_quantity: 10, unit_price_cents: 120_000 },
]

const PROD_ID = '11111111-1111-1111-1111-111111111111'
const SLUG = 'tirzepatida-60mg'

function mockFetchOk(unit_price_cents: number, tier_unit_cents: number) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      ok: true,
      breakdown: {
        final_unit_price_cents: unit_price_cents,
        tier_unit_cents,
      },
    }),
  }) as typeof fetch
}

function mockFetchApiError(reason: string) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: false, reason }),
  }) as typeof fetch
}

beforeEach(() => {
  push.mockReset()
  vi.restoreAllMocks()
})

describe('<BuyerPriceSimulator/>', () => {
  it('shows "Calculando…" before the first fetch resolves', () => {
    // Never-resolving fetch keeps state at pending.
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as typeof fetch
    render(<BuyerPriceSimulator productId={PROD_ID} productSlug={SLUG} tiers={TIERS} />)
    expect(screen.getByText(/calculando/i)).toBeInTheDocument()
  })

  it('renders unit price and total after the fetch resolves', async () => {
    mockFetchOk(150_000, 150_000)
    render(<BuyerPriceSimulator productId={PROD_ID} productSlug={SLUG} tiers={TIERS} />)
    await waitFor(() => {
      // qty=1 → unit price R$ 1.500,00 appears in BOTH the unit
      // line and the total line. We assert at-least-2 occurrences;
      // covers both surfaces in one go.
      expect(screen.getAllByText(/1\.500,00/).length).toBeGreaterThanOrEqual(2)
    })
  })

  it('shows the active tier label "1 un" for qty=1', async () => {
    mockFetchOk(150_000, 150_000)
    render(<BuyerPriceSimulator productId={PROD_ID} productSlug={SLUG} tiers={TIERS} />)
    await waitFor(() => {
      expect(screen.getAllByText(/1\.500,00/).length).toBeGreaterThanOrEqual(1)
    })
    expect(screen.getByText(/Faixa:/i)).toBeInTheDocument()
    expect(screen.getByText('1 un')).toBeInTheDocument()
  })

  it('refetches when qty changes via "+" button', async () => {
    const fetchMock = vi.fn()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        breakdown: { final_unit_price_cents: 150_000, tier_unit_cents: 150_000 },
      }),
    })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        breakdown: { final_unit_price_cents: 140_000, tier_unit_cents: 140_000 },
      }),
    })
    globalThis.fetch = fetchMock as typeof fetch
    render(<BuyerPriceSimulator productId={PROD_ID} productSlug={SLUG} tiers={TIERS} />)
    await waitFor(() => {
      expect(screen.getAllByText(/1\.500,00/).length).toBeGreaterThanOrEqual(1)
    })
    fireEvent.click(screen.getByLabelText(/aumentar quantidade/i))
    await waitFor(() => {
      expect(screen.getAllByText(/1\.400,00/).length).toBeGreaterThanOrEqual(1)
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('shows coupon chip when there is a per-unit discount', async () => {
    // tier_unit=150, final=120 → 30 saving per unit.
    mockFetchOk(120_000, 150_000)
    render(
      <BuyerPriceSimulator
        productId={PROD_ID}
        productSlug={SLUG}
        tiers={TIERS}
        couponId="cpn-x"
        couponCode="VIP30"
      />
    )
    await waitFor(() => {
      expect(screen.getByText(/Cupom VIP30/i)).toBeInTheDocument()
    })
  })

  it('does NOT show coupon chip when discount is zero', async () => {
    mockFetchOk(150_000, 150_000)
    render(
      <BuyerPriceSimulator
        productId={PROD_ID}
        productSlug={SLUG}
        tiers={TIERS}
        couponId="cpn-x"
        couponCode="VIP30"
      />
    )
    await waitFor(() => {
      expect(screen.getAllByText(/1\.500,00/).length).toBeGreaterThanOrEqual(1)
    })
    expect(screen.queryByText(/Cupom VIP30/i)).toBeNull()
  })

  it('renders friendly message for no_active_profile', async () => {
    mockFetchApiError('no_active_profile')
    render(<BuyerPriceSimulator productId={PROD_ID} productSlug={SLUG} tiers={TIERS} />)
    await waitFor(() => {
      expect(screen.getByText(/sem precificação ativa no momento/i)).toBeInTheDocument()
    })
  })

  it('renders friendly message for no_tier_for_quantity', async () => {
    mockFetchApiError('no_tier_for_quantity')
    render(<BuyerPriceSimulator productId={PROD_ID} productSlug={SLUG} tiers={TIERS} />)
    await waitFor(() => {
      expect(screen.getByText(/quantidade fora das faixas/i)).toBeInTheDocument()
    })
  })

  it('CTA navigates to /orders/new with cart=productId:qty', async () => {
    mockFetchOk(140_000, 140_000)
    render(<BuyerPriceSimulator productId={PROD_ID} productSlug={SLUG} tiers={TIERS} />)
    fireEvent.click(screen.getByLabelText(/aumentar quantidade/i))
    await waitFor(() => {
      expect(screen.getAllByText(/1\.400,00/).length).toBeGreaterThanOrEqual(1)
    })
    fireEvent.click(screen.getByRole('button', { name: /Solicitar pedido com 2 un/i }))
    expect(push).toHaveBeenCalledTimes(1)
    expect(push.mock.calls[0][0]).toContain(`cart=${encodeURIComponent(`${PROD_ID}:2`)}`)
  })

  it('disables CTA when the preview is still pending', () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as typeof fetch
    render(<BuyerPriceSimulator productId={PROD_ID} productSlug={SLUG} tiers={TIERS} />)
    const cta = screen.getByRole('button', { name: /Solicitar pedido com 1 un/i })
    expect(cta).toBeDisabled()
  })

  it('disables CTA on error', async () => {
    mockFetchApiError('no_active_profile')
    render(<BuyerPriceSimulator productId={PROD_ID} productSlug={SLUG} tiers={TIERS} />)
    await waitFor(() => {
      expect(screen.getByText(/sem precificação ativa no momento/i)).toBeInTheDocument()
    })
    const cta = screen.getByRole('button', { name: /Solicitar pedido com 1 un/i })
    expect(cta).toBeDisabled()
  })

  it('clamps qty input to [1, top tier max]', async () => {
    mockFetchOk(120_000, 120_000)
    render(<BuyerPriceSimulator productId={PROD_ID} productSlug={SLUG} tiers={TIERS} />)
    // The label text "Quantidade" appears in two places (label + help
    // copy on the total card), so we target the input by its role.
    const input = screen.getByRole('spinbutton') as HTMLInputElement
    fireEvent.change(input, { target: { value: '999' } })
    // Top tier has max=10, so input should clamp.
    expect(input.value).toBe('10')
    fireEvent.change(input, { target: { value: '0' } })
    expect(input.value).toBe('1')
  })
})
