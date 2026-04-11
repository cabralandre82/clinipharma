/**
 * Shared test data and fixtures for E2E tests.
 * Use environment variables for staging credentials — never hardcode.
 */

export const E2E_ACCOUNTS = {
  superAdmin: {
    email: process.env.E2E_SUPER_ADMIN_EMAIL ?? 'cabralandre@yahoo.com.br',
    password: process.env.E2E_SUPER_ADMIN_PASSWORD ?? '',
    role: 'SUPER_ADMIN' as const,
  },
  clinicAdmin: {
    email: process.env.E2E_CLINIC_ADMIN_EMAIL ?? '',
    password: process.env.E2E_CLINIC_ADMIN_PASSWORD ?? '',
    role: 'CLINIC_ADMIN' as const,
  },
  pharmacyUser: {
    email: process.env.E2E_PHARMACY_EMAIL ?? '',
    password: process.env.E2E_PHARMACY_PASSWORD ?? '',
    role: 'PHARMACY_USER' as const,
  },
} as const

export const STAGING_IDS = {
  /** A clinic already ACTIVE in staging — used for order creation tests */
  clinicId: process.env.E2E_STAGING_CLINIC_ID ?? '',
  /** A pharmacy already ACTIVE in staging */
  pharmacyId: process.env.E2E_STAGING_PHARMACY_ID ?? '',
  /** A product available in staging catalog */
  productId: process.env.E2E_STAGING_PRODUCT_ID ?? '',
} as const

/** Generates unique test identifiers to avoid data collision between runs */
export function testId(prefix: string): string {
  return `${prefix}-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}
