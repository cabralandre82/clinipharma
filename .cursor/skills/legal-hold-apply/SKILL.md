---
name: legal-hold-apply
description: Applies a legal hold to a subject or entity in response to an ANPD / PROCON / judicial / MPF / ANVISA preservation order. Blocks retention crons and DSAR ERASURE until hold is released. Use when the user says "recebi uma ordem judicial", "ANPD solicitou preservação", "ofício para manter dados", "aplicar legal hold", "PROCON mandou preservar", or when Jurídico forwards a formal preservation order. SLA: apply within 4h of receipt.
---

# Legal hold (preservation order response)

A legal hold is a formal order from an authority (ANPD, PROCON/DPDC,
Judiciário, MPF/Polícia Federal, ANVISA, internal audit) that data
connected to a subject must be preserved. While active, retention
crons + DSAR ERASURE skip the subject.

Full runbook: `docs/runbooks/legal-hold-received.md`.
SQL artefacts: `public.legal_holds`, `legal_hold_apply/release/is_active`.
Flags: `legal_hold.block_purge`, `legal_hold.block_dsar_erasure`.

## Workflow

```
Legal hold application:
- [ ] 1. P2 incident issue opened (P1 if purge may have happened already)
- [ ] 2. Order authenticity confirmed with Jurídico
- [ ] 3. Subject type + subject_id identified in the platform
- [ ] 4. Hold applied via admin endpoint
- [ ] 5. Hold active state verified (legal_hold_is_active)
- [ ] 6. Flags checked (block_purge + block_dsar_erasure ON)
- [ ] 7. If any prior purge suspected: audit_logs scanned
- [ ] 8. Ordem + response documented in `docs/legal/holds/<id>.md`
- [ ] 9. Release date / conditions tracked for reminder
```

## Step 1 — authenticate the order

Before applying anything, confirm the order is genuine. Request from Jurídico:

- Process / SEI number
- Issuing authority + contact
- Exact scope: subject, period, data classes
- Deadline (none → open-ended until explicit release)

Red flags (call Jurídico if you see any):

- Email-only with no attached PDF
- No process number
- Sender domain mismatch (e.g. `@anpd.com` instead of `@anpd.gov.br`)
- Asks for data export in the same breath (that's a DSAR, not a hold)

## Step 2 — identify the subject

```sql
-- By CPF (hashed index since Wave 9)
select id from public.profiles
 where cpf_hash = encode(extensions.digest('<cpf>', 'sha256'), 'hex');

-- By order
select id, pharmacy_id, clinic_id from public.orders
 where numero_pedido = '<N>';

-- By pharmacy CNPJ
select id from public.pharmacies where cnpj = '<cnpj>';

-- By user email
select id from public.users where email = '<email>';

-- Multi-entity (order touches subject + pharmacy + clinic)
-- → apply separate holds for each if the order covers all
```

## Step 3 — apply the hold

Use the admin endpoint (DPO JWT only):

```bash
curl -X POST https://app.clinipharma.com.br/api/admin/legal-hold/apply \
  -H "Authorization: Bearer <DPO_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "subject_type": "user",
    "subject_id": "<uuid>",
    "reason_code": "ANPD_INVESTIGATION",
    "reason": "Processo SEI-ANPD-00123456/2026 — inquérito preliminar",
    "expires_at": null,
    "document_refs": [
      {"ref": "SEI-ANPD-00123456/2026", "received_at": "2026-04-19"}
    ],
    "requestor": {
      "org": "ANPD",
      "name": "Fulano de Tal",
      "contact": "fulano@anpd.gov.br",
      "document_number": "Ofício 123/2026-ANPD"
    }
  }'
```

### Valid `reason_code` values

| Code                   | Authority                                   |
| ---------------------- | ------------------------------------------- |
| `ANPD_INVESTIGATION`   | ANPD (LGPD Art. 52)                         |
| `PROCON_INVESTIGATION` | PROCON / DPDC (CDC Art. 55)                 |
| `JUDICIAL_ORDER`       | Judiciário (cível / criminal / trabalhista) |
| `MPF_CRIMINAL`         | MPF / Polícia Federal                       |
| `ANVISA_DISPENSATION`  | ANVISA (RDC 22/2014)                        |
| `INTERNAL_AUDIT`       | Auditoria interna preemptiva                |

### Valid `subject_type` values

`user`, `order`, `pharmacy`, `clinic`, `document`, `payment`.

Response codes:

- `201` → new hold created
- `200` with `idempotent: true` → hold already exists for (subject, reason_code)
- `403` → JWT lacks `SUPER_ADMIN` + DPO role
- `400` → schema validation failed (check the payload)

## Step 4 — verify hold is active

```sql
-- Specific hold
select id, subject_type, subject_id, reason_code, reason,
       applied_at, released_at, expires_at,
       jsonb_pretty(document_refs) as document_refs,
       jsonb_pretty(requestor_json) as requestor
  from public.legal_holds
 where subject_id = '<uuid>'
   and released_at is null
 order by applied_at desc;

-- Functional check — should return true
select public.legal_hold_is_active(
  '<subject_type>'::text,
  '<subject_id>'::uuid
);
```

## Step 5 — verify enforcement flags

```sql
select key, enabled from public.feature_flags
 where key in ('legal_hold.block_purge', 'legal_hold.block_dsar_erasure');
```

Both should be `enabled = true`. If OFF:

```sql
update public.feature_flags set enabled = true
 where key in ('legal_hold.block_purge', 'legal_hold.block_dsar_erasure');
```

Then tail the next retention cron + DSAR erasure attempt — they should log `skipped_due_to_legal_hold`.

## Step 6 — check if any prior purge happened (P1 case)

If the order arrived retroactively (subject was active before, or we have reason to suspect a purge already ran):

```sql
-- Any retention cron activity on this subject
select created_at, action, metadata_json
  from public.audit_logs
 where entity_type in ('user', 'profile', 'order')
   and entity_id = '<subject_id>'
   and action in ('RETENTION_PURGE', 'DSAR_ERASURE_FULFILLED', 'TOMBSTONE')
 order by created_at desc;

-- Anonymized flag on profile
select id, anonymized_at, tombstoned_at, deleted_at
  from public.profiles
 where id = '<subject_id>';
```

If any of these show activity → **upgrade to P1**, notify Jurídico
IMMEDIATELY. The response strategy is:

- Acknowledge to the authority
- Reconstruct from `audit_logs` what was retained (append-only survives anonymization)
- Explain the data state + when + why + legal basis for the prior retention period

## Step 7 — document

Create `docs/legal/holds/<hold-id>.md`:

```markdown
# Legal Hold — <subject_type>:<subject_id>

- **Applied**: <date>
- **Authority**: <org>
- **Document**: <ref>
- **Reason code**: <code>
- **Scope**: <description of what must be preserved>
- **Expires**: <date or "open-ended">
- **Applied by**: <DPO name>
- **Incident issue**: #<N>
- **Release conditions**: <when can we lift>
```

## Step 8 — schedule release reminder

If the order has an explicit `expires_at`, the SQL hold auto-releases at that moment. Still, set a calendar reminder 7 days prior for Jurídico to confirm.

If open-ended → create an issue titled "Legal hold review: <subject>" with a recurring 90-day label `compliance-quarterly`.

## Release procedure (when order is formally lifted)

Only on written confirmation of release from the authority OR the authority's deadline passed silently AND Jurídico signed off:

```bash
curl -X POST https://app.clinipharma.com.br/api/admin/legal-hold/release \
  -H "Authorization: Bearer <DPO_JWT>" \
  -d '{
    "hold_id": "<uuid>",
    "release_reason": "Ofício de encerramento 456/2026-ANPD recebido 2026-07-10"
  }'
```

After release, retention crons + DSAR ERASURE will process the subject on the next scheduled run (no manual cleanup needed).

## Anti-patterns

- **Never apply a hold without Jurídico confirming authenticity** — scammers impersonate authorities.
- **Never skip the enforcement-flag check** — a hold with `block_*` flags OFF is decorative.
- **Never release a hold without written authority confirmation** — verbal agreements don't count.
- **Never modify `legal_holds` rows directly** — use the RPCs (`legal_hold_apply`, `legal_hold_release`).
- **Never email the subject they're on hold** — it may interfere with the investigation.

## Related

- Full runbook: `docs/runbooks/legal-hold-received.md`
- DSAR interaction: `.cursor/skills/dsar-fulfill/` (ERASURE blocked when hold active)
- Compliance rule: `.cursor/rules/compliance.mdc`
- Legal document archive: `docs/legal/holds/`
