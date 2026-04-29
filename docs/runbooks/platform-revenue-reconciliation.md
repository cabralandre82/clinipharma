# Runbook — Platform revenue reconciliation gap (P2)

## Alert pattern

The cron `reconcile-platform-revenue` (daily 04:30 UTC, see
`vercel.json`) reads `public.platform_revenue_view` and fails the run
if any CONFIRMED-payment order has a `recon_gap` ≥ 1 cent. Symptoms:

- Sentry / paging system surfaces
  `Reconciliação: N pedido(s) com gap de comissão (Y¢)`.
- `cron_runs` row for `reconcile-platform-revenue` is `failed`.
- Metric `platform_revenue_recon_gap_total{severity="warning"}` jumps
  above zero in `/api/health/deep?format=prometheus`.
- An admin reading `/reports` sees the recon-gap badge on the order
  detail "Financeiro interno" card (red banner, "Divergência: R$ X").

The alert dedup key is `platform-revenue:recon:gap` — only one
ticket per surge. The `customDetails.sample` payload carries up to 20
offending orders.

## Why the gap is real

`platform_revenue_view` enforces the invariant

```
recorded_platform_commission == gross_paid - pharmacy_share
```

where `recorded_platform_commission` comes from
`commissions.commission_total_amount`. This is the platform's _gross_
commission — the slice between what the customer paid and what we
owe the pharmacy, BEFORE the consultant takes their cut. The platform
pays the consultant out of that slice, so `platform_net = recorded -
consultant_share` is the truly-net cash to the platform.

A non-zero gap means one of three things happened:

1. **Pre-2026-04-29 coupon bug**. `services/payments.ts::confirmPayment`
   used to sum `platform_commission_per_unit * quantity` from
   `order_items`, which is the pre-coupon snapshot. On a coupon order
   the recorded commission overstated the gross commission by exactly
   the coupon discount, leaving phantom money. The fix landed
   2026-04-29; the only known pre-fix victim was CP-2026-000015 and
   it was backfilled by hand.

2. **Pre-064 RPC**. If `payments.atomic_confirm` was ever flipped ON
   between the migration 049 release and migration 064 (which
   re-derives the commission from the reconciliation invariant),
   coupon orders confirmed via the RPC carry the same overstatement.
   Migration 064 fixed the RPC body but doesn't backfill rows that
   were already written wrong.

3. **Direct ledger edit**. Someone hand-ran SQL in prod against
   `commissions` or `transfers` to "fix" something. Backfill applies
   here too, but additionally check the `audit_logs` chain for
   tampering — the change should have left an audit trail. If it
   didn't, escalate to `audit-chain-tampered.md`.

## Triage steps

1. **Pull the offending rows from production:**

   ```sql
   SELECT order_id, order_code, gross_paid, pharmacy_share,
          consultant_share, recorded_platform_commission, recon_gap,
          payment_status, transfer_status
     FROM public.platform_revenue_view
    WHERE payment_status = 'CONFIRMED'
      AND ABS(recon_gap) >= 0.01
    ORDER BY ABS(recon_gap) DESC;
   ```

2. **For each row, decide which class of gap it is:**
   - If the order has a coupon (join `order_items` on `coupon_id`) AND
     was confirmed before 2026-04-29 → class 1.
   - If the order was confirmed via the atomic RPC (check
     `feature_flags` history if the alert references atomic_rpc) →
     class 2.
   - Otherwise → class 3, escalate to audit-chain.

3. **Compute the correct values:**

   ```sql
   SELECT
     o.id,
     o.code,
     o.total_price                              AS correct_gross,
     SUM(oi.pharmacy_cost_per_unit * oi.quantity) AS correct_pharmacy_transfer,
     o.total_price - SUM(oi.pharmacy_cost_per_unit * oi.quantity)
                                                AS correct_platform_commission
     FROM public.orders o
     JOIN public.order_items oi ON oi.order_id = o.id
    WHERE o.id = '<order_id>'
    GROUP BY o.id, o.code, o.total_price;
   ```

## Mitigation — backfill (under audit)

For each offending order:

```sql
UPDATE public.commissions
   SET commission_fixed_amount = <correct_platform_commission>,
       commission_total_amount = <correct_platform_commission>,
       updated_at              = now()
 WHERE order_id = '<order_id>';

UPDATE public.transfers
   SET commission_amount = <correct_platform_commission>,
       net_amount        = <correct_pharmacy_transfer>,
       updated_at        = now()
 WHERE order_id = '<order_id>'
   AND status <> 'COMPLETED';     -- never overwrite a completed wire
```

If `transfers.status = 'COMPLETED'`, the cash already left the
platform's account in the wrong amount. Stop, escalate to manual
financial-counsel triage. The fix is no longer code; it's a follow-up
PIX or settlement adjustment, captured in
`docs/runbooks/transfer-overpaid.md` (TODO: write).

After the UPDATE, verify the gap is gone:

```sql
SELECT order_code, recon_gap
  FROM public.platform_revenue_view
 WHERE order_id = '<order_id>';
```

Run the cron once manually to confirm the alert clears:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://clinipharma.com.br/api/cron/reconcile-platform-revenue
```

## Audit checklist before closing

- [ ] Each backfilled order has its `audit_logs` row with action
      `LEDGER_BACKFILL` and reference to this incident's GitHub issue.
- [ ] No `transfers.status = 'COMPLETED'` row was modified — if any
      was, the financial-counsel escalation above is queued.
- [ ] The `platform_revenue_recon_gap_total` metric returned to zero
      in the next cron run.
- [ ] The on-call ticket has the sample payload attached and a one-line
      attribution to the gap class.

## Related artifacts

- `supabase/migrations/063_platform_revenue_view.sql` — view definition.
- `supabase/migrations/064_atomic_rpc_coupon_reconciliation.sql` —
  RPC fix + recon_gap formula correction.
- `services/payments.ts::confirmPayment` — current legacy code path,
  patched 2026-04-29 to derive the commission from the reconciliation
  invariant.
- `app/api/cron/reconcile-platform-revenue/route.ts` — this cron.
