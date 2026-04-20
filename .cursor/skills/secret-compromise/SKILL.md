---
name: secret-compromise
description: Emergency response to a suspected or confirmed secret compromise — revokes, rotates, and audits every plausible misuse window. Use when the user says "secret vazou", "credential leak", "employee offboarding requires revocation", "found token in public repo", "vendor reported unauthorized use", or when GitHub secret-scanning / BugCrowd / vendor disclosure flags a leaked credential. For scheduled rotations, use `secret-rotate` instead.
---

# Secret compromise (P1/P2 emergency)

Confirmed leak → P1. Suspected leak (employee offboarded, log exposure, repo momentarily public) → P2. Either way, you over-rotate, not under-rotate.

Full runbook: `docs/runbooks/secret-compromise.md`.

## Workflow

```
Secret compromise progress:
- [ ] 1. P1/P2 incident issue opened
- [ ] 2. Exposure window identified (first-exposed → detected)
- [ ] 3. Secret revoked at SOURCE (vendor side)
- [ ] 4. New secret generated + pushed to Vercel
- [ ] 5. Prod redeployed, new secret confirmed active
- [ ] 6. Misuse audit: logs scanned for the exposure window
- [ ] 7. Blast radius assessment (what could attacker do?)
- [ ] 8. Ledger entry with `reason='compromise_<context>'`
- [ ] 9. DPO notified if PII-adjacent secret
- [ ] 10. Post-mortem filed within 72h
```

## Step 1 — classify severity (decide fast)

| Scenario                                                             | Severity                    |
| -------------------------------------------------------------------- | --------------------------- |
| Vendor confirmed attacker used the credential                        | **P1**                      |
| Secret visible in public git history / public log / published APK    | **P1**                      |
| Employee with access offboarded (no confirmed use)                   | **P2**                      |
| Secret in internal-only log that an attacker could have read (chain) | **P2**                      |
| Secret found in `.env.local` on a laptop that was then stolen        | **P1** (treat as confirmed) |

Never downgrade from P1 to P2 mid-response. Upgrade only.

## Step 2 — identify exposure window

Two timestamps — write them in the issue body:

- **First possible exposure**: when the secret first appeared in the insecure location (commit date, log timestamp, offboarding date)
- **Detection**: now

The window between these is your **misuse audit scope**.

```bash
# Git history — find when secret entered repo
git log --all -S "<secret-fragment>" --oneline --date=iso
# For secrets already rotated but surfacing in old commits, this shows
# you the exposure duration.
```

## Step 3 — revoke at SOURCE first

**CRITICAL**: revoke at the vendor's portal BEFORE rotating in Vercel.
The attacker still has the old value in hand; rotating in Vercel alone
leaves the stolen credential working at the vendor for the interim.

### Per-vendor revocation

| Secret                                                  | Where to revoke                                                              |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `RESEND_API_KEY`                                        | https://resend.com/api-keys → delete                                         |
| `ASAAS_API_KEY`                                         | Asaas dashboard → Integrations → API keys → revoke                           |
| `CLICKSIGN_API_KEY`                                     | Clicksign → Integrations → delete token                                      |
| `OPENAI_API_KEY`                                        | https://platform.openai.com/api-keys → revoke                                |
| `FIREBASE_PRIVATE_KEY`                                  | GCP console → IAM → Service accounts → delete key                            |
| `SUPABASE_SERVICE_ROLE_KEY`                             | Supabase dashboard → Settings → API → regenerate                             |
| `SUPABASE_JWT_SECRET`                                   | Supabase dashboard → Settings → JWT → regenerate (invalidates all sessions!) |
| `ENCRYPTION_KEY`                                        | **DO NOT ROTATE NAIVELY — see §5**                                           |
| `CRON_SECRET`, `METRICS_SECRET`, `BACKUP_LEDGER_SECRET` | Generated internally; swap via Vercel                                        |
| `VERCEL_TOKEN`                                          | Vercel → Account → Tokens → revoke                                           |

## Step 4 — rotate in Vercel (same pattern as scheduled rotation)

```bash
export VERCEL_TOKEN=<current-still-valid-token>
export VERCEL_ORG_ID=<team-id>

vercel env rm <SECRET_NAME> production --yes \
  --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID"
echo -n "<new-value>" | vercel env add <SECRET_NAME> production \
  --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID"

# Force redeploy (do NOT wait for next push)
vercel --prod --force --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID"
```

If the rotation is the Vercel token itself, you need a fresh console-generated token first, then revoke the old in the UI.

## Step 5 — `ENCRYPTION_KEY` compromise (special case)

Rotating `ENCRYPTION_KEY` naively **inutilises all PII in the database**. The column data is AES-256-GCM encrypted with the current key.

**P0 protocol** when this key is confirmed leaked:

1. **Pause the platform** immediately — put Vercel into maintenance mode (`ops/maintenance-mode.ts`).
2. **Open emergency war room** — eng lead + DPO + legal.
3. **Generate `KEY_V<N+1>`** but do NOT remove `KEY_V<N>`.
4. **Deploy the new version as additional key** — the codebase already supports multi-version envelope encryption.
5. **Re-encrypt all PII rows** using `public.reencrypt_pii_columns(batch_size=1000)` — runs in background until `list_unmigrated_encrypted_rows()` returns 0.
6. **Only after 100% migration**, remove `KEY_V<N>` from env + redeploy.
7. **ANPD Art. 48 notification** likely required (material PII integrity event).

Do NOT proceed with step 5 alone on this without DPO sign-off in the issue.

## Step 6 — misuse audit (the hardest step, the most important)

For the exposure window, scan every system the secret could have reached.

```sql
-- Sample queries — adapt by secret type:

-- If SUPABASE_SERVICE_ROLE_KEY: any direct RPC calls outside our IPs?
select count(*), client_addr
  from public.server_logs
 where created_at between '<window_start>' and '<window_end>'
   and request_path ilike '/rest/v1/%'
   and client_addr not in (<vercel-edge-cidrs>)
 group by client_addr
 order by count(*) desc;

-- If RESEND_API_KEY: unusual send patterns?
-- (Check Resend dashboard → Logs → filter by date range)

-- If ASAAS_API_KEY: unusual payment flows?
-- (Check Asaas → Audit log → filter by exposure window)

-- If VERCEL_TOKEN: unauthorized env mutations or deploys?
-- (Vercel → Audit log → filter by token)
```

Document findings in the issue — **"no evidence found" is a legitimate finding**, but it requires explicit queries + results attached, not just a claim.

## Step 7 — blast radius assessment

For the issue post-mortem, answer:

1. What could the attacker do with the secret? (specifics, not "bad things")
2. What data was accessible?
3. What writes were possible?
4. Any evidence of use? (from step 6)
5. Is any downstream rotation needed? (e.g. leaked Vercel token → rotate everything in that account)

## Step 8 — ledger entry

```sql
select public.record_manual_rotation(
  '<SECRET_NAME>',
  '<tier A/B/C>',
  '<admin-uuid>',
  'compromise_<context>',
  jsonb_build_object(
    'incident_issue', 'https://github.com/<org>/<repo>/issues/<N>',
    'exposure_window_start', '<timestamp>',
    'exposure_window_end', '<timestamp>',
    'misuse_found', false,
    'dpo_notified', true
  )
);
```

## Step 9 — notify DPO

Required when:

- The secret could decrypt PII (ENCRYPTION_KEY, SUPABASE_DB_PASSWORD, SUPABASE_SERVICE_ROLE_KEY)
- The secret could access financial data (Asaas, NFSE)
- Misuse was found in step 6

The DPO decides if ANPD Art. 48 notification is required. Window is "reasonable time" but treat as 72h from detection.

## Anti-patterns

- **Never rotate in Vercel before revoking at the vendor** — leaves the stolen credential active.
- **Never rotate `ENCRYPTION_KEY` naively** — destroys all encrypted PII in place.
- **Never skip the misuse audit** to "move faster" — that's the evidence you need for ANPD.
- **Never close the incident without a written blast-radius assessment** in the issue.
- **Never reuse the compromised value** (not even for testing in staging).

## Related

- Scheduled rotation: `.cursor/skills/secret-rotate/`
- Full runbook: `docs/runbooks/secret-compromise.md`
- ANPD breach notification guide: `docs/compliance/anpd-art-48-notification.md`
- Incident intake: `.cursor/skills/incident-open/`
