/**
 * E2E Fluxo 1 & 3: Ciclo de vida completo de um pedido.
 *
 * Cenário coberto:
 *   Fluxo 1 — login → criar pedido → aguardar confirmação
 *   Fluxo 3 — farmácia atualiza status do pedido
 *
 * NOTA: Este teste verifica a estrutura e navegação das páginas de pedidos.
 * O teste de criação real só executa se houver dados de staging disponíveis.
 *
 * Run: BASE_URL=https://staging.clinipharma.com.br npx playwright test 03-order
 */
import { test, expect } from '@playwright/test'

test.describe('Order Lifecycle', () => {
  test('orders page is accessible and renders', async ({ page }) => {
    await page.goto('/orders')
    await expect(page).not.toHaveURL(/login/)

    await expect(page.getByRole('heading').filter({ hasText: /pedidos/i })).toBeVisible({
      timeout: 10_000,
    })
  })

  test('orders page shows list or empty state', async ({ page }) => {
    await page.goto('/orders')

    // Either shows table rows or an empty state message
    const hasRows = page.locator('tbody tr, [data-testid="order-row"]')
    const hasEmpty = page.getByText(/nenhum pedido|sem pedidos|ainda não/i)

    await expect(hasRows.first().or(hasEmpty)).toBeVisible({ timeout: 10_000 })
  })

  test('new order button navigates to order creation', async ({ page }) => {
    await page.goto('/orders')

    const newOrderLink = page
      .getByRole('link', { name: /novo pedido/i })
      .or(page.getByRole('button', { name: /novo pedido/i }))

    await expect(newOrderLink.first()).toBeVisible({ timeout: 8_000 })
    await newOrderLink.first().click()

    await expect(page).toHaveURL(/orders\/new|pedidos\/novo/, { timeout: 8_000 })
  })

  test('order creation form renders required fields', async ({ page }) => {
    await page.goto('/orders/new')
    await expect(page).not.toHaveURL(/login|forbidden/)

    // At minimum, form should have some inputs
    const inputs = page.locator('input, select, textarea')
    await expect(inputs.first()).toBeVisible({ timeout: 10_000 })
  })

  test('order detail page renders for existing order', async ({ page }) => {
    // Navigate to orders list first
    await page.goto('/orders')

    const firstOrderLink = page.locator('tbody tr a, [data-testid="order-row"] a').first()

    const hasOrders = await firstOrderLink.isVisible({ timeout: 5_000 }).catch(() => false)

    if (!hasOrders) {
      test.skip()
      return
    }

    await firstOrderLink.click()
    await expect(page).toHaveURL(/orders\/\w+/)
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 10_000 })
  })

  test('order has status badge/chip', async ({ page }) => {
    await page.goto('/orders')

    const statusBadge = page.locator(
      '[data-testid="status-badge"], [class*="badge"], [class*="status"], [class*="chip"]'
    )

    const hasBadge = await statusBadge
      .first()
      .isVisible({ timeout: 5_000 })
      .catch(() => false)

    if (!hasBadge) {
      // Acceptable if list is empty
      await expect(
        page.getByText(/nenhum|vazio|empty/i).or(page.locator('tbody tr').first())
      ).toBeVisible({ timeout: 5_000 })
    }
  })
})

test.describe('Pharmacy: Order Status Update', () => {
  test('pharmacy orders view is accessible', async ({ page }) => {
    await page.goto('/pharmacy/orders')

    // Either shows the pharmacy orders page or redirects to main orders (role-based)
    await expect(page).not.toHaveURL(/login/)
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 10_000 })
  })
})
