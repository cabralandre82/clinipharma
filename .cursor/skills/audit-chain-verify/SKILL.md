---
name: audit-chain-verify
description: Investigates and triages an `audit_logs` hash-chain tampering incident — identifies the broken row, distinguishes legitimate purges from real tampering, captures forensic evidence, and coordinates compliance notification. Use when the `verify-audit-chain` cron fails, when Sentry reports "audit chain tampered", when `cron_runs` shows a `verify-audit-chain` failure, or when the user asks "audit chain quebrou" / "tampering detectado".
---

# Audit-chain tampering triage (P1 — legal evidence integrity)

Integrity of `audit_logs` is legally load-bearing: it defends us in
LGPD, labour, and fiscal (10-year) disputes. A broken chain ≠ end of
the world, but requires **immediate** forensic capture before any
corrective action — otherwise we lose the audit trail of the
tampering itself.

Full runbook: `docs/runbooks/audit-chain-tampered.md`.

## Workflow

```
Audit chain triage:
- [ ] 1. P1 incident issue opened (use `incident-open` skill first)
- [ ] 2. Full-chain verify snapshot captured (BEFORE any action)
- [ ] 3. Broken seq identified
- [ ] 4. Classified: legitimate purge vs tampering
- [ ] 5. If tampering: DPO + Compliance notified within 2h
- [ ] 6. Root cause investigated (DBA activity? bypass? bug?)
- [ ] 7. Chain epoch reset documented (if needed)
- [ ] 8. Post-mortem + ANPD review scheduled
```

## Step 1 — IMMEDIATE: don't touch audit_logs

Do NOT run `UPDATE`, `DELETE`, `REASSIGN` on `audit_logs` or
`audit_chain_checkpoints`. Any write corrupts forensics.

Do NOT re-run `verify-audit-chain` until snapshot is saved — the cron
writes to `cron_runs` and can obscure the original error line.

## Step 2 — capture full-chain snapshot (save to issue)

```sql
-- Full scan. Attach entire output to the incident issue.
select * from public.verify_audit_chain(
  '-infinity'::timestamptz,
  'infinity'::timestamptz,
  1000000
);
```

Expected columns:

- `ok` (boolean) — false means broken
- `first_broken_seq` / `first_broken_id` — where the break starts
- `rows_scanned`, `rows_ok`, `rows_failed`

Also capture:

```bash
# The cron run that fired the alert
gh run list --workflow=ci.yml --json name,createdAt,conclusion | \
  jq '[.[] | select(.name | contains("verify-audit"))][:5]'

# Sentry event that paginated
# (grab link from the alert email / PagerDuty)
```

Save all outputs as `<details>` blocks in the incident issue.

## Step 3 — identify the broken seq

```sql
with target as (
  select * from public.audit_logs where seq = <BROKEN_SEQ>
)
select
  t.id, t.seq, t.created_at, t.entity_type, t.action, t.actor_user_id,
  encode(t.row_hash, 'hex')     as stored_hash,
  encode(
    extensions.digest(
      coalesce(t.prev_hash, '\x') ||
      convert_to(public.audit_canonical_payload(t)::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  )                              as recomputed_hash,
  encode(t.prev_hash, 'hex')    as stored_prev,
  encode(
    (select p.row_hash from public.audit_logs p where p.seq = t.seq - 1),
    'hex'
  )                              as expected_prev
from target t;
```

## Step 4 — classify the break

| Pattern                                                                  | Meaning                                                                |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `stored_hash ≠ recomputed_hash` AND `stored_prev = expected_prev`        | Row content was altered (UPDATE bypassed trigger, or DBA intervention) |
| `stored_prev ≠ expected_prev` AND `stored_hash = recomputed_hash`        | Previous row deleted (DELETE bypass) OR row inserted out of sequence   |
| Both differ                                                              | Multi-step attack (alter + remove)                                     |
| Row has `entity_type = 'AUDIT_CHAIN_PURGE'` in `audit_chain_checkpoints` | **Legitimate purge** — not tampering                                   |

## Step 5 — distinguish legitimate purge vs tampering

Check if a checkpoint explains the break:

```sql
select *
  from public.audit_chain_checkpoints
 order by created_at desc
 limit 10;
```

If there's a recent checkpoint covering `<BROKEN_SEQ>` with
`reason ILIKE '%retention%'` or `'%legal_hold_expiry%'`, the purge
was authorized. In that case:

- Verify the checkpoint itself is signed (`signer_key_id` + `signature`)
- Verify the purge was initiated by `enforce-retention` cron (not manual)
- If both check out: not tampering. File a low-severity follow-up to
  confirm retention policy was correct.

If NO checkpoint explains the break → **real tampering**. Continue.

## Step 6 — real tampering: notify

Within 2 hours of classification:

1. Head of Engineering (the user themselves, in solo mode)
2. Compliance Officer / DPO (via `docs/legal/REVIEW-*.md` channel)
3. Open `#compliance-incidents` equivalent (issue with `compliance` + `severity:p1` + `tampering` labels)

Draft message template:

```
P1 audit chain tampering confirmed.

- First broken seq: <N>
- First broken id:  <uuid>
- Detected at:      <timestamp UTC>
- Pattern:          [content altered | row missing | multi-step]
- Legitimate purge checkpoint: NONE
- Current investigation: <link to issue>

Next steps:
1. Root cause analysis (DBA activity audit, direct Postgres connection logs).
2. Compliance evaluation — potential ANPD notification under Art. 48 if PII integrity is questioned.
3. Chain epoch reset (after RCA) — requires legal sign-off.
```

## Step 7 — root cause

Query recent DBA activity:

```sql
-- Who connected directly to Postgres in the last 72h?
-- (Requires `pg_stat_statements` or Supabase admin logs.)
select user, client_addr, application_name, backend_start
  from pg_stat_activity
 where backend_type = 'client backend'
   and backend_start > now() - interval '72 hours';

-- Which trigger functions are currently disabled?
select tgname, tgrelid::regclass as table_name, tgenabled
  from pg_trigger
 where tgrelid = 'public.audit_logs'::regclass;
```

Any trigger with `tgenabled != 'O'` on `audit_logs` is a red flag —
re-enable it in the same transaction as your investigation.

Check the application layer:

```bash
# Any recent code that writes to audit_logs? Should be zero direct SQL.
rg -t ts "audit_logs" lib/ app/ --files-with-matches
# Each hit should go through lib/audit/index.ts — never raw SQL.
```

## Step 8 — chain epoch reset (only with legal sign-off)

After RCA is complete AND compliance has approved:

```sql
-- New checkpoint bracketing the tampered range
select public.create_audit_chain_checkpoint(
  p_from_seq => <FIRST_BROKEN_SEQ>,
  p_to_seq   => <LAST_BROKEN_SEQ>,
  p_reason   => 'incident_tampering_resolution_<ISSUE_ID>',
  p_signer   => '<admin-uuid>'
);
```

The checkpoint establishes a new integrity anchor. Rows before are
legally separate from rows after.

## Anti-patterns

- **Never `DELETE` broken rows** to "clean up". The break IS the evidence.
- **Never disable the `verify-audit-chain` cron** permanently. Pause only if the alert loop is blocking triage, and re-enable within 4h.
- **Never close the incident** before DPO signs off in the issue thread.
- **Never attempt to `UPDATE` the broken `row_hash`** to match — creates second-order tampering.

## Related

- Full narrative runbook: `docs/runbooks/audit-chain-tampered.md`
- Breach response (if PII impacted): `docs/runbooks/data-breach-72h.md`
- Legal review artefact: `docs/legal/REVIEW-*.md`
- Pre-incident: `.cursor/skills/incident-open/`
