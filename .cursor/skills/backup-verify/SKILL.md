---
name: backup-verify
description: Triages a backup freshness / restore-drill / chain-break alert and brings the DR pipeline back to green. Use when the user says "backup stale", "restore drill falhou", "backup chain break", "freshness SLA breach", "DR pipeline alert", or when `/api/cron/backup-freshness` fires. Thresholds: 9 days for BACKUP (weekly), 35 days for RESTORE_DRILL (monthly).
---

# Backup freshness triage

Missing or stale backups = we may not be able to restore. LGPD Art. 46
requires "adequate administrative measures" — an unrecoverable dataset
is a board-reportable event. Treat this seriously even when flagged P2.

Full runbook: `docs/runbooks/backup-missing.md`.
Artefacts: `public.backup_runs`, `public.backup_latest_view`, `public.backup_verify_chain()`.

## Four possible reasons

| Reason        | Meaning                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| `missing`     | No row for `(kind,label)`. First run ever or workflow never fires.      |
| `stale`       | Newest `ok` row older than SLA (9d BACKUP, 35d RESTORE_DRILL).          |
| `last_failed` | Newest row has `outcome='fail'` or `'partial'`; no later `ok`.          |
| `chain_break` | `prev_hash` ≠ prior `row_hash` in `backup_runs` ledger — tamper or gap. |

## Workflow

```
Backup triage:
- [ ] 1. P2 incident issue opened (P1 if flag `backup.freshness_enforce` ON)
- [ ] 2. Reason classified (missing / stale / last_failed / chain_break)
- [ ] 3. Ground truth checked (R2 bucket + recent workflow runs)
- [ ] 4. If workflow broken: fixed + re-triggered
- [ ] 5. Latest backup integrity verified (download + restore smoke test)
- [ ] 6. Chain integrity verified (backup_verify_chain returns NULL)
- [ ] 7. Fresh `ok` row recorded in ledger
- [ ] 8. Root cause addressed (config / secret / quota)
- [ ] 9. Next scheduled run monitored to completion
```

## Step 1 — classify the reason

```sql
-- Current freshness state
select kind, label, outcome, recorded_at,
       now() - recorded_at as age,
       r2_prefix, source_url
  from public.backup_latest_view
 order by kind, label;

-- Chain integrity
select * from public.backup_verify_chain(null);
-- first_break_id IS NULL → chain intact

-- Last 10 runs across all kinds
select id, kind, label, outcome, recorded_at,
       metadata_json->>'commit' as commit,
       source_url
  from public.backup_runs
 order by recorded_at desc
 limit 10;
```

## Step 2 — ground truth (did the backup actually happen?)

Do NOT trust the ledger alone — the workflow could have succeeded and failed to register.

```bash
# R2 bucket contents (latest 20 files)
aws --endpoint-url="https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" \
    s3 ls "s3://$R2_BUCKET/" --recursive | \
    sort -k1,2 | tail -20

# Recent Offsite Backup workflow runs
gh run list --workflow=offsite-backup.yml --limit 5 \
  --json name,createdAt,status,conclusion,databaseId

# Recent Restore Drill workflow runs
gh run list --workflow=restore-drill.yml --limit 3 \
  --json name,createdAt,status,conclusion,databaseId
```

Cross-check: if R2 has a fresh file but `backup_runs` doesn't, the
post-backup registration failed (step 7 below).

## Step 3 — fix per reason

### 3a. `missing` — workflow never ran

Common causes:

- Repo paused (Billing issue or owner-level disable)
- Cron schedule broken (YAML syntax error)
- Secrets missing (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `SUPABASE_DB_PASSWORD`)
- "Actions disabled for forks" flag

Fix:

```bash
gh workflow list --all | grep -i backup
gh workflow view offsite-backup.yml
# Check Repo → Settings → Actions → General → "Allow all actions"

# Manually trigger once to confirm
gh workflow run offsite-backup.yml
```

### 3b. `stale` — workflow runs but not recent

Check if recent runs exist but all failed:

```bash
gh run list --workflow=offsite-backup.yml --limit 10 --json status,conclusion,createdAt
```

If last 5 runs show `conclusion: failure`, open one and tail logs:

```bash
gh run view <run-id> --log-failed
```

Common failure classes:

- **Supabase timeout** (`pg_dump` hit statement timeout): bump `--statement-timeout` in workflow to `60min` and re-run.
- **R2 upload 5xx**: transient; re-trigger and watch.
- **Secret expired**: rotate via `.cursor/skills/secret-rotate/` (usually `SUPABASE_DB_PASSWORD` or R2 keys).
- **Disk quota on runner**: the dump file > runner disk. Split into per-schema dumps or upgrade runner size.

### 3c. `last_failed` — partial or failed in last run

```sql
-- What was the failure reason?
select id, recorded_at, outcome, metadata_json
  from public.backup_runs
 where kind = '<KIND>' and label = '<LABEL>'
 order by recorded_at desc
 limit 3;
```

`metadata_json.error` should name the failure mode. Fix root cause, re-trigger workflow.

### 3d. `chain_break` — tamper or gap

```sql
-- Identify the break
select * from public.backup_verify_chain(null);
-- Returns first_break_id + expected/stored hashes.

-- Inspect the broken row
select id, kind, label, outcome, recorded_at,
       encode(row_hash, 'hex') as row_hash,
       encode(prev_hash, 'hex') as prev_hash
  from public.backup_runs
 where id = '<first_break_id>';
```

Possible causes:

- **Manual `INSERT` / `UPDATE`** to `backup_runs` (never do this — use RPCs)
- **Missing run** that was deleted (forensic trail broken)
- **Race condition** in the registration RPC (two concurrent writes)

If tampering suspected → escalate to `audit-chain-verify` pattern (this ledger is adjacent to `audit_logs` in severity: we rely on it for DR evidence).

Otherwise, create a `backup_chain_checkpoint` row documenting the break and establishing a new anchor (same pattern as audit-chain-verify step 8).

## Step 4 — verify the latest backup actually restores

Don't trust a `ok` ledger entry blindly. Smoke-test the restore:

```bash
# Download latest backup
LATEST=$(aws --endpoint-url="https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" \
  s3 ls "s3://$R2_BUCKET/" | sort | tail -1 | awk '{print $NF}')
aws --endpoint-url="https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" \
  s3 cp "s3://$R2_BUCKET/$LATEST" /tmp/backup.dump.gz

# Quick integrity check
gunzip -t /tmp/backup.dump.gz && echo OK

# (Optional) full restore against staging DB — see scripts/dr/
bash scripts/dr/restore-smoke.sh /tmp/backup.dump.gz
```

## Step 5 — record recovery

After backup is healthy again, write the confirmation:

```sql
-- If the fix was workflow-side and a fresh run completed:
select id, outcome, recorded_at
  from public.backup_runs
 where kind = 'BACKUP' and outcome = 'ok'
 order by recorded_at desc limit 1;

-- If the ledger missed a successful backup, back-register manually:
-- (Use the existing RPC, not direct INSERT)
select public.backup_run_register(
  p_kind => 'BACKUP',
  p_label => 'weekly',
  p_outcome => 'ok',
  p_r2_prefix => 's3://<bucket>/<path>',
  p_metadata => jsonb_build_object(
    'commit', '<sha>',
    'size_bytes', <n>,
    'duration_ms', <n>,
    'recovery_note', 'backfilled from R2 ground truth in incident <issue>'
  )
);
```

## Step 6 — prevent recurrence

- If secret-expiry caused the gap → add secret to rotation monitoring.
- If quota / limit caused the gap → add a pre-check to the workflow that fails fast before starting the dump.
- If ledger desync caused the gap → add a post-workflow sanity check that the ledger row exists before marking the workflow green.

## Anti-patterns

- **Never silence the freshness alert** without a written mitigation attached to the incident.
- **Never mark `outcome='ok'` directly in `backup_runs`** — use `backup_run_register()`.
- **Never skip the restore smoke test** — `ok` in the ledger doesn't prove the dump is restorable.
- **Never trust R2 listing alone** — a file can be there and be corrupt; hash check or restore.
- **Never close the incident** without a fresh successful run after the fix.

## Related

- Full runbook: `docs/runbooks/backup-missing.md`
- DR drill 2026-04: `docs/runbooks/dr-drill-2026-04.md`
- Scripts for DR operations: `scripts/dr/`
- Chain-break parallel logic: `.cursor/skills/audit-chain-verify/`
