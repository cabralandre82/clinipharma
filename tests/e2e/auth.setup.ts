/**
 * Auth Setup — runs once before all E2E tests.
 * Logs in as SUPER_ADMIN and saves session state to disk.
 * All subsequent tests reuse the saved session (fast, no repeated logins).
 */
import { test as setup, expect } from '@playwright/test'
import path from 'path'

const SUPER_ADMIN_FILE = path.join(__dirname, '.auth/super-admin.json')

const SUPER_ADMIN_EMAIL = process.env.E2E_SUPER_ADMIN_EMAIL ?? 'cabralandre@yahoo.com.br'
const SUPER_ADMIN_PASSWORD = process.env.E2E_SUPER_ADMIN_PASSWORD ?? ''

setup('authenticate as super admin', async ({ page }) => {
  if (!SUPER_ADMIN_PASSWORD) {
    console.warn(
      '[e2e/setup] E2E_SUPER_ADMIN_PASSWORD not set — skipping real auth, using empty session'
    )
    await page.context().storageState({ path: SUPER_ADMIN_FILE })
    return
  }

  await page.goto('/login')
  await page.getByLabel(/e-?mail/i).fill(SUPER_ADMIN_EMAIL)
  await page.getByLabel(/senha/i).fill(SUPER_ADMIN_PASSWORD)
  await page.getByRole('button', { name: /entrar/i }).click()

  // Wait for redirect to dashboard
  await expect(page).toHaveURL(/\/dashboard|\/admin/, { timeout: 10_000 })

  // Save session
  await page.context().storageState({ path: SUPER_ADMIN_FILE })
})
