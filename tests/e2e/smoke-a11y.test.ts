/**
 * E2E Accessibility Smoke Tests — WCAG 2.1 AA baseline.
 *
 * Runs axe-core (the engine behind Lighthouse, Pa11y, jest-axe) against
 * the publicly-reachable pages of the platform, on both DESKTOP and a
 * MOBILE viewport (Pixel 5 form factor). Mobile is non-trivial: it
 * surfaces tap-target spacing, viewport-meta, and reflow violations
 * that desktop misses entirely.
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
import { test, expect, devices } from '@playwright/test'
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

const VIEWPORTS = [
  { id: 'desktop', label: 'Desktop 1280×720', use: { viewport: { width: 1280, height: 720 } } },
  // Pixel 5 ≈ 393×851 DIPs. Mobile-only WCAG rules check tap-target
  // size, reflow at 320 CSS px, and orientation-lock — none of which
  // the desktop project would surface.
  { id: 'mobile', label: 'Mobile (Pixel 5)', use: devices['Pixel 5'] },
] as const

const A11Y_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const STRICT = process.env.STRICT_A11Y === '1'

for (const viewport of VIEWPORTS) {
  test.describe(`A11y smoke: public pages — ${viewport.label}`, () => {
    test.use({ ...viewport.use, storageState: { cookies: [], origins: [] } })

    for (const { path, label } of PUBLIC_PAGES_FOR_A11Y) {
      test(`${label} (${path}) — WCAG 2.1 AA scan`, async ({ page }) => {
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
  })
}
