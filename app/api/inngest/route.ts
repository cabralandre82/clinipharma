import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest'
import { exportOrdersJob } from '@/lib/jobs/export-orders'
import { staleOrdersJob } from '@/lib/jobs/stale-orders'
import { asaasWebhookJob } from '@/lib/jobs/asaas-webhook'
import { churnDetectionJob } from '@/lib/jobs/churn-detection'
import { reorderAlertsJob } from '@/lib/jobs/reorder-alerts'
import { contractAutoSendJob } from '@/lib/jobs/contract-auto-send'
import { productRecommendationsJob } from '@/lib/jobs/product-recommendations'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    exportOrdersJob,
    staleOrdersJob,
    asaasWebhookJob,
    churnDetectionJob,
    reorderAlertsJob,
    contractAutoSendJob,
    productRecommendationsJob,
  ],
})
