/**
 * E2E Accessibility Smoke Tests — WCAG 2.1 AA baseline.
 *
 * Runs axe-core (the engine behind Lighthouse, Pa11y, jest-axe) against
 * the publicly-reachable pages of the platform, on both DESKTOP and a
 * MOBILE viewport. Mobile is non-trivial: it surfaces tap-target spacing,
 * viewport-meta, and reflow violations that desktop misses entirely.
 *
 * We tag with WCAG 2.1 A + AA only — level AAA is intentionally
 * excluded (aspirational, requires designer trade-offs).
 *
 * Mode: REPORT-ONLY by default; STRICT_A11Y=1 fails the build on any
 * critical/serious finding. CI sets STRICT_A11Y=1 (see ci.yml) so a
 * regression drops the pipeline immediately.
 *
 *   STRICT_A11Y=1 npx playwright test smoke-a11y
 *   BASE_URL=https://staging.clinipharma.com.br npx playwright test smoke-a11y
 */
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const PUBLIC_PAGES_FOR_A11Y = [
  { path: '/login', label: 'Login' },
  { path: '/forgot-password', label: 'Forgot password' },
  { path: '/registro', label: 'Registro' },
  { path: '/terms', label: 'Termos de Uso' },
  { path: '/privacy', label: 'Política de Privacidade' },
  { path: '/dpo', label: 'DPO' },
  { path: '/trust', label: 'Trust Center' },
  { path: '/status', label: 'Status' },
]

// Viewport sizes — kept as plain { width, height } so we can switch them
// inside the test body via `page.setViewportSize`. Using
// `devices['Pixel 5']` would set `defaultBrowserType`, which Playwright
// forbids inside a `describe` block (it would force a new worker).
// Tap-target / reflow rules from axe still fire correctly with a pure
// viewport resize — they are based on CSS pixel measurements, not on
// the user-agent string.
const VIEWPORTS = [
  { id: 'desktop', width: 1280, height: 720 },
  { id: 'mobile', width: 393, height: 851 }, // Pixel 5 form factor
] as const

const A11Y_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const STRICT = process.env.STRICT_A11Y === '1'

test.describe('A11y smoke: public pages (WCAG 2.1 AA)', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  for (const { path, label } of PUBLIC_PAGES_FOR_A11Y) {
    for (const viewport of VIEWPORTS) {
      test(`${label} (${path}) — ${viewport.id} ${viewport.width}×${viewport.height}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await page.goto(path)
        await expect(page.locator('body')).toBeVisible({ timeout: 15_000 })
        await page.waitForLoadState('networkidle').catch(() => {})

        const results = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze()

        const seriousOrCritical = results.violations.filter(
          (v) => v.impact === 'critical' || v.impact === 'serious'
        )

        if (seriousOrCritical.length > 0) {
          console.log(
            `[a11y][${viewport.id}] ${path} — ${seriousOrCritical.length} critical/serious violation(s):`
          )
          for (const v of seriousOrCritical) {
            console.log(`  • [${v.impact}] ${v.id}: ${v.help} (${v.helpUrl})`)
            console.log(`    nodes: ${v.nodes.length}`)
          }
        } else {
          console.log(`[a11y][${viewport.id}] ${path} — clean (no critical/serious violations)`)
        }

        if (STRICT) {
          expect(
            seriousOrCritical,
            `[${viewport.id}] no critical/serious WCAG 2.1 AA violations`
          ).toEqual([])
        }
      })
    }
  }
})
