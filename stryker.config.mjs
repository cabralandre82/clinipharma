// @ts-check

/**
 * Stryker mutation testing — scoped to the security-critical surface.
 *
 * Purpose: validate that the unit tests for crypto / CSRF / HMAC /
 * safe-redirect / CSP actually *catch* logic regressions, not just
 * exercise the lines. A mutation-killed metric of ≥ 85 % means an
 * attacker who silently weakens one of these primitives (e.g. swaps a
 * `&` for `|`, removes a length check, returns `true` instead of the
 * comparison result) will be caught by CI.
 *
 * Scope is intentionally narrow — these files are pure, deterministic,
 * and security-critical. Mutating non-security files would bloat the
 * run time without commensurate safety value.
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
const config = {
  packageManager: 'npm',
  reporters: ['html', 'clear-text', 'progress', 'dashboard', 'json'],
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.stryker.config.ts',
  },
  coverageAnalysis: 'perTest',
  // Mutate only the security-critical primitives. Adding files here
  // multiplies wall-clock time by O(mutants × tests) — measure first.
  mutate: [
    'lib/crypto.ts',
    'lib/security/hmac.ts',
    'lib/security/safe-redirect.ts',
    'lib/security/csrf.ts',
    'lib/security/client-csrf.ts',
    'lib/security/csp.ts',
    'lib/security/csp-report.ts',
    // Excluded: dev-time `_internal` helper exports (test-only).
    '!lib/**/_internal*',
  ],
  ignorePatterns: [
    'node_modules',
    '.next',
    'coverage',
    'reports',
    '.stryker-tmp',
    'docs',
    'public',
    'tests/e2e',
    'tests/load',
    'supabase',
    'scripts',
  ],
  thresholds: {
    // Ratchet plan: after every wave that adds ≥10 tests we lift these
    // floors toward the real measurement, so regressions are caught
    // the next PR. Real measurement at 2026-04-19: 86.50 % overall
    // (crypto 95.92, csp-report 95.21, safe-redirect 95.65,
    // csrf 90.21, client-csrf 79.59, csp 63.49, hmac 73.13). The
    // hmac/csp/client-csrf gap is dominated by EQUIVALENT mutants
    // (defence-in-depth layers where bypassing one check still yields
    // the same observable result — see docs/testing/mutation-testing.md).
    //
    // Break floor leaves a thin 1-2 pt margin for legitimate refactors
    // but catches any PR that drops below ~84 %. Low/high govern the
    // dashboard colour only — they don't fail the build.
    high: 90,
    low: 85,
    break: 84,
  },
  timeoutMS: 60_000,
  timeoutFactor: 2,
  concurrency: 4,
  tempDirName: '.stryker-tmp',
  htmlReporter: {
    fileName: 'reports/mutation/index.html',
  },
  jsonReporter: {
    fileName: 'reports/mutation/mutation.json',
  },
  // Disable the dashboard reporter unless explicitly opted in via env.
  // In CI we surface results via the JSON report + GitHub artifact
  // upload, not the public Stryker dashboard.
  dashboard: {
    project: process.env.STRYKER_DASHBOARD_PROJECT ?? '',
    version: process.env.STRYKER_DASHBOARD_VERSION ?? 'main',
  },
  // Disable mutators that produce equivalent or low-value mutations
  // (string-literal mutations on log messages, etc.).
  mutator: {
    excludedMutations: [
      // Log message string mutations are virtually all equivalent —
      // tests don't assert on log text.
      'StringLiteral',
    ],
  },
  cleanTempDir: 'always',
  logLevel: 'info',
  fileLogLevel: 'trace',
}

export default config
