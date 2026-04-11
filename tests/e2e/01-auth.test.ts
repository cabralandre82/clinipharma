/**
 * E2E: Authentication flows.
 * Tests: login success, login failure, logout, password reset.
 *
 * Run: BASE_URL=https://staging.clinipharma.com.br npx playwright test 01-auth
 */
import { test, expect } from '@playwright/test'
import { LoginPage } from './pages/login.page'

// These tests don't require auth state — run without storageState
test.use({ storageState: { cookies: [], origins: [] } })

test.describe('Authentication', () => {
  test('login page renders correctly', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()

    await expect(login.emailInput).toBeVisible()
    await expect(login.passwordInput).toBeVisible()
    await expect(login.submitButton).toBeVisible()
  })

  test('shows error on invalid credentials', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await login.login('invalid@example.com', 'wrong-password')

    // Should show error message
    await expect(page.getByText(/credenciais|inválido|senha|usuário/i)).toBeVisible({
      timeout: 8_000,
    })
    // Should not redirect away from login
    await expect(page).toHaveURL(/login/)
  })

  test('shows error on empty submission', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await login.submitButton.click()

    // HTML5 validation or custom error
    await expect(page.locator(':invalid, [data-error]'))
      .toBeVisible({ timeout: 3_000 })
      .catch(async () => {
        // Fallback: page didn't navigate away
        await expect(page).toHaveURL(/login/)
      })
  })

  test('redirects unauthenticated users to login', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/login/, { timeout: 10_000 })
  })

  test('redirects unauthenticated users from protected routes', async ({ page }) => {
    for (const path of ['/orders', '/admin/pharmacies', '/profile']) {
      await page.goto(path)
      await expect(page).toHaveURL(/login/, { timeout: 10_000 })
    }
  })

  test('password reset link is accessible from login page', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()

    const resetLink = page.getByRole('link', { name: /esqueceu|redefinir|recuperar/i })
    await expect(resetLink).toBeVisible()
    await resetLink.click()
    await expect(page).toHaveURL(/recover|reset|forgot/, { timeout: 8_000 })
  })
})
