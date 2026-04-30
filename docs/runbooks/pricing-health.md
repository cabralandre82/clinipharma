# Runbook — Pricing engine health

**Severity:** P2 / P3 — operational, no immediate user impact (the
fallback UI keeps the site usable)
**SLO:** triage < 1 h, resolution < 24 h
**Owner:** finance + super-admin (commercial config); SRE on standby
for engine-level errors
**Introduced:** PR-E of [`docs/decisions/001-tiered-pricing-buyer-pricing-with-coupon-impact-preview.md`](../decisions/001-tiered-pricing-buyer-pricing-with-coupon-impact-preview.md)

## When this runbook applies

Any of the following alerts fired (see
[`monitoring/prometheus/alerts.yml`](../../monitoring/prometheus/alerts.yml)
group `pricing`):

| Alert                          | What it means                                                        |
| ------------------------------ | -------------------------------------------------------------------- |
| `PricingProfilesMissing`       | TIERED product(s) with no active pricing profile                     |
| `PricingHealthCheckStale`      | Cron `pricing-health-check` did not run in the last 26 h             |
| `PricingINV4CapBurst`          | Consultant commission was clamped (INV-4) > 20× in 1h on one product |
| `PricingINV2CapBurst`          | Coupon discount was clamped (INV-2) > 20× in 1h on one product       |
| `PricingPreviewErrorRate`      | `/api/pricing/preview` engine-level error rate > 5% over 15 min      |
| `PricingPreviewLatencyP95High` | p95 latency of the preview > 1.5 s over 15 min                       |

Or one of these symptoms surfaced via Sentry / customer report:

- Buyers see "Sem precificação ativa no momento" on a product page.
- Buyers see "Quantidade fora das faixas cadastradas" for plausible
  quantities.
- Sales mentions a consultant being underpaid relative to expected
  commission %.

## Triage entry point

```
GET /admin/pricing/health
```

This dashboard shows the same signals these alerts fire on. Start
there before opening anything else — it is the fastest path from
"alert" to "which product".

## Branch by alert

### `PricingProfilesMissing`

**What:** the gauge `pricing_health_profiles_missing` is non-zero.
The cron found one or more `products.pricing_mode='TIERED_PROFILE'`
rows with no active `pricing_profiles` row (`effective_until IS NULL`).

**Impact:** every buyer hitting that product (`/catalog/[slug]`,
`/orders/new`, `/api/pricing/preview`) gets the friendly fallback
("Sem precificação ativa no momento"). The platform stays up; the
product is just unsellable until the profile is published.

**Action:**

1. Open `/admin/pricing/health` and read the orphan product list.
2. For each entry, decide:
   - **If the product is launching** → publish a profile via
     `/products/[id]/pricing` → `Configurar tiers` (super-admin RPC
     `set_pricing_profile_atomic`). The alert clears next cron run.
   - **If the product was prematurely toggled to TIERED** → revert to
     FIXED via the same page. The alert clears next cron run.
   - **If you cannot fix today** → acknowledge the alert. The
     fallback message in the UI is correct; the alert just keeps
     reminding super-admin.
3. The cron runs daily at 07:35 UTC. To verify the fix instantly
   without waiting:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" \
     https://clinipharma.com.br/api/cron/pricing-health-check
   ```

### `PricingHealthCheckStale`

**What:** the cron has not run in > 26 h. Either Vercel cron is
broken on this project, or the cron is throwing on every invocation.

**Action:**

1. Check the latest `cron_runs` row for this job:
   ```sql
   select started_at, finished_at, status, error
   from cron_runs
   where job_name = 'pricing-health-check'
   order by started_at desc
   limit 5;
   ```
2. If `status='failed'`, read the `error` column. Most likely cause:
   the `products` or `pricing_profiles` query failed (RLS or
   migration drift). Resolve the underlying DB issue and run the
   cron manually (see above).
3. If there is no row in the past 26 h, Vercel cron is wedged. Check
   `vercel.json` did not regress (`pricing-health-check` should
   appear in the `crons` array) and that `vercel cron list` shows
   the job. Re-deploy if needed.

### `PricingINV4CapBurst`

**What:** the consultant cap (INV-4: `consultant_per_unit ≤
platform_per_unit`) was applied > 20 times in the last hour on one
product. The platform money is correct (the cap protects the
floor), but the consultant is being paid less than the
`pricing_profile.consultant_pct` would suggest. This is almost
always a misconfigured profile.

**Action:**

1. Visit `/products/<id>/pricing`. Look at the active profile's
   `consultant_basis` and `consultant_pct`.
2. Cross-check:
   - If `consultant_basis = 'TOTAL_PRICE'` and `consultant_pct` >
     the profile's expected platform margin, INV-4 will keep
     clamping. Either lower the pct or change the basis to
     `PHARMACY_TRANSFER` (which scales with the pharmacy share, not
     the buyer-paid total).
   - If the consultant link points at a clinic with a **buyer
     pricing override** that pushes the floor very high, the per-
     unit platform revenue is small even on full price → INV-4
     fires. Review the override.
3. If the configuration is intentional (e.g. "this product is
   loss-leader for the consultant program"), increase the alert
   threshold via a deliberate label rule, but document the decision
   in `docs/execution-log.md`.

### `PricingINV2CapBurst`

**What:** the coupon discount cap (INV-2: discount cannot push the
platform below the effective floor) was applied > 20 times in the
last hour on one product. Every buyer using that coupon gets a
smaller discount than the coupon nominally promises.

**Action:**

1. Visit `/products/<id>/pricing/coupon-matrix`. Check which
   coupon is hitting the cap on which quantity tier.
2. Decide:
   - **Coupon was over-promised:** decrease the coupon `discount_pct`
     or `discount_value_cents` so the discount fits below the floor
     for every tier. Communicate the change.
   - **Floor is too high for the campaign:** lower the floor for
     this buyer via a `buyer_pricing_overrides` row. This is a
     commercial decision — confirm with finance before adjusting.
3. The cap remains correct platform-side. There is no money to
   recover; this is purely a UX / fairness alert.

### `PricingPreviewErrorRate`

**What:** more than 5% of `/api/pricing/preview` calls returned an
engine-level error reason (excluding rate-limit / auth / bad
request). Likely causes:

- A freshly published product has a tier that does not cover
  common quantities → `no_tier_for_quantity`.
- A profile was retired in a migration without a replacement →
  `no_active_profile` (would also fire `PricingProfilesMissing`).
- The DB is degraded → `rpc_unavailable` (would also fire
  `HttpHighErrorRate`).

**Action:**

1. Open `/admin/pricing/health` → "Outcomes do preview" panel.
   Identify which non-success outcome is dominant.
2. Branch: `no_active_profile` → see `PricingProfilesMissing`;
   `no_tier_for_quantity` → fix tier brackets in the product's
   profile; `rpc_unavailable` → escalate to SRE / DB on-call.

### `PricingPreviewLatencyP95High`

**What:** p95 of the preview > 1.5 s.

**Action:**

1. Check Sentry for slow `compute_unit_price` traces.
2. Confirm Server Components on `/catalog/[slug]` are batching
   preview calls (PR-D3 introduced
   `getMinTierUnitCentsByProductIds`); a regression that calls
   preview per-product unbatched will balloon latency.
3. Check Postgres CPU / connections on the Supabase dashboard.
4. If sustained, flip a kill-switch (no built-in toggle today —
   feature flag for the live simulator could be added; track in
   `docs/execution-log.md`).

## Verification after fix

1. Refresh `/admin/pricing/health`. The "Configuração" section's
   "Sem profile ativo" stat should be `0` (after the next cron run
   for the gauge — manual cron trigger refreshes immediately).
2. The Prometheus alert clears within `for:` duration of recovery
   (most are 15-30 min).
3. Run a smoke preview to be sure:
   ```bash
   curl -s "$BASE/api/pricing/preview?product_id=$PID&quantity=2" \
     -H "Cookie: $SESSION" | jq .
   ```

## Known false-positive shapes

- A product is intentionally TIERED with no profile because the
  super-admin will publish later in the day. Acknowledge the alert
  with a comment ("publishing 14:00 UTC by Carla"). Do NOT raise
  the threshold globally.
- INV-4 fires repeatedly on a controlled launch product. Document
  in the `pricing_profiles.notes` field that the cap is intentional.

## Related runbooks

- [`money-drift.md`](money-drift.md) — when the cents↔numeric
  invariant is violated (different layer, different alert).
- [`platform-revenue-reconciliation.md`](platform-revenue-reconciliation.md)
  — when ledger and view disagree on actual platform revenue.

## Related code

- `lib/services/pricing-engine.server.ts` — RPC wrapper.
- `app/api/pricing/preview/route.ts` — instrumented endpoint.
- `app/api/cron/pricing-health-check/route.ts` — cron source.
- `supabase/migrations/070_pricing_profiles.sql`
- `supabase/migrations/071_compute_unit_price.sql`
- `supabase/migrations/074_buyer_pricing_overrides.sql`
- `supabase/migrations/075_resolve_floor_with_override.sql`
