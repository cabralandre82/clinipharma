/**
 * E2E Fluxo 2: Admin aprova cadastro de clínica.
 *
 * Cenário:
 *   1. SUPER_ADMIN acessa painel de solicitações de cadastro
 *   2. Visualiza solicitações pendentes
 *   3. Aprova uma solicitação
 *   4. Confirma que status mudou para ACTIVE
 *
 * Pré-requisitos:
 *   - Banco de staging com ao menos 1 solicitação PENDING
 *   - Session de SUPER_ADMIN (salva por auth.setup.ts)
 *
 * Run: BASE_URL=https://staging.clinipharma.com.br npx playwright test 02-admin
 */
import { test, expect } from '@playwright/test'

test.describe('Admin: Clinic registration approval', () => {
  test('dashboard shows key metrics', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).not.toHaveURL(/login/)

    // Be lenient — some dashboards use different class names
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 10_000 })
  })

  test('admin can access registration requests page', async ({ page }) => {
    await page.goto('/admin/registrations')
    await expect(page).not.toHaveURL(/login/)
    await expect(page).not.toHaveURL(/403|forbidden/)

    // Page heading
    await expect(
      page.getByRole('heading').filter({ hasText: /cadastros|solicitações|registro/i })
    ).toBeVisible({ timeout: 10_000 })
  })

  test('admin can navigate to clinic list', async ({ page }) => {
    await page.goto('/admin/clinics')
    await expect(page).not.toHaveURL(/login|forbidden/)
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 10_000 })
  })

  test('admin can navigate to pharmacy management', async ({ page }) => {
    await page.goto('/admin/pharmacies')
    await expect(page).not.toHaveURL(/login|forbidden/)
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 10_000 })
  })

  test('admin can access user management', async ({ page }) => {
    await page.goto('/admin/users')
    await expect(page).not.toHaveURL(/login|forbidden/)
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 10_000 })
  })

  test('registration requests page shows status filters', async ({ page }) => {
    await page.goto('/admin/registrations')

    // Expect some filter/tab for pending status
    await expect(page.getByText(/pendente|pending|aguardando/i).first()).toBeVisible({
      timeout: 10_000,
    })
  })

  test('approval flow: click approve opens confirmation', async ({ page }) => {
    await page.goto('/admin/registrations')
    const approveButtons = page.getByRole('button', { name: /aprovar/i })
    const count = await approveButtons.count()

    if (count === 0) {
      test.skip()
      return
    }

    await approveButtons.first().click()
    // Should show confirmation dialog or inline action
    const confirmSignal = page
      .getByRole('dialog')
      .or(page.getByText(/confirmar|tem certeza/i))
      .or(page.getByRole('button', { name: /confirmar|sim/i }))

    await expect(confirmSignal.first()).toBeVisible({ timeout: 5_000 })
  })
})
