# Runbook — Money Drift Detected

**Severity:** P2 (warning) — financial integrity, non-urgent user impact
**SLO:** triage < 30 min, root-cause < 4 h, flip flag to remediation within 24 h
**Owner:** audit-2026-04 → backend on-call
**Introduced:** Wave 8 (migration `050_money_cents.sql` + `/api/cron/money-reconcile`)

## What the alert means

The reconciliation cron (`/api/cron/money-reconcile`, runs every 30 min)
queries `public.money_drift_view` and found **at least one row** where
the shadow `*_cents` column disagrees with its twin `numeric(x,2)`
column by more than **1 cent**.

The view covers these 7 tables and fields:

| Table                    | Field(s) audited            |
| ------------------------ | --------------------------- |
| `orders`                 | `total_price`               |
| `order_items`            | `unit_price`, `total_price` |
| `payments`               | `gross_amount`              |
| `commissions`            | `commission_total_amount`   |
| `transfers`              | `net_amount`                |
| `consultant_commissions` | `commission_amount`         |
| `consultant_transfers`   | `gross_amount`              |

In steady state the view is empty: every INSERT/UPDATE on these tables
flows through a `BEFORE … FOR EACH ROW` sync trigger
(`_money_sync_*`) that enforces `cents == round(numeric * 100)` at
write time. A non-empty view means **one of four** things is broken:

1. A writer was introduced that bypassed the trigger (e.g. `COPY`
   from CSV without `ON CONFLICT`, or a direct `UPDATE` that touched
   both columns with conflicting values — the trigger raises in that
   case, so a surviving row implies trigger was dropped or disabled).
2. The trigger was dropped or `DISABLE TRIGGER` was issued manually.
3. A migration backfilled cents incorrectly (always suspect the most
   recent migration first).
4. The `_money_to_cents()` helper was redefined with a different
   rounding mode — check `pg_proc`.

## Impact

- **If `money.cents_read = OFF` (default):** **user-facing impact is
  zero** because all display / aggregation still reads `numeric`.
  The alert is a trailing indicator that writes are inconsistent.
- **If `money.cents_read = ON`:** some dashboards / totals may show
  values that disagree with invoices and receipts. Prioritise the
  flip-to-OFF mitigation below before deep investigation.

## Triage (first 10 min)

1. **Confirm the alert is real.** Hit the cron endpoint manually:

   ```bash
   curl -sS -H "Authorization: Bearer $CRON_SECRET" \
     https://app.clinipharma.com.br/api/cron/money-reconcile | jq
   ```

   If the response is `ok:true, driftCount:0`, the alert already
   auto-resolved (a concurrent writer fixed the row or the trigger
   was re-enabled). Acknowledge the alert and proceed to post-mortem.

2. **Check the `money.cents_read` flag state.**

   ```sql
   SELECT key, enabled FROM public.feature_flags WHERE key = 'money.cents_read';
   ```

   - If `enabled = true`: consider flipping to `false` as a
     mitigation so users stop seeing inconsistent totals. This is the
     single-command kill-switch; downstream code falls back to
     `numeric` automatically.

     ```sql
     UPDATE public.feature_flags SET enabled = false, updated_at = now()
      WHERE key = 'money.cents_read';
     -- Then invalidate cache (or wait 30s for TTL):
     SELECT public.invalidate_feature_flag_cache('money.cents_read');
     ```

3. **Pull the drift sample.** The alert `customDetails.sample` array
   contains up to 20 rows; query the view directly to inspect more:

   ```sql
   SELECT table_name, row_id, field, numeric_value, cents_value, drift_cents
     FROM public.money_drift_view
    ORDER BY drift_cents DESC
    LIMIT 100;
   ```

## Decision tree

```
drift_count == 1 && same table && drift_cents <= 2
   └─ Likely a single bad write (manual UPDATE / ad-hoc script).
      Fix with a direct UPDATE and monitor; no rollback needed.

drift_count > 1 && all same table
   └─ Trigger on that table is broken or was dropped.
      Run pg_trigger check (step 4). Re-create the trigger.

drift_count > 1 && multiple tables
   └─ Helper function _money_to_cents was redefined OR a migration
      backfilled wrongly. Roll back the most recent money-related
      migration if possible; do not touch the helper without a PR.

drift_cents in the millions of cents
   └─ Almost certainly a unit confusion: someone wrote the numeric
      to the _cents column (or vice versa). Spot-check with
      row_id / numeric_value / cents_value — if cents_value ≈
      numeric_value (off by exactly 100×), swap them manually.
```

## Diagnostic queries

### 4. Trigger presence

```sql
SELECT tgname, tgrelid::regclass AS table_name, tgenabled
  FROM pg_trigger
 WHERE tgname LIKE 'trg_money_sync%'
   AND NOT tgisinternal
 ORDER BY tgname;
```

Should return 7 rows, all with `tgenabled = 'O'` (enabled). Any
`'D'` means the trigger was disabled — re-enable with:

```sql
ALTER TABLE public.<table_name> ENABLE TRIGGER trg_money_sync_<table_name>;
```

### 5. Helper function integrity

```sql
SELECT pg_get_functiondef(oid) FROM pg_proc
 WHERE proname = '_money_to_cents' AND pronamespace = 'public'::regnamespace;
```

Expected body:

```sql
SELECT CASE
  WHEN v IS NULL THEN NULL
  ELSE (round(v * 100))::bigint
END
```

If it differs, restore from migration `050_money_cents.sql`.

### 6. Most recent migration applied

```sql
SELECT name, inserted_at
  FROM supabase_migrations.schema_migrations
 ORDER BY inserted_at DESC LIMIT 5;
```

Cross-reference with `git log supabase/migrations/` on the deployed
SHA.

## Mitigations

### Mitigation A — single-row fix (idempotent)

For a specific drifting row, rewrite the cents column from the
authoritative numeric value. The BEFORE trigger will re-validate
on UPDATE, so this is safe:

```sql
UPDATE public.orders
   SET total_price_cents = public._money_to_cents(total_price)
 WHERE id = '<row_id>';
```

Then re-run the cron to confirm `driftCount = 0`:

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  https://app.clinipharma.com.br/api/cron/money-reconcile | jq .result.driftCount
```

### Mitigation B — kill the dual-read path

If the flag is ON and drift is widespread, buy yourself time:

```sql
UPDATE public.feature_flags SET enabled = false, updated_at = now()
 WHERE key = 'money.cents_read';
```

Users now see numeric values (the pre-Wave-8 behaviour). No data is
lost. Proceed with root-cause analysis at your own pace.

### Mitigation C — emergency trigger re-install

If step 4 shows a missing or disabled trigger:

```sql
-- Copy the exact DDL from supabase/migrations/050_money_cents.sql
-- sections 4 (functions) and 4 (triggers) and re-run in-place.
```

The migration uses `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` so it
is safe to re-run a specific trigger without reapplying the whole
migration.

## Metrics to watch during & after remediation

- `money_drift_total{table,field}` — should trend to 0.
- `money_reconcile_duration_ms` histogram — baseline ~100-300 ms; a
  10× regression suggests index corruption or table bloat.
- `money_reconcile_last_run_ts` gauge — freshness check.

## Escalation

- P2 severity; follow standard on-call rotation.
- Page backend lead if `driftCount > 1000` (likely systemic, not a
  one-off bad row).
- Page finance + legal lead if drift is found on rows that already
  paid out (`transfers.status = 'COMPLETED'` or
  `consultant_transfers.status = 'COMPLETED'`). In that case, also
  freeze new transfers until the audit is complete:

  ```sql
  SELECT set_config('clinipharma.transfers_frozen', 'true', false);
  ```

  (Requires wave-N kill-switch; if not yet installed, fall back to
  disabling the Vercel cron for `stale-orders` and `coupon-expiry-alerts`.)

## Post-incident

- Write a short post-mortem in `docs/incidents/YYYY-MM-DD-money-drift-<slug>.md`.
- If root cause was a schema migration, add a regression test
  under `tests/unit/migrations/` that reads all 7 tables after a
  simulated INSERT/UPDATE and asserts `abs(cents - round(numeric * 100)) <= 1`.
- If root cause was a missing trigger, add `tgenabled = 'O'`
  assertion to the `/api/health/deep` report so the next
  occurrence is caught by the health probe rather than by the 30-min
  cron.

## Links

- Migration: `supabase/migrations/050_money_cents.sql`
- Helper lib: `lib/money.ts`, `lib/money-format.ts`
- Cron: `app/api/cron/money-reconcile/route.ts`
- Tests: `tests/unit/lib/money.test.ts`, `tests/unit/api/money-reconcile.test.ts`
