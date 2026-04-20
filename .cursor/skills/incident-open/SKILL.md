---
name: incident-open
description: Opens a structured incident on Clinipharma — creates the tracking GitHub issue, captures state snapshot, routes to the right runbook. Use when the user says "got an alert", "começou um incidente", "P1", "P2", "Sentry paginated me", or when any automated alert fires (ZAP, schema-drift, audit-chain, synthetic probe).
---

# Open a production incident

Use this as the **first action** any time an alert fires. It normalises
the "how do I start" question so you always have a tracked state
snapshot + a pointer to the specific runbook.

## Workflow — copy this checklist into the issue body

```
Incident progress:
- [ ] 1. Severity classified (P1/P2/P3)
- [ ] 2. GitHub issue opened with `incident` label
- [ ] 3. State snapshot captured (BEFORE any mitigation)
- [ ] 4. Root runbook identified and linked
- [ ] 5. Containment applied (first 5 min)
- [ ] 6. Diagnostic performed
- [ ] 7. Mitigation in place
- [ ] 8. Root cause fixed or ticketed
- [ ] 9. Post-mortem (required for P1/P2 within 72h)
```

## Step 1 — classify severity

Use this decision tree. When in doubt, pick the HIGHER severity.

| Severity | Definition                                                             | Response time     |
| -------- | ---------------------------------------------------------------------- | ----------------- |
| **P1**   | Customer-impacting OR legal/compliance exposure OR data integrity risk | Now               |
| **P2**   | Customer degraded (can work around) OR non-exploited security finding  | Same business day |
| **P3**   | Silent degradation, backlog, non-urgent quality issues                 | Next sprint       |

P1 triggers include: audit-chain tamper, RLS violation with `page_on_violation=ON`, payment stuck > 15 min, DB unreachable, prod down, confirmed secret compromise.

## Step 2 — open the tracking issue

```bash
gh issue create \
  --title "🚨 P<N> — <short-symptom> (<YYYY-MM-DD HH:MM> UTC)" \
  --label incident,severity:p<N>,<area> \
  --body "$(cat <<'EOF'
## Symptom
<what the alert said, verbatim>

## Source
<alert name + link to Sentry / workflow run / cron log>

## Runbook
docs/runbooks/<name>.md

## Timeline (append as you go)
- $(date -u +"%H:%M:%SZ") — incident opened
EOF
)"
```

Area labels: `security`, `compliance`, `database`, `payments`, `infra`, `observability`.

## Step 3 — capture state BEFORE any action

NEVER mitigate before snapshotting. The snapshot is the forensic trail.

Minimum snapshot (always):

```bash
# Recent cron runs (last 24h)
gh run list --limit 20 --json status,conclusion,name,createdAt,databaseId

# Open incident-labelled issues (context)
gh issue list --label incident --state open

# Recent audit-chain verification status
gh run list --workflow=restore-drill.yml --limit 3
```

Area-specific snapshots:

- **Database / data integrity** → attach output of the runbook's first SQL query (search for `Primeiro broken seq` / `first broken row` in the runbook) to the issue.
- **Security / auth** → attach `gh issue list --label security --state all --limit 20` + last 3 Sentry events.
- **Compliance / legal** → attach relevant `audit_logs` slice. Never modify `audit_logs`.

Paste snapshot as a collapsed `<details>` block in the issue.

## Step 4 — route to the specific runbook

Map symptom → runbook → specific skill (if available).

| Alert / symptom                       | Runbook                                      | Companion skill               |
| ------------------------------------- | -------------------------------------------- | ----------------------------- |
| `audit chain tampered`                | `docs/runbooks/audit-chain-tampered.md`      | `audit-chain-verify`          |
| DSAR SLA breach                       | `docs/runbooks/dsar-sla-missed.md`           | `dsar-fulfill`                |
| ZAP baseline Medium+                  | `docs/security/dynamic-scanning.md`          | (triage inline; no skill yet) |
| Schema drift                          | `.github/workflows/schema-drift.yml`         | (no skill yet)                |
| RLS canary                            | `docs/runbooks/rls-violation.md`             | `rls-violation-triage`        |
| Secret rotation overdue               | `docs/runbooks/secret-rotation.md`           | `secret-rotate`               |
| Secret compromise                     | `docs/runbooks/secret-compromise.md`         | `secret-compromise`           |
| Legal hold request                    | `docs/runbooks/legal-hold-received.md`       | `legal-hold-apply`            |
| Backup missing / restore drill failed | `docs/runbooks/backup-missing.md`            | `backup-verify`               |
| External probe failing                | `docs/observability/synthetic-monitoring.md` | (triage inline)               |
| DAST finding                          | `docs/security/dynamic-scanning.md`          | (triage inline)               |
| Money drift                           | `docs/runbooks/money-drift.md`               | (no skill yet)                |

If no runbook exists for the symptom, create one from `docs/runbooks/_template.md` before mitigating (unless lives are at stake — then mitigate, retrofit the runbook in the post-mortem).

## Step 5 — hand off to the specific skill

After the issue exists and snapshot is attached, say explicitly:

> Following runbook `<name>`. Companion skill: `<skill-name>`.

Then execute the specific skill. Do NOT merge the two — this skill
closes after handoff; the specific skill owns the body of the response.

## Step 6 — never skip the post-mortem

For every P1/P2, within 72h of resolution:

```bash
gh issue create \
  --title "post-mortem: <incident-title>" \
  --label postmortem \
  --body-file .github/ISSUE_TEMPLATE/postmortem.md
```

Close the incident issue with a link to the post-mortem, not with "fixed".

## Anti-patterns

- **Do NOT mitigate first, snapshot later.** Irreversible on forensic trails.
- **Do NOT skip severity classification** ("it's just a warning" — most warnings are real).
- **Do NOT update/delete rows in `audit_logs` or `dsar_audit`** under any circumstance. Append-only.
- **Do NOT fire parallel mitigations** without a second person approving — you'll miss which one worked.

## Related

- Full list of runbooks: `docs/runbooks/README.md`
- Solo-operator ritmo: `docs/SOLO_OPERATOR.md` §2
- Severity matrix: `docs/on-call.md` (if exists)
