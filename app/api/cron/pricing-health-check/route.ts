/**
 * GET /api/cron/pricing-health-check — pricing engine config audit
 * (PR-E of ADR-001).
 *
 * Detects products in `pricing_mode='TIERED_PROFILE'` that have NO
 * active pricing profile. This is the "buyer ran into 'sem
 * precificação ativa no momento'" scenario — the super-admin moved a
 * product into TIERED but never published a profile, and every
 * buyer-side simulator/order on that product fails with
 * `no_active_profile`. Without this cron the failure is silent until
 * a buyer complains.
 *
 * Output (steady state):
 *   { scanned: N, missing: 0, durationMs: T }
 *
 * On non-zero `missing`:
 *   - logs `error` with the offending product ids/slugs;
 *   - emits `pricing_health_profiles_missing` gauge so the dashboard
 *     can plot the count over time;
 *   - fires a P3 alert via `triggerAlert` with `dedupKey =
 *     pricing-health:profiles-missing`. Operator wakes up to a
 *     concrete "publish a profile for X, Y, Z" todo, not a vague
 *     "buyer simulator is broken".
 *
 * The cron does NOT throw — missing profiles are an OPERATIONAL
 * issue, not a data-integrity one (the platform keeps running,
 * buyers just see a friendly fallback message). Throwing would page
 * on-call for what's really a super-admin task.
 *
 * Manual run:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     https://clinipharma.com.br/api/cron/pricing-health-check
 *
 * Schedule: 35 7 * * * (between rls-canary at 07:40 and the morning
 * stale-orders/reorder-alerts batch — empty slot).
 */

import { createAdminClient } from '@/lib/db/admin'
import { logger } from '@/lib/logger'
import { withCronGuard } from '@/lib/cron/guarded'
import { incCounter, observeHistogram, setGauge, Metrics } from '@/lib/metrics'

interface OffendingProduct {
  id: string
  slug: string
  name: string
}

const MAX_SAMPLES_LOGGED = Number(process.env.PRICING_HEALTH_MAX_SAMPLES ?? '20')

export const GET = withCronGuard('pricing-health-check', async () => {
  const started = Date.now()
  const admin = createAdminClient()

  // 1. Pull all TIERED products. The `pricing_mode` column is on
  //    `products` itself — cheap full-table scan filtered by enum.
  const { data: tieredProducts, error: prodErr } = await admin
    .from('products')
    .select('id, slug, name')
    .eq('pricing_mode', 'TIERED_PROFILE')
    .eq('active', true)

  if (prodErr) {
    logger.error('[pricing-health-check] products query failed', { error: prodErr })
    throw new Error(`products query failed: ${prodErr.message}`)
  }

  const products = (tieredProducts ?? []) as OffendingProduct[]

  if (products.length === 0) {
    const duration = Date.now() - started
    observeHistogram(Metrics.PRICING_HEALTH_DURATION_MS, duration)
    setGauge(Metrics.PRICING_HEALTH_LAST_SUCCESS_TS, Math.floor(Date.now() / 1000))
    setGauge(Metrics.PRICING_HEALTH_PROFILES_MISSING, 0)
    incCounter(Metrics.PRICING_HEALTH_RUN_TOTAL, { outcome: 'success' })
    logger.info('[pricing-health-check] no TIERED products', { durationMs: duration })
    return { scanned: 0, missing: 0, durationMs: duration }
  }

  // 2. Pull all currently-active profiles for those products. Single
  //    query, scopes to the ids we care about. Returns at most 1 row
  //    per product (effective_until IS NULL is unique by trigger).
  const productIds = products.map((p) => p.id)
  const { data: activeProfiles, error: profErr } = await admin
    .from('pricing_profiles')
    .select('product_id')
    .in('product_id', productIds)
    .is('effective_until', null)

  if (profErr) {
    logger.error('[pricing-health-check] profiles query failed', { error: profErr })
    throw new Error(`profiles query failed: ${profErr.message}`)
  }

  const haveProfile = new Set(
    ((activeProfiles ?? []) as { product_id: string }[]).map((r) => r.product_id)
  )
  const missing = products.filter((p) => !haveProfile.has(p.id))

  const duration = Date.now() - started
  observeHistogram(Metrics.PRICING_HEALTH_DURATION_MS, duration)
  setGauge(Metrics.PRICING_HEALTH_LAST_SUCCESS_TS, Math.floor(Date.now() / 1000))
  setGauge(Metrics.PRICING_HEALTH_PROFILES_MISSING, missing.length)

  if (missing.length === 0) {
    incCounter(Metrics.PRICING_HEALTH_RUN_TOTAL, { outcome: 'success' })
    logger.info('[pricing-health-check] all TIERED products have active profile', {
      scanned: products.length,
      durationMs: duration,
    })
    return { scanned: products.length, missing: 0, durationMs: duration }
  }

  incCounter(Metrics.PRICING_HEALTH_RUN_TOTAL, { outcome: 'missing_detected' })

  const sample = missing.slice(0, MAX_SAMPLES_LOGGED).map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
  }))

  logger.error('[pricing-health-check] TIERED products without active profile', {
    scanned: products.length,
    missing: missing.length,
    durationMs: duration,
    sample,
  })

  // Dynamic import so the cron module stays edge-compatible (the
  // alerts module pulls in the email transport which needs Node).
  try {
    const { triggerAlert } = await import('@/lib/alerts')
    await triggerAlert({
      severity: 'warning',
      title: `Pricing: ${missing.length} produto(s) TIERED sem profile ativo`,
      message:
        `Encontrei ${missing.length} produto(s) configurado(s) como ` +
        `\`pricing_mode='TIERED_PROFILE'\` que não possuem nenhum profile ` +
        `ativo. Buyers que tentarem ver ou comprar esses produtos vão ver ` +
        `"Sem precificação ativa no momento" (rota /api/pricing/preview ` +
        `responde \`{ ok: false, reason: 'no_active_profile' }\`).\n\n` +
        `Resolução: super-admin → /products/[id]/pricing/edit → publicar ` +
        `profile com pelo menos um tier. Ou voltar para FIXED via ` +
        `togglePricingMode.\n\n` +
        sample.map((p) => `- ${p.name} (${p.slug})`).join('\n'),
      dedupKey: 'pricing-health:profiles-missing',
      component: 'cron/pricing-health-check',
      customDetails: {
        missing: missing.length,
        sample,
      },
    })
  } catch (alertErr) {
    logger.error('[pricing-health-check] alert dispatch failed', { error: alertErr })
  }

  // We deliberately DO NOT throw. The platform stays up; buyers see
  // the friendly fallback. Throwing would mark the cron as failed
  // and page on-call for what's really a super-admin todo.
  return {
    scanned: products.length,
    missing: missing.length,
    durationMs: duration,
    sample,
  }
})
