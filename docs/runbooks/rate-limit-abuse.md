# Runbook — rate-limit abuse / spike

**Severity ladder**: P2 at 10+ IPs/hour or one IP > 100 hits. P1 at
50+ IPs/hour, one IP > 500 hits, or one IP hitting > 5 distinct
buckets (credential-stuffing signature).

**Owner**: SRE on-call. For P1 events involving credential-stuffing
(IP × distinct_buckets), escalate to Security within **30 min**.

**Related**

- Source cron: `app/api/cron/rate-limit-report/route.ts`
- Limiter: `lib/rate-limit.ts`
- Ledger: `public.rate_limit_violations` (30-day retention)
- Feature flags: `security.turnstile_enforce`
- Metric: `rate_limit_suspicious_ips_total{severity}`

---

## 1. What the alert means

A cron job (runs every 15 min) rolled up the last hour of HTTP
429 events in `public.rate_limit_violations` and triggered on
one of these rules:

| Severity | Rule                                                                        |
| -------- | --------------------------------------------------------------------------- |
| P2 warn  | `distinct_ips >= 10` OR `max_hits_per_ip > 100`                             |
| P1 crit  | `distinct_ips >= 50` OR `max_hits_per_ip > 500` OR `max_buckets_per_ip > 5` |

The rules are deliberately conservative on the warn side (a
single confused user hitting F5 can reach 100 hits on a slow
form) and tight on the critical side (a real attack produces
either many IPs, or one IP trying many buckets — both of which
are false-positive-resistant).

**Privacy note**: raw IPs are never stored. The table columns
`ip_hash` are `SHA-256(ip || RATE_LIMIT_IP_SALT)` so you cannot
recover the IP from database access alone. Use the Cloudflare
Access Log or Vercel logs for forensic IP reversal.

---

## 2. Triage (first 5 min)

```sql
-- Check current hour's top offenders
SELECT ip_hash, total_hits, distinct_buckets, buckets, last_seen_at
  FROM public.rate_limit_report_view
 ORDER BY total_hits DESC
 LIMIT 20;

-- Credential-stuffing signature (one IP, many buckets)
SELECT ip_hash, array_agg(DISTINCT bucket) AS buckets, sum(hits) AS hits
  FROM public.rate_limit_violations
 WHERE last_seen_at > now() - interval '1 hour'
 GROUP BY ip_hash
HAVING count(DISTINCT bucket) >= 4
 ORDER BY hits DESC;

-- Time distribution — is it a steady trickle or a burst?
SELECT date_trunc('minute', last_seen_at) AS minute,
       count(*) AS rows,
       sum(hits) AS hits
  FROM public.rate_limit_violations
 WHERE last_seen_at > now() - interval '1 hour'
 GROUP BY 1
 ORDER BY 1 DESC;
```

### Classify the pattern

| Pattern                    | Likely cause                              | Next step                             |
| -------------------------- | ----------------------------------------- | ------------------------------------- |
| Single IP, single bucket   | Misbehaving client / retry loop           | Section 4.A                           |
| Single IP, 3+ buckets      | Credential stuffing                       | Section 4.B, escalate Security        |
| Many IPs, single bucket    | Coordinated form spam / sale-day F5 storm | Section 4.C                           |
| Many IPs, `auth.*` buckets | Credential-spraying botnet                | Section 4.B, consider Cloudflare WAF  |
| Burst < 5 min then silence | Scanner / pen-test                        | Confirm with Security before blocking |

---

## 3. Ground-truth checks (before mitigating)

Before you put anyone on a block-list, rule out these
false-positives:

1. **Deploy artifact**: did a new client build ship a retry-storm
   bug? Check the Vercel deploy history for the last 2 hours.
2. **Synthetic monitor**: is a newly-added k6 / Checkly hitting
   a form? `SELECT array_agg(DISTINCT metadata_json->>'ua') FROM
public.rate_limit_violations WHERE ip_hash = $1 LIMIT 5`.
3. **Sale / campaign**: marketing blast that drove 10× normal
   traffic to a form that's limited to 3/hour? Read #announcements.
4. **Internal network**: is the `ip_hash` the office VPN or a
   staging synthetic? Ask the team.

If any of the above is true, **do not block**. Instead raise the
bucket budget (Section 5) and reopen the alert as P3 info.

---

## 4. Mitigations

### 4.A — Single-IP single-bucket (misbehaving client)

Send the client an HTTP 429 problem+json that the limiter already
returns. No action needed unless the IP is one of your
customers asking in support ticket; in that case, educate them
(do they have a tight retry loop? Share the `Retry-After`
header value).

### 4.B — Credential-stuffing

1. Get the raw IP. Open Cloudflare → Security → Events → filter
   by `/api/auth/forgot-password` or `/api/auth/*` in the last
   hour. The `ip_hash` in the alert matches one of the IPs
   listed — recompute `sha256(ip || RATE_LIMIT_IP_SALT)` locally
   and match.

2. Block at Cloudflare (NOT at the app layer — we want to save
   the CPU cycles):

   ```
   Cloudflare → Security → WAF → Custom Rules
   IP equals <x> OR AS number equals <y>  →  Block
   TTL: 24 hours, then re-evaluate
   ```

3. Enable Turnstile on affected routes (`security.turnstile_enforce=true`):

   ```sql
   UPDATE public.feature_flags
      SET enabled = true, updated_at = now()
    WHERE key = 'security.turnstile_enforce';
   ```

4. File a security incident (`docs/runbooks/security-incident.md`)
   and notify DPO — the LGPD accountability trail requires it
   regardless of whether any data was exfiltrated.

### 4.C — Many-IP single-bucket (form spam / DoS)

Usually hitting `lgpd.deletion` or `register.submit`. These get
spammed by attackers using residential proxies, so the IP list
changes too fast to maintain a manual block.

1. Enable Turnstile: `security.turnstile_enforce=true` (same SQL
   as above). This stops all non-browser automation because the
   widget requires a real browser fingerprint.

2. Lower the bucket budget temporarily — edit `lib/rate-limit.ts`
   and drop the window. This is a deploy but recovers quickly.

3. If the form is receiving obviously-garbage payloads (emoji in
   CPF field, random strings as full_name), add schema-level
   validation in the route before the DB insert so we at least
   stop polluting the `dsar_requests` queue.

4. Consider Cloudflare Rate Limiting rule at the edge (1 req /
   30s / IP for the affected path) for an immediate mitigation
   while we deploy a fix.

---

## 5. Raising a bucket budget (false-positive recovery)

If the alert was a false positive and a legit traffic pattern is
being blocked:

1. Find the limiter in `lib/rate-limit.ts` (e.g. `lgpdFormLimiter`).
2. Change `{ windowMs: 60_000 * 60, max: 3 }` to the new value.
3. Add a comment explaining _why_ — future reviewers must see
   the traffic rationale.
4. Open a PR; this is a production config change and must go
   through review.

Do **not** silence the alert — tune the bucket instead. If the
rules in Section 1 are tripping on legit traffic, the classifier
in `classifyReport()` is the thing to raise, and that belongs in
`app/api/cron/rate-limit-report/route.ts`.

---

## 6. Post-incident

After any P1 event:

1. **Audit trail**: `rate_limit_violations` is LGPD-safe and has
   30-day retention. Snapshot the last 24 hours to the incident
   ticket:

   ```sql
   SELECT * FROM public.rate_limit_violations
    WHERE last_seen_at > now() - interval '24 hours'
    ORDER BY last_seen_at DESC;
   ```

2. **Cloudflare log export**: request a 24-hour window for the
   targeted path and attach to the ticket.

3. **Retrospective**: document the attacker's fingerprint, what
   we blocked, and whether Turnstile was flipped on. If we
   enabled Turnstile during incident, monitor for 7 days; if
   false-positive rate stays below 0.1%, leave it on.

4. **Post-mortem rule review**: did this event trip the alert
   at the right severity? If the IP × buckets rule fired on a
   genuine anti-abuse benefit, tighten it (e.g. `>= 4` buckets
   instead of `> 5`).

---

## 7. Quick reference

| Command                                                                              | Purpose                                      |
| ------------------------------------------------------------------------------------ | -------------------------------------------- |
| `SELECT * FROM rate_limit_report_view;`                                              | Current-hour rollup                          |
| `SELECT rate_limit_purge_old(30);`                                                   | Manual retention purge                       |
| `UPDATE feature_flags SET enabled = true WHERE key = 'security.turnstile_enforce';`  | Kill-switch for form spam                    |
| `UPDATE feature_flags SET enabled = false WHERE key = 'security.turnstile_enforce';` | Turn Turnstile back off after rollout review |
| `curl https://api/cron/rate-limit-report -H "Authorization: Bearer $CRON_SECRET"`    | Manual cron invocation                       |

---

_Owner: SRE · Last updated: 2026-04-17 (Wave 10)_
