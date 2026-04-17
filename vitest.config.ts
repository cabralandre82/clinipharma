import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  css: {
    postcss: { plugins: [] },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    exclude: ['tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['lib/**/*.ts', 'services/**/*.ts'],
      exclude: [
        'lib/db/**',
        'lib/firebase/client.ts',
        'lib/firebase-admin.ts',
        'lib/push.ts',
        'lib/sms.ts',
        'lib/whatsapp.ts',
        'lib/asaas.ts',
        'lib/clicksign.ts',
        'lib/email/index.ts',
        'lib/email/templates.ts',
        'lib/session-logger.ts',
        // Inngest jobs require integration testing against Inngest Dev Server
        'lib/jobs/**',
        // Inngest client setup — no testable logic
        'lib/inngest.ts',
        // Uses Next.js unstable_cache — requires real Next.js runtime
        'lib/dashboard.ts',
        '**/*.d.ts',
      ],
      thresholds: {
        // Ratchet plan: after every wave that adds ≥20 tests we lift these
        // floors toward the real measurement, so regressions are caught
        // the next PR. Current numbers after Wave 1 (logger + redactor +
        // ALS context): 72.82% stmts/lines, 76.98% branches, 86.12% functions.
        // Next ratchet targets in Wave 2 (webhook dedup / cron guard).
        // Do NOT lower — if a PR regresses, add the missing test instead.
        statements: 72,
        branches: 75,
        functions: 86,
        lines: 72,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
      // Stub optional packages that are not installed in the test environment.
      // These are only needed at runtime (Redis-backed rate limiter).
      '@upstash/ratelimit': resolve(__dirname, 'tests/__mocks__/@upstash/ratelimit.ts'),
      '@upstash/redis': resolve(__dirname, 'tests/__mocks__/@upstash/redis.ts'),
      // `server-only` isn't installed in the test environment — stub it so
      // modules guarded by it (lib/features, lib/ai, …) can be imported.
      'server-only': resolve(__dirname, 'tests/__mocks__/server-only.ts'),
    },
  },
})
