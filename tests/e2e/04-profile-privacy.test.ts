/**
 * E2E: User profile and LGPD privacy portal.
 *
 * Cenário:
 *   - Usuário acessa o perfil
 *   - Acessa o portal de privacidade
 *   - Botões de exportar dados e solicitar exclusão são visíveis
 *
 * Run: BASE_URL=https://staging.clinipharma.com.br npx playwright test 04-profile
 */
import { test, expect } from '@playwright/test'

test.describe('Profile & Privacy', () => {
  test('profile page is accessible', async ({ page }) => {
    await page.goto('/profile')
    await expect(page).not.toHaveURL(/login/)
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 10_000 })
  })

  test('privacy page is accessible', async ({ page }) => {
    await page.goto('/profile/privacy')
    await expect(page).not.toHaveURL(/login/)
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 10_000 })
  })

  test('privacy page shows LGPD rights section', async ({ page }) => {
    await page.goto('/profile/privacy')

    await expect(page.getByText(/privacidade|LGPD|dados pessoais/i).first()).toBeVisible({
      timeout: 10_000,
    })
  })

  test('privacy page has export data button', async ({ page }) => {
    await page.goto('/profile/privacy')

    await expect(
      page
        .getByRole('button', { name: /exportar|baixar.*dados/i })
        .or(page.getByRole('link', { name: /exportar|baixar.*dados/i }))
    ).toBeVisible({ timeout: 10_000 })
  })

  test('privacy page has deletion request button', async ({ page }) => {
    await page.goto('/profile/privacy')

    await expect(
      page
        .getByRole('button', { name: /exclusão|deletar|remover|solicitar/i })
        .or(page.getByText(/solicitar.*exclusão|exclusão.*dados/i))
    ).toBeVisible({ timeout: 10_000 })
  })

  test('export data triggers response (no 500 error)', async ({ request }) => {
    // API-level smoke test — checks the endpoint responds (with 200 or 401)
    const response = await request.get('/api/lgpd/export')
    expect([200, 401, 403]).toContain(response.status())
  })
})
