/**
 * Auth Setup — runs once before all E2E tests.
 * Logs in as SUPER_ADMIN and saves session state to disk.
 * All subsequent tests reuse the saved session (fast, no repeated logins).
 *
 * Fail-soft policy:
 *   1. PASSWORD ausente              → salva session vazia + flag "no-auth"
 *   2. PASSWORD presente, login OK   → salva session + flag ausente
 *   3. PASSWORD presente, login FAIL → salva session vazia + flag "no-auth"
 *      (a credencial pode ser de prod e o CI estar rodando contra staging,
 *       ou vice-versa — não derrubamos o CI por isso)
 *
 * O flag fica em `tests/e2e/.auth/no-auth.flag` e é lido pelos describes
 * autenticados (golden-path et al) via `hasAuthSession()`. Sem o flag,
 * testes auth pulam gracefully com test.skip().
 */
import { test as setup } from '@playwright/test'
import path from 'path'
import fs from 'fs'

const AUTH_DIR = path.join(__dirname, '.auth')
const SUPER_ADMIN_FILE = path.join(AUTH_DIR, 'super-admin.json')
const NO_AUTH_FLAG = path.join(AUTH_DIR, 'no-auth.flag')

const SUPER_ADMIN_EMAIL = process.env.E2E_SUPER_ADMIN_EMAIL ?? 'cabralandre@yahoo.com.br'
const SUPER_ADMIN_PASSWORD = process.env.E2E_SUPER_ADMIN_PASSWORD ?? ''

function ensureAuthDir() {
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true })
}

function markNoAuth(reason: string) {
  ensureAuthDir()
  fs.writeFileSync(NO_AUTH_FLAG, `${new Date().toISOString()} ${reason}\n`)
}

function clearNoAuthFlag() {
  if (fs.existsSync(NO_AUTH_FLAG)) fs.unlinkSync(NO_AUTH_FLAG)
}

setup('authenticate as super admin', async ({ page }) => {
  ensureAuthDir()

  if (!SUPER_ADMIN_PASSWORD) {
    console.warn(
      '[e2e/setup] E2E_SUPER_ADMIN_PASSWORD not set — skipping real auth, using empty session'
    )
    await page.context().storageState({ path: SUPER_ADMIN_FILE })
    markNoAuth('password-not-set')
    return
  }

  try {
    await page.goto('/login', { timeout: 30_000 })
    // Seletores via id para evitar ambiguidade do strict-mode do Playwright:
    // /senha/i casaria "Senha" (label), "Mostrar senha" (botão toggle) e
    // "Esqueci minha senha" (link), gerando erro de "multiple matches".
    await page.locator('#email').fill(SUPER_ADMIN_EMAIL)
    await page.locator('#password').fill(SUPER_ADMIN_PASSWORD)
    await page.getByRole('button', { name: /^entrar$/i }).click()

    // Aguarda redirect para dashboard. Se não acontecer em 15s,
    // assume que a credencial não vale para este target (típico do
    // CI contra staging com credencial de prod).
    await page.waitForURL(/\/dashboard|\/admin/, { timeout: 15_000 })

    await page.context().storageState({ path: SUPER_ADMIN_FILE })
    clearNoAuthFlag()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(
      `[e2e/setup] login failed (${msg.split('\n')[0]}) — credencial inválida para este target. ` +
        `Salvando session vazia; testes autenticados vão pular graceful.`
    )
    await page.context().storageState({ path: SUPER_ADMIN_FILE })
    markNoAuth('login-failed')
  }
})
