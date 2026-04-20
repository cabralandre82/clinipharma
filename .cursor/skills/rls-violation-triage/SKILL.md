---
name: rls-violation-triage
description: Emergency triage of a Row-Level Security canary violation — tenant-isolation leak, scope assessment, freeze/revert, ANPD notification decision. Use when the user says "RLS canary disparou", "tenant leak", "rls_canary_violations_total > 0", "canário RLS vermelho", or when `/api/cron/rls-canary` fires an alert. P0 when `rls_canary.page_on_violation` = ON.
---

# RLS canary violation (P0/P1 — tenant isolation breach)

**SLA: mitigate within 30 minutes.** A leaking tenant boundary is a contract-rupture + LGPD Art. 46 exposure event.

Full runbook: `docs/runbooks/rls-violation.md`.

## What the canary does

A daily cron `/api/cron/rls-canary` authenticates as a synthetic user
with zero memberships and attempts to SELECT from every protected
table. If ANY row comes back, RLS is leaking. Result logged in
`public.rls_canary_log`.

## Workflow

```
RLS canary response:
- [ ] 1. P0/P1 incident issue opened (flag `page_on_violation` state matters)
- [ ] 2. Ledger snapshot captured (SELECT from rls_canary_log)
- [ ] 3. Violation classified by bucket (tenant/self/admin)
- [ ] 4. False-positive check (rerun canary)
- [ ] 5. If real: last deploy reverted OR migration rolled back
- [ ] 6. Release freeze declared (lock main branch)
- [ ] 7. Blast radius: who saw whose data, how many queries
- [ ] 8. ANPD Art. 48 notification decision within 2 business days
- [ ] 9. Customer notification decision (contract B2B terms)
- [ ] 10. Post-mortem + regression test added
```

## Step 1 — confirm the violation is real

```sql
-- Most recent canary runs with violations
select ran_at, subject_uuid, tables_checked, violations,
       jsonb_pretty(details) as details
  from public.rls_canary_log
 where violations > 0
 order by ran_at desc
 limit 5;

-- Also check the last 10 runs regardless — shows pattern
select ran_at, violations, duration_ms
  from public.rls_canary_log
 order by ran_at desc
 limit 10;
```

## Step 2 — classify by bucket (severity depends on this)

The `details.violating` JSON lists leaked tables. For each:

| Bucket   | Meaning                                                                            | Severity                                     |
| -------- | ---------------------------------------------------------------------------------- | -------------------------------------------- |
| `tenant` | Cross-clinic / cross-pharmacy leak (business-contract violation)                   | **HIGHEST** — freeze + customer notification |
| `self`   | Cross-user leak (notifications, DSAR of others)                                    | High — LGPD exposure                         |
| `admin`  | Admin ledgers (audit_logs, legal_holds, backup_runs) visible to authenticated user | High — exposes defensive posture             |

A tenant-bucket violation is **contract-terminable** by enterprise customers. Treat as P0 even if flag is OFF.

## Step 3 — false-positive check

Re-run canary manually before freezing:

```bash
# Trigger it explicitly (requires CRON_SECRET)
curl -X POST https://clinipharma.com.br/api/cron/rls-canary \
  -H "Authorization: Bearer $CRON_SECRET" | jq .
```

Re-query `rls_canary_log` — if two successive manual runs show zero
violations, the original was a transient DB error. Log and move on
(open a tracking issue, not an incident).

If violation repeats → real. Continue.

## Step 4 — identify the regression

```sql
-- What changed in the last 24h?
-- Check recent migrations
\dt public.*              -- if any new tables not in RLS matrix
select * from public.supabase_migrations.schema_migrations
 order by version desc limit 10;

-- Check recent policy changes (requires pg_policy inspection)
select schemaname, tablename, policyname, cmd, qual
  from pg_policies
 where schemaname = 'public'
 order by tablename, policyname;
```

Check git for the last deploy:

```bash
gh run list --workflow=deploy.yml --limit 5
git log --since="24 hours ago" --oneline -- supabase/migrations/ lib/rls/
```

Usual suspects:

- New migration that created a table without `enable row level security`
- Migration that added a column used by a policy, breaking the policy predicate
- Code change that replaced RLS-backed query with a service-role one
- Dropped policy without replacement

## Step 5 — freeze + revert

Declare the freeze in the incident issue:

```markdown
🔒 Release freeze — RLS canary violation

- Main branch locked
- No deploys until this incident closes
- Revert target: <commit-sha-or-PR>
```

Revert the offending deploy:

```bash
# If last deploy introduced the regression
vercel rollback <deployment-id> --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID"

# If a migration caused it (harder — migrations are one-way)
# Add a corrective migration that re-applies RLS on the affected table
psql "$DATABASE_URL" -f supabase/migrations/<YYYYMMDD>_restore_rls_<table>.sql
```

Corrective migration template:

```sql
-- supabase/migrations/<YYYYMMDD>_restore_rls_<table>.sql
alter table public.<table> enable row level security;
alter table public.<table> force row level security;

drop policy if exists <table>_select_by_tenant on public.<table>;
create policy <table>_select_by_tenant on public.<table>
  for select
  using (
    tenant_id in (
      select tenant_id from public.clinic_members where user_id = auth.uid()
      union
      select tenant_id from public.pharmacy_members where user_id = auth.uid()
    )
  );
```

## Step 6 — blast radius

How long was the leak exposed? What was actually queried?

```sql
-- How far back did the gap go?
select ran_at, violations, jsonb_pretty(details) as details
  from public.rls_canary_log
 where ran_at > now() - interval '30 days'
   and violations > 0
 order by ran_at desc;

-- If the cron was silent (never flagged) due to a code path bypass,
-- check Sentry for suspicious /api/** 200s with no auth context.

-- Query-level audit (if server_logs populated):
select count(*), request_path
  from public.server_logs
 where created_at > '<window_start>'
   and response_status = 200
   and request_path in ('/api/<leaked-resource>')
 group by request_path;
```

## Step 7 — LGPD Art. 46 / Art. 48 notification decision

If tenant-bucket leak involves PII of pacientes / médicos / farmacêuticos:

- **Art. 46**: Notify ANPD within 2 business days
- **Art. 48**: If high risk to data subjects, notify subjects directly

The DPO decides; you provide the facts:

- Bucket: tenant | self | admin
- Exposure window: <first detected> → <mitigated>
- Records potentially exposed: <count>
- Evidence of actual access: yes / no / unknown

Don't make this call alone. The `secret-compromise` skill has the same "brief the DPO" pattern.

## Step 8 — customer notification (B2B contract)

Enterprise contracts typically require notification within 24h of a
confirmed tenant-isolation breach. Review `docs/legal/dpa-clinicas.md`
and `docs/legal/dpa-farmacias.md` for exact wording.

Default template: `docs/templates/customer-breach-notice-*.md` (create if missing).

## Step 9 — post-mortem (required)

Within 72h. Must include:

- Regression test that would have caught this (add to `tests/unit/rbac-extended.test.ts` or `tests/unit/audit3-security.test.ts`)
- Migration checklist update (add "RLS matrix updated?" if missing)
- Why the canary detected it instead of a PR test

## Anti-patterns

- **Never skip the false-positive check** — one bad run freezes the platform unnecessarily.
- **Never mitigate by disabling the canary** — that's deleting the smoke detector.
- **Never close the incident without a regression test** — the same bug will ship again.
- **Never ship migrations without RLS review** — the reason we have the canary.
- **Never rollback a migration that has real production data dependent on it** — corrective forward-migration only.

## Related

- Full runbook: `docs/runbooks/rls-violation.md`
- Database conventions: `.cursor/rules/database.mdc`
- Incident intake: `.cursor/skills/incident-open/`
- RLS matrix: `docs/security/rls-matrix.md`
