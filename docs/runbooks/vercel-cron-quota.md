# Vercel cron quota — Hobby plan workaround

## Background

The Clinipharma Vercel project (`b2b-med-platform`, team
`cabralandre-3009's projects`) is currently on the **Hobby** plan. Hobby
allows **at most one execution per day** for any cron job declared in
`vercel.json`. Sub-daily schedules (`*/15`, `*/30`, hourly, etc.) cause
the deployment **to be rejected up-front** by Vercel's API with:

```
{
  "error": {
    "code": "cron_jobs_limits_reached",
    "message": "Hobby accounts are limited to daily cron jobs."
  }
}
```

This rejection happens **before** Vercel creates a deployment record —
so the failed deploy never appears in `vercel ls`, never runs the
build, and produces no useful log line. From the operator's seat it
looks as if the GitHub→Vercel webhook silently broke. From 2026-04-17
through 2026-04-18 every commit from Wave 8 onward (eight waves'
worth of code) was invisibly stranded for this reason.

## Current schedules (Hobby-compliant)

The three jobs that were originally sub-daily have been temporarily
flattened to daily so deploys succeed. Each job is idempotent and
already wraps itself in `withCronGuard()`, so reduced frequency
degrades **detection latency only**, never correctness.

| Job                 | Original cadence (Pro)        | Current cadence (Hobby) | Detection-latency cost                                                                                          |
| ------------------- | ----------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `money-reconcile`   | every 30 min (`*/30 * * * *`) | daily 04:15 UTC         | A payment-vs-order drift now takes up to 24 h to surface. SLO-08 reconciliation lag widens proportionally.      |
| `rate-limit-report` | every 15 min (`*/15 * * * *`) | daily 05:30 UTC         | Rate-limit abuse waves are detected up to 24 h later. PagerDuty pages still fire — just delayed.                |
| `dsar-sla-check`    | hourly (`0 * * * *`)          | daily 05:00 UTC         | LGPD 15-day SLA breaches are still caught (24 h granularity vs 1 h) but the warning ladder fires one day later. |

## How to restore the originals after upgrading to Pro

1. `vercel teams switch` to the right team, then upgrade the team to
   Pro (Vercel dashboard → Settings → Billing → Upgrade).
2. Edit `vercel.json` and replace the three `schedule` fields:

```diff
-      "path": "/api/cron/money-reconcile",
-      "schedule": "15 4 * * *"
+      "path": "/api/cron/money-reconcile",
+      "schedule": "*/30 * * * *"
```

```diff
-      "path": "/api/cron/dsar-sla-check",
-      "schedule": "0 5 * * *"
+      "path": "/api/cron/dsar-sla-check",
+      "schedule": "0 * * * *"
```

```diff
-      "path": "/api/cron/rate-limit-report",
-      "schedule": "30 5 * * *"
+      "path": "/api/cron/rate-limit-report",
+      "schedule": "*/15 * * * *"
```

3. `git commit -m "ops(crons): restore original sub-daily cadence after Vercel Pro upgrade"`
4. Push and verify the deploy succeeds (the Vercel API will no longer
   throw `cron_jobs_limits_reached`).
5. Update `docs/slos.md` if the relevant SLOs reference detection
   latency — the post-Pro values should be back to the originals.

## Why we recommend Pro for production

Beyond cron flexibility, Pro unlocks:

- 99.99 % uptime SLA (Hobby has no SLA — incidents are best-effort).
- 1 GB-Hours of edge function memory and concurrency limits suited
  to a B2B medical workload.
- Build concurrency > 1, so backed-up CI doesn't stall preview
  deploys.
- Region-pinning enforcement (`gru1` São Paulo) — important for
  LGPD data-residency posture.
- Audit logs retained 30 days (Hobby = 7 days).
- Ability to add team members under SSO.

For a B2B platform handling clinical data and PCI-adjacent payment
flows, the $20/month is dominated by the regulatory and operational
risk of staying on Hobby.

## Detection: why Vercel error reporting was so quiet

The `cron_jobs_limits_reached` error is returned synchronously to the
GitHub→Vercel webhook payload. Vercel **does not** retry, **does not**
create a placeholder failed deployment, and **does not** notify the
GitHub commit status check. From the developer's perspective the only
visible signal is "no deployment shows up." The mitigation is
deployment-state monitoring at the Vercel API level — see Wave 15
(secrets rotation) for a related cron that polls the latest deployment
state and pages on prolonged absence.
