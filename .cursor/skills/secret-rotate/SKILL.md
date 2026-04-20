---
name: secret-rotate
description: Rotates a production secret following the scheduled 90-day (Tier A/B) or 180-day (Tier C) policy. Use when the user says "rotacionar secret X", "rotation overdue alert", "hora de rodar a rotação", or when the `/api/cron/rotate-secrets` cron flags an overdue secret. Covers Tier A (auto), Tier B (assisted), Tier C (manual with maintenance window). Does NOT cover compromise response — use `secret-compromise` skill for that.
---

# Secret rotation (scheduled / preventive)

**If you suspect a secret was compromised or leaked, STOP and switch to the `secret-compromise` skill. This skill is for scheduled rotations only.**

Full runbook: `docs/runbooks/secret-rotation.md`.
Manifest source: `lib/secrets/manifest.ts` (mirrored read-only to `docs/security/secrets-manifest.json`).
Ledger: `public.secret_rotations` (append-only).

## Tier matrix

| Tier  | Rotation                                                             | Who                                      | Cadence | Examples                                                                                                  |
| ----- | -------------------------------------------------------------------- | ---------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| **A** | Auto — cron generates random 32 bytes, pushes via Vercel API         | Cron (flag `secrets.auto_rotate_tier_a`) | 90d     | `CRON_SECRET`, `METRICS_SECRET`, `BACKUP_LEDGER_SECRET`                                                   |
| **B** | Assisted — cron enqueues; human rotates at vendor + pushes to Vercel | SRE (~30 min)                            | 90d     | Resend, Asaas, Zenvia, Inngest, Clicksign, Nuvem Fiscal, Vercel token, Turnstile                          |
| **C** | Manual — planned maintenance window                                  | SRE + DPO + Eng Lead (~2h)               | 180d    | `SUPABASE_DB_PASSWORD`, `SUPABASE_JWT_SECRET`, `FIREBASE_PRIVATE_KEY`, `OPENAI_API_KEY`, `ENCRYPTION_KEY` |

## Workflow — Tier A (verify only)

```
Tier A verification:
- [ ] 1. Confirm flag `secrets.auto_rotate_tier_a` is ON
- [ ] 2. Check last cron run at /api/cron/rotate-secrets
- [ ] 3. Verify ledger row for each Tier A overdue secret
- [ ] 4. Verify deployment_id populated in ledger
- [ ] 5. Confirm secrets active (Sentry tag check)
```

Verify:

```sql
-- Feature flag state
select key, enabled from public.feature_flags
 where key = 'secrets.auto_rotate_tier_a';

-- Last 10 rotations
select secret_key, tier, rotated_at, rotated_by, deployment_id,
       reason
  from public.secret_rotations
 order by rotated_at desc
 limit 10;

-- Currently overdue (should be empty on Tier A after Sunday 04:00 UTC)
select * from public.list_overdue_secrets() where tier = 'A';
```

If flag is OFF or ledger has no recent entries, investigate why the
cron didn't run — check `cron_runs` table for `/api/cron/rotate-secrets`.

## Workflow — Tier B (assisted, you execute)

```
Tier B progress (per secret):
- [ ] 1. Read current value (vendor + Vercel, confirm they match)
- [ ] 2. Generate new value at the vendor's portal
- [ ] 3. Add to Vercel as new env var (do NOT remove old yet)
- [ ] 4. Trigger preview deploy, verify functionality
- [ ] 5. Promote to production
- [ ] 6. Remove old value from vendor
- [ ] 7. Record rotation in ledger
- [ ] 8. Tail logs for 15 min to confirm no usage of old value
```

### Example — Resend API key

1. Generate new: https://resend.com/api-keys → "Create API Key"
2. Copy the new key (shown once)
3. Push to Vercel:

   ```bash
   # Keep both for 5 min: add new under RESEND_API_KEY_NEW
   echo -n "<new-key>" | vercel env add RESEND_API_KEY_NEW production \
     --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID"

   # Trigger preview deploy
   vercel --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID"

   # After verifying preview → swap main key + redeploy prod
   vercel env rm RESEND_API_KEY production --yes \
     --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID"
   echo -n "<new-key>" | vercel env add RESEND_API_KEY production \
     --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID"
   vercel --prod --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID"
   ```

4. Delete the old key at Resend (~5 min after prod deploy)

5. Record in ledger:

   ```sql
   select public.record_manual_rotation(
     'RESEND_API_KEY',
     'B',
     '<admin-uuid>',
     'scheduled_90d',
     jsonb_build_object('deployment_id', '<vercel-dep-id>')
   );
   ```

Repeat the pattern for each Tier B secret due (see
`list_overdue_secrets()` output).

## Workflow — Tier C (manual, maintenance window)

Tier C secrets can break the world if rotated wrong. Never rotate
outside a planned window with the Eng Lead + DPO in the loop.

```
Tier C progress:
- [ ] 1. Maintenance window announced (> 48h notice)
- [ ] 2. Backup taken BEFORE rotation
- [ ] 3. DR drill path verified (old secret still works in backup)
- [ ] 4. DPO approval recorded in the incident issue
- [ ] 5. New secret generated at source
- [ ] 6. Vercel env updated + redeployed
- [ ] 7. Smoke-test critical paths (login, payment, encryption)
- [ ] 8. Old secret revoked at source
- [ ] 9. Ledger entry recorded with `tier='C'`
- [ ] 10. Post-rotation: verify for 48h, check `oldest secret age` metric
```

### Tier C specific caveats

- **`ENCRYPTION_KEY`**: Ships with key-versioning. Generate new
  `KEY_V<N+1>`, add as env, keep old `KEY_V<N>` for 90d decryption grace.
  Never remove a prior version until all rows re-encrypted (track via
  `public.list_unmigrated_encrypted_rows()`).
- **`SUPABASE_JWT_SECRET`**: Rotating this invalidates ALL sessions.
  Schedule for low-traffic window + announce to users.
- **`FIREBASE_PRIVATE_KEY`**: Push notifications break during the
  swap window. Schedule after business hours.
- **`SUPABASE_DB_PASSWORD`**: The hardest — must be changed in
  Supabase dashboard first, then the connection string in Vercel env.
  Connection pool exhausts briefly; prepare for 30-90s of 503s.

## Verify the new value is actually live

After any rotation, confirm the new value is in use:

```bash
# Most secrets have a "health" check. E.g. test email send:
curl -X POST https://clinipharma.com.br/api/health/deep \
  -H "Authorization: Bearer <metrics-secret>" | jq .
# Look for external_integrations.resend.status == "ok"
```

Check Sentry for tag `module:secrets/rotate` around the rotation time
— should see `tier <X> rotation succeeded` entries.

## Anti-patterns

- **Never remove the old secret before confirming the new one works** — use the add-new/remove-old sequence, never swap atomically.
- **Never rotate two Tier C secrets in the same window** — isolate blast radius.
- **Never skip the ledger entry** — the `public.secret_rotations` table IS the compliance evidence.
- **Never commit a secret to git** during rotation (not even transiently in a scratch file).
- **Never rotate Tier C on Friday afternoon** — nobody wants a weekend recovery.

## Related

- Compromised secret: `.cursor/skills/secret-compromise/`
- Full runbook: `docs/runbooks/secret-rotation.md`
- Manifest (authoritative): `lib/secrets/manifest.ts`
- Public manifest (read-only view): `docs/security/secrets-manifest.json`
