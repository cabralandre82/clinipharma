import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

/**
 * Vitest configuration used exclusively by Stryker (mutation testing).
 *
 * Differences vs. the main `vitest.config.ts`:
 *   - `include` is restricted to the security/crypto unit tests so each
 *     mutant runs against ~100 focused tests instead of the full 600+
 *     suite. This drops per-mutant latency from ~5 s to ~250 ms.
 *   - Coverage is disabled (Stryker has its own coverage analysis).
 *
 * Do NOT widen the include without measuring: every extra test file
 * multiplies wall-clock time by N mutants.
 */
export default defineConfig({
  plugins: [react()],
  css: {
    postcss: { plugins: [] },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: [
      'tests/unit/lib/crypto.test.ts',
      'tests/unit/lib/security-hmac.test.ts',
      'tests/unit/lib/security-safe-redirect.test.ts',
      'tests/unit/lib/security-csrf.test.ts',
      'tests/unit/lib/security-client-csrf.test.ts',
      'tests/unit/lib/security-csp.test.ts',
      'tests/unit/lib/security-csp-report.test.ts',
      'tests/unit/lib/security-mutation-kills.test.ts',
      'tests/unit/api/csp-report.test.ts',
    ],
    exclude: ['tests/e2e/**'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
      '@upstash/ratelimit': resolve(__dirname, 'tests/__mocks__/@upstash/ratelimit.ts'),
      '@upstash/redis': resolve(__dirname, 'tests/__mocks__/@upstash/redis.ts'),
      'server-only': resolve(__dirname, 'tests/__mocks__/server-only.ts'),
    },
  },
})
