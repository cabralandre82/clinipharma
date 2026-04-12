import { inngest } from '@/lib/inngest'
import { createAdminClient } from '@/lib/db/admin'
import { logger } from '@/lib/logger'

/**
 * Weekly job: rebuild product_associations using market basket analysis.
 *
 * Algorithm: simplified Apriori
 * - For each pair (A, B) of products:
 *   - support   = number of distinct orders containing both A and B
 *   - confidence = support / orders_containing_A
 * - Only store pairs with support >= 3 and confidence >= 0.1
 */

const MIN_SUPPORT = 3
const MIN_CONFIDENCE = 0.1
const MAX_ASSOCIATIONS_PER_PRODUCT = 5

export const productRecommendationsJob = inngest.createFunction(
  {
    id: 'product-recommendations-rebuild',
    name: 'Rebuild Product Recommendations',
    triggers: [{ event: 'cron/product-recommendations.rebuild' as const }],
    retries: 2,
    timeouts: { finish: '15m' },
  },
  async ({ step }) => {
    const counts = await step.run('compute-associations', async () => {
      const admin = createAdminClient()

      // Fetch all order_items for completed orders, grouped by order
      const { data: items, error } = await admin
        .from('order_items')
        .select(
          `order_id,
           product_id,
           order:order_id (order_status)`
        )
        .in('order.order_status', ['COMPLETED', 'DELIVERED', 'SHIPPED'])

      if (error) throw new Error(`[recommendations] order_items query failed: ${error.message}`)

      // Build order → products map
      const orderProducts = new Map<string, Set<string>>()
      for (const item of items ?? []) {
        const order = item.order as unknown as { order_status: string } | null
        if (!order) continue
        if (!orderProducts.has(item.order_id)) {
          orderProducts.set(item.order_id, new Set())
        }
        orderProducts.get(item.order_id)!.add(item.product_id)
      }

      // Count occurrences of each product (for confidence denominator)
      const productOrderCount = new Map<string, number>()
      for (const products of orderProducts.values()) {
        for (const productId of products) {
          productOrderCount.set(productId, (productOrderCount.get(productId) ?? 0) + 1)
        }
      }

      // Count co-occurrences
      const coOccurrences = new Map<string, number>()
      for (const products of orderProducts.values()) {
        const productList = Array.from(products)
        for (let i = 0; i < productList.length; i++) {
          for (let j = i + 1; j < productList.length; j++) {
            const a = productList[i]
            const b = productList[j]
            // Store both directions
            const keyAB = `${a}::${b}`
            const keyBA = `${b}::${a}`
            coOccurrences.set(keyAB, (coOccurrences.get(keyAB) ?? 0) + 1)
            coOccurrences.set(keyBA, (coOccurrences.get(keyBA) ?? 0) + 1)
          }
        }
      }

      // Build association rules with support and confidence filters
      const associations: Array<{
        product_a_id: string
        product_b_id: string
        support: number
        confidence: number
      }> = []

      for (const [key, support] of coOccurrences.entries()) {
        if (support < MIN_SUPPORT) continue
        const [a, b] = key.split('::')
        const ordersWithA = productOrderCount.get(a) ?? 1
        const confidence = support / ordersWithA
        if (confidence < MIN_CONFIDENCE) continue
        associations.push({ product_a_id: a, product_b_id: b, support, confidence })
      }

      // Sort by product_a + confidence desc, keep top N per product
      const grouped = new Map<string, typeof associations>()
      for (const assoc of associations) {
        if (!grouped.has(assoc.product_a_id)) grouped.set(assoc.product_a_id, [])
        grouped.get(assoc.product_a_id)!.push(assoc)
      }

      const filtered: typeof associations = []
      for (const [, assocs] of grouped.entries()) {
        assocs.sort((a, b) => b.confidence - a.confidence)
        filtered.push(...assocs.slice(0, MAX_ASSOCIATIONS_PER_PRODUCT))
      }

      logger.info(`[recommendations] computed ${filtered.length} association rules`)
      return filtered
    })

    if (counts.length === 0) {
      logger.info('[recommendations] no associations to store — insufficient order data')
      return { stored: 0 }
    }

    await step.run('upsert-associations', async () => {
      const admin = createAdminClient()

      // Clear old associations and reinsert (full rebuild weekly)
      const { error: delErr } = await admin.from('product_associations').delete().gte('support', 0) // delete all

      if (delErr) logger.warn('[recommendations] delete failed', { error: delErr })

      // Batch upsert in chunks of 200
      const chunkSize = 200
      for (let i = 0; i < counts.length; i += chunkSize) {
        const chunk = counts.slice(i, i + chunkSize).map((a) => ({
          ...a,
          computed_at: new Date().toISOString(),
        }))

        const { error: insertErr } = await admin.from('product_associations').insert(chunk)

        if (insertErr) {
          logger.error('[recommendations] insert chunk failed', { error: insertErr, chunk: i })
        }
      }

      logger.info(`[recommendations] stored ${counts.length} association rules`)
    })

    return { stored: counts.length }
  }
)
