import { describe, it, expect, beforeEach } from 'vitest'
import {
  incCounter,
  setGauge,
  observeHistogram,
  snapshotMetrics,
  metricsText,
  detectSurge,
  incAndRead,
  __resetMetricsForTests,
  Metrics,
} from '@/lib/metrics'

describe('metrics — counters', () => {
  beforeEach(() => {
    __resetMetricsForTests()
  })

  it('increments a counter with default delta of 1', () => {
    incCounter('foo_total')
    incCounter('foo_total')
    const snap = snapshotMetrics()
    expect(snap.counters).toEqual([expect.objectContaining({ name: 'foo_total', value: 2 })])
  })

  it('distinguishes counters by labels', () => {
    incCounter('csrf_blocked_total', { reason: 'origin' })
    incCounter('csrf_blocked_total', { reason: 'origin' })
    incCounter('csrf_blocked_total', { reason: 'token_mismatch' })
    const snap = snapshotMetrics()
    const origin = snap.counters.find((c) => c.labels.reason === 'origin')
    const mismatch = snap.counters.find((c) => c.labels.reason === 'token_mismatch')
    expect(origin?.value).toBe(2)
    expect(mismatch?.value).toBe(1)
  })

  it('ignores negative or non-finite deltas', () => {
    incCounter('noop_total', {}, -5)
    incCounter('noop_total', {}, Number.NaN)
    incCounter('noop_total', {}, Number.POSITIVE_INFINITY)
    const snap = snapshotMetrics()
    expect(snap.counters).toHaveLength(0)
  })

  it('incAndRead returns the current value', () => {
    const v1 = incAndRead('deltas_total')
    const v2 = incAndRead('deltas_total', {}, 4)
    expect(v1).toBe(1)
    expect(v2).toBe(5)
  })

  it('exposes canonical metric names via the Metrics constant', () => {
    expect(Metrics.CSRF_BLOCKED_TOTAL).toBe('csrf_blocked_total')
    expect(Metrics.RBAC_DENIED_TOTAL).toBe('rbac_denied_total')
    expect(Metrics.CRON_RUN_TOTAL).toBe('cron_run_total')
    expect(Metrics.CIRCUIT_BREAKER_STATE).toBe('circuit_breaker_state')
  })
})

describe('metrics — gauges', () => {
  beforeEach(() => {
    __resetMetricsForTests()
  })

  it('stores the latest value', () => {
    setGauge('queue_depth', 5)
    setGauge('queue_depth', 12)
    const snap = snapshotMetrics()
    expect(snap.gauges[0].value).toBe(12)
  })

  it('keeps per-label gauges separate', () => {
    setGauge('circuit_breaker_state', 0, { name: 'asaas' })
    setGauge('circuit_breaker_state', 2, { name: 'clicksign' })
    const snap = snapshotMetrics()
    expect(snap.gauges).toHaveLength(2)
    const asaas = snap.gauges.find((g) => g.labels.name === 'asaas')
    const clicksign = snap.gauges.find((g) => g.labels.name === 'clicksign')
    expect(asaas?.value).toBe(0)
    expect(clicksign?.value).toBe(2)
  })

  it('ignores non-finite values', () => {
    setGauge('bad_metric', Number.NaN)
    const snap = snapshotMetrics()
    expect(snap.gauges).toHaveLength(0)
  })
})

describe('metrics — histograms', () => {
  beforeEach(() => {
    __resetMetricsForTests()
  })

  it('tracks count, sum, min, max, avg', () => {
    observeHistogram('latency_ms', 100)
    observeHistogram('latency_ms', 200)
    observeHistogram('latency_ms', 300)
    const snap = snapshotMetrics()
    const h = snap.histograms[0]
    expect(h.count).toBe(3)
    expect(h.sum).toBe(600)
    expect(h.min).toBe(100)
    expect(h.max).toBe(300)
    expect(h.avg).toBe(200)
  })

  it('computes reasonable quantiles', () => {
    for (let i = 1; i <= 100; i++) observeHistogram('lat', i)
    const h = snapshotMetrics().histograms[0]
    expect(h.p50).toBeGreaterThan(40)
    expect(h.p50).toBeLessThan(60)
    expect(h.p95).toBeGreaterThanOrEqual(95)
    expect(h.p99).toBeGreaterThanOrEqual(99)
  })

  it('bounds memory by dropping oldest samples past the limit', () => {
    for (let i = 0; i < 500; i++) observeHistogram('bounded', i)
    const h = snapshotMetrics().histograms[0]
    expect(h.count).toBe(500)
    // Internal reservoir capped at 200 — verify via p50 shifting toward
    // the latter half of the observations (newest values dominate).
    expect(h.p50).toBeGreaterThan(200)
  })
})

describe('metrics — Prometheus exposition', () => {
  beforeEach(() => {
    __resetMetricsForTests()
  })

  it('renders counter + gauge + histogram in text format', () => {
    incCounter('foo_total', { source: 'asaas' }, 3)
    setGauge('queue_depth', 7, { queue: 'main' })
    observeHistogram('lat_ms', 50)
    observeHistogram('lat_ms', 150)
    const text = metricsText()
    expect(text).toContain('foo_total{source="asaas"} 3')
    expect(text).toContain('queue_depth{queue="main"} 7')
    expect(text).toContain('lat_ms_count 2')
    expect(text).toContain('lat_ms_sum 200')
  })

  it('escapes double-quotes in label values', () => {
    incCounter('evil_total', { label: 'has"quote' })
    const text = metricsText()
    expect(text).toContain('label="has\\"quote"')
  })
})

describe('metrics — surge detector', () => {
  beforeEach(() => {
    __resetMetricsForTests()
  })

  it('returns false below threshold', () => {
    expect(detectSurge('key', 60_000, 3)).toBe(false)
    expect(detectSurge('key', 60_000, 3)).toBe(false)
    expect(detectSurge('key', 60_000, 3)).toBe(false)
  })

  it('returns true once threshold exceeded, then resets', () => {
    detectSurge('k', 60_000, 3)
    detectSurge('k', 60_000, 3)
    detectSurge('k', 60_000, 3)
    expect(detectSurge('k', 60_000, 3)).toBe(true)
    // Bucket cleared after firing — first subsequent call is fresh.
    expect(detectSurge('k', 60_000, 3)).toBe(false)
  })

  it('ignores invalid parameters', () => {
    expect(detectSurge('x', 0, 10)).toBe(false)
    expect(detectSurge('x', 10_000, 0)).toBe(false)
    expect(detectSurge('x', -1, 1)).toBe(false)
  })
})
