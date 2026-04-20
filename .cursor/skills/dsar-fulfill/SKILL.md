---
name: dsar-fulfill
description: Processes a LGPD Data Subject Access Request (DSAR) from RECEIVED to FULFILLED or REJECTED within the 15-day legal SLA. Use when the user says "processar DSAR", "responder solicitação LGPD", "cliente pediu exclusão / exportação de dados", "DSAR vencendo", or when the `dsar-sla-check` cron alerts. Covers EXPORT, ERASURE, CORRECTION, PORTABILITY, and ANONYMIZATION requests with legal-hold checks.
---

# DSAR fulfillment — LGPD Art. 19 (15-day SLA)

## Legal context — read once

- **SLA**: 15 calendar days from `requested_at` (LGPD Art. 19).
- **Grace**: 30 extra days → `EXPIRED` status (cron auto-closes).
- **ANPD exposure**: up to 2% revenue (capped R$ 50M) for missed SLA.
- **Never `DELETE` from `dsar_requests` or `dsar_audit`** — append-only.

Full runbook: `docs/runbooks/dsar-sla-missed.md`.

## Workflow

```
DSAR progress:
- [ ] 1. Identified request(s) by id(s)
- [ ] 2. Validated legal holds blocking ERASURE
- [ ] 3. Advanced RECEIVED → PROCESSING (audit trail)
- [ ] 4. Executed the request (export / erasure / correction)
- [ ] 5. Recorded fulfillment evidence
- [ ] 6. Advanced PROCESSING → FULFILLED or REJECTED
- [ ] 7. Notified the subject (email or admin channel)
- [ ] 8. Hash-chain integrity verified
```

## Step 1 — identify the request

```sql
-- Specific request
select id, kind, status, subject_user_id, requested_at, sla_due_at,
       now() - sla_due_at as over_by
  from public.dsar_requests
 where id = '<uuid>';

-- All open + breach
select id, kind, status, subject_user_id, sla_due_at,
       now() - sla_due_at as over_by
  from public.dsar_requests
 where status in ('RECEIVED','PROCESSING')
 order by sla_due_at asc;
```

Check the DSAR audit chain to see history:

```sql
select seq, to_status, actor_user_id, actor_role, created_at, metadata_json
  from public.dsar_audit
 where request_id = '<uuid>'
 order by seq asc;
```

## Step 2 — validate legal holds (for ERASURE only)

ERASURE requests MUST reject if any of these apply. Never silently skip.

| Reject code   | Applies when                                                        |
| ------------- | ------------------------------------------------------------------- |
| `NFSE_10Y`    | Subject has fiscal records < 10 years old (CTN Art. 195)            |
| `RDC_22_2014` | Subject has prescription records < 5 years old (Anvisa RDC 22/2014) |
| `ART_37_LGPD` | Active consent-manifest records (LGPD Art. 37)                      |
| `LEGAL_HOLD`  | Row in `legal_holds` table pointing to subject                      |

Check:

```sql
-- NFSE retention
select count(*) from public.nfse_records where subject_id = '<uuid>'
  and issued_at > now() - interval '10 years';

-- Prescription retention
select count(*) from public.prescriptions where patient_id = '<uuid>'
  and created_at > now() - interval '5 years';

-- Active legal holds
select reason, authority, expires_at from public.legal_holds
 where subject_user_id = '<uuid>' and released_at is null;
```

If any count > 0 or hold exists → reject (see Step 6, rejection path).

## Step 3 — advance RECEIVED → PROCESSING

```sql
select public.dsar_transition(
  '<request-id>'::uuid,
  'PROCESSING',
  jsonb_build_object(
    'actor_user_id', '<admin-uuid>',
    'actor_role', 'SUPER_ADMIN'
  )
);
```

The RPC writes the audit row with fresh hash-chain. Never bypass
this RPC — direct `UPDATE` on `dsar_requests` breaks the chain.

## Step 4 — execute by kind

### EXPORT — deliver a data dump

1. Hit `GET /api/lgpd/export` impersonating the subject (prefer self-serve; extreme cases only):

   ```bash
   # Admin impersonation — requires SUPER_ADMIN + MFA + audit-logged
   curl -X GET "https://clinipharma.com.br/api/lgpd/export?subject=<uuid>" \
     -H "Authorization: Bearer <admin-service-token>" \
     -H "X-On-Behalf-Of: <subject-uuid>" \
     -o "dsar-export-<uuid>.zip"
   ```

2. Compute delivery hash:

   ```bash
   DELIVERY_HASH=$(sha256sum dsar-export-<uuid>.zip | cut -d' ' -f1)
   ```

3. Upload to a subject-accessible location (Supabase Storage, expiring link):
   ```bash
   # bucket: dsar-exports (7-day signed URLs only)
   supabase storage cp dsar-export-<uuid>.zip \
     dsar-exports/<uuid>.zip
   ```

### ERASURE — tombstone the profile

```bash
# Calls public.dsar_anonymize_subject() + tombstones related tables
curl -X POST "https://clinipharma.com.br/api/admin/lgpd/anonymize/<subject-uuid>" \
  -H "Authorization: Bearer <admin-service-token>"
```

The endpoint:

- Replaces PII fields with hashed placeholders
- Sets `users.deleted_at = now()`
- Keeps `audit_logs` intact (append-only) — LGPD Art. 16 allows this
- Transitions DSAR to FULFILLED atomically

### CORRECTION — update specific fields

```sql
-- Only fields the subject identified as incorrect, via audit-logged update
select public.user_correct_field(
  '<subject-uuid>'::uuid,
  '<field-name>',        -- e.g. 'full_name'
  '<new-value>',
  '<request-id>'::uuid
);
```

### PORTABILITY — structured machine-readable export

Same as EXPORT but the bundle contains JSON (not just human-readable PDFs). The `/api/lgpd/export?format=portability` flag enables it.

### ANONYMIZATION — partial erasure retaining aggregates

Rarely used. If requested, route to DPO for manual review — do NOT auto-execute.

## Step 5 — record fulfillment evidence

```sql
select public.dsar_transition(
  '<request-id>'::uuid,
  'FULFILLED',
  jsonb_build_object(
    'actor_user_id', '<admin-uuid>',
    'actor_role', 'SUPER_ADMIN',
    'delivery_hash', '<sha256-hex>',
    'delivery_ref', 'storage://dsar-exports/<uuid>.zip',
    'metadata', jsonb_build_object('channel', 'email', 'delivered_at', now())
  )
);
```

## Step 6 — rejection path (with legal-hold code)

When erasure is blocked by a retention obligation:

```sql
select public.dsar_transition(
  '<request-id>'::uuid,
  'REJECTED',
  jsonb_build_object(
    'actor_user_id', '<admin-uuid>',
    'actor_role', 'SUPER_ADMIN',
    'reject_code', 'NFSE_10Y',
    'metadata', jsonb_build_object(
      'reason', 'Obrigação legal de retenção fiscal (CTN Art. 195)',
      'retry_after', '2036-04-19'
    )
  )
);
```

Then send the subject a clear Portuguese-language explanation citing
the specific legal basis. Template: `docs/templates/dsar-rejection-*.md`.

## Step 7 — notify the subject

Send through the same channel the request arrived (usually email).
Include:

- What was done (EXPORT delivered / ERASURE completed / CORRECTION applied / REJECTED with reason)
- When (timestamp)
- Link to the download (EXPORT only; expiring)
- How to appeal (ANPD + our contact)

Template: `docs/templates/dsar-response-*.md`.

## Step 8 — verify hash-chain integrity

```sql
-- Should return all `chain_ok = true`
select seq, to_status,
       prev_hash = lag(row_hash) over (order by seq) as chain_ok
  from public.dsar_audit
 where request_id = '<request-id>'
 order by seq asc;
```

If any row shows `chain_ok = false`, **do not close the issue**. Escalate to `audit-chain-verify` skill.

## Recovery — botched half-anonymization

If `/api/admin/lgpd/anonymize` half-completed (profile tombstoned but DSAR still PROCESSING):

```sql
-- Finish the transition manually, do NOT retry the HTTP endpoint
select public.dsar_transition(
  '<request-id>'::uuid,
  'FULFILLED',
  jsonb_build_object(
    'actor_user_id', '<admin-uuid>',
    'actor_role', 'SUPER_ADMIN',
    'delivery_hash', 'manual-recovery-' || gen_random_uuid()::text,
    'delivery_ref', 'recovered:<subject-uuid>',
    'metadata', jsonb_build_object('reason', 'manual recovery after partial anonymise')
  )
);
```

## Anti-patterns

- **Never `UPDATE dsar_requests` directly** — use `dsar_transition()`.
- **Never delete an EXPIRED request** — it's part of the legal record.
- **Never fulfil an ERASURE without checking legal_holds** — creates retention-law exposure.
- **Never write free-form reject reasons** — use the documented `reject_code` values.
- **Never close this issue before verifying the hash chain** is contiguous.

## Related

- Full narrative runbook: `docs/runbooks/dsar-sla-missed.md`
- Legal-hold details: `docs/runbooks/legal-hold-received.md` + `legal-hold-apply` skill
- Hash-chain tamper: `.cursor/skills/audit-chain-verify/`
