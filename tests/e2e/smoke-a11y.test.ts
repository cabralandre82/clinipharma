/**
 * E2E Accessibility Smoke Tests — WCAG 2.1 AA baseline.
 *
 * Runs axe-core (the engine behind Lighthouse, Pa11y, jest-axe) against the
 * publicly-reachable pages of the platform. We start with WCAG 2.1 A + AA
 * tags only (level AAA is intentionally excluded — it is aspirational and
 * cannot be enforced without designer trade-offs).
 *
 * Findings are reported but the suite is allowed to PASS with warnings — we
 * do not block deploy on a11y until we explicitly run a hardening pass and
 * fix every existing violation. After that, change `expect.soft` to
 * `expect` to make the gate strict.
 *
 * Run: BASE_URL=https://staging.clinipharma.com.br npx playwright test smoke-a11y
 */
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const PUBLIC_PAGES_FOR_A11Y = [
  { path: '/login', label: 'Login' },
  { path: '/terms', label: 'Termos de Uso' },
  { path: '/privacy', label: 'Política de Privacidade' },
  { path: '/dpo', label: 'DPO' },
  { path: '/trust', label: 'Trust Center' },
  { path: '/status', label: 'Status' },
]

const A11Y_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

test.describe('A11y smoke: public pages (WCAG 2.1 AA)', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  for (const { path, label } of PUBLIC_PAGES_FOR_A11Y) {
    test(`${label} (${path}) — no critical/serious violations`, async ({ page }) => {
      await page.goto(path)
      await expect(page.locator('body')).toBeVisible({ timeout: 15_000 })

      // Wait for client-side hydration to settle (Status page polls).
      await page.waitForLoadState('networkidle').catch(() => {})

      const results = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze()

      const seriousOrCritical = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
      )

      if (seriousOrCritical.length > 0) {
        console.log(`[a11y] ${path} — ${seriousOrCritical.length} critical/serious violation(s):`)
        for (const v of seriousOrCritical) {
          console.log(`  • [${v.impact}] ${v.id}: ${v.help} (${v.helpUrl})`)
          console.log(`    nodes: ${v.nodes.length}`)
        }
      }

      expect.soft(seriousOrCritical, 'no critical/serious WCAG 2.1 AA violations').toEqual([])
    })
  }
})
