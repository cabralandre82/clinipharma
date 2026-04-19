// @vitest-environment node
/**
 * Drift guard — `docs/security/secrets-manifest.json` must mirror the
 * runtime manifest in `lib/secrets/manifest.ts`.
 *
 * The JSON manifest is the audit-friendly evidence published in the
 * Trust Center for SOC 2 / ISO 27001 reviewers. If the runtime
 * manifest changes (new secret, retired secret, tier change) and
 * nobody regenerates the JSON, this test fails with the diff and a
 * clear hint to re-run `npm run secrets:export-manifest`.
 *
 * We compare ONLY the canonical metadata fields — runtime fields
 * like `generated_at` and policy text are out of scope.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { SECRET_MANIFEST, TIER_MAX_AGE_DAYS } from '@/lib/secrets/manifest'

const JSON_PATH = resolve(__dirname, '../../../docs/security/secrets-manifest.json')

interface SecretEntry {
  name: string
  tier: string
  provider: string
  description: string
  invalidates_sessions: boolean
  destroys_data_at_rest: boolean
  has_siblings: boolean
}

describe('secrets-manifest.json drift guard', () => {
  it('JSON manifest exists', () => {
    expect(
      existsSync(JSON_PATH),
      `missing ${JSON_PATH} — run \`npm run secrets:export-manifest\``
    ).toBe(true)
  })

  const json = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as {
    summary: { total_secrets: number; by_tier: Record<string, number> }
    policy: { tier_max_age_days: Record<string, number> }
    secrets: SecretEntry[]
  }

  it('total count matches runtime manifest', () => {
    expect(json.summary.total_secrets).toBe(SECRET_MANIFEST.length)
    expect(json.secrets.length).toBe(SECRET_MANIFEST.length)
  })

  it('policy tier max-age matches runtime constants', () => {
    expect(json.policy.tier_max_age_days).toEqual(TIER_MAX_AGE_DAYS)
  })

  it('every runtime secret appears in JSON with identical core fields', () => {
    const byName = new Map(json.secrets.map((s) => [s.name, s]))
    const drift: string[] = []
    for (const desc of SECRET_MANIFEST) {
      const entry = byName.get(desc.name)
      if (!entry) {
        drift.push(`MISSING from JSON: ${desc.name}`)
        continue
      }
      if (entry.tier !== desc.tier)
        drift.push(`TIER drift on ${desc.name}: ts=${desc.tier} json=${entry.tier}`)
      if (entry.provider !== desc.provider)
        drift.push(`PROVIDER drift on ${desc.name}: ts=${desc.provider} json=${entry.provider}`)
      if (entry.description !== desc.description) drift.push(`DESCRIPTION drift on ${desc.name}`)
      if (entry.invalidates_sessions !== (desc.invalidatesSessions === true))
        drift.push(`invalidates_sessions drift on ${desc.name}`)
      if (entry.destroys_data_at_rest !== (desc.destroysDataAtRest === true))
        drift.push(`destroys_data_at_rest drift on ${desc.name}`)
      if (entry.has_siblings !== (desc.hasSiblings === true))
        drift.push(`has_siblings drift on ${desc.name}`)
    }
    for (const entry of json.secrets) {
      if (!SECRET_MANIFEST.some((d) => d.name === entry.name)) {
        drift.push(`STALE in JSON (not in runtime manifest): ${entry.name}`)
      }
    }
    expect(
      drift,
      `secrets-manifest.json out of sync — run \`npm run secrets:export-manifest\` and commit:\n  ${drift.join('\n  ')}`
    ).toEqual([])
  })

  it('per-tier counts in summary are accurate', () => {
    const byTier: Record<string, number> = {}
    for (const s of json.secrets) byTier[s.tier] = (byTier[s.tier] ?? 0) + 1
    expect(json.summary.by_tier).toEqual(byTier)
  })
})
