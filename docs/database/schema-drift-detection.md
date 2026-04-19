# Schema-Drift Detection — Operational Notes

**Workflow:** `.github/workflows/schema-drift.yml`
**Status:** Layer 2 (production diff) **active** since 2026-04-19.
**Schedule:** push to `main`/`develop` on `supabase/migrations/**`,
PRs touching the same paths, daily at 04:30 UTC, and `workflow_dispatch`.

## Purpose

Catch the class of bug where a developer applies SQL directly to
production via the Supabase SQL editor without committing a migration,
or where a migration was committed but never deployed. Both produce a
schema reality that disagrees with the repo, and the cost of finding
out is usually months later when the next restore-drill diverges or a
cron job mysteriously fails.

## Layers

| Layer | Job                                            | What it does                                                                                                                                                                                                                                                                                                                                                             | Catches                                                                       |
| ----- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 1     | `parse`                                        | Spins up an ephemeral `postgres:18-alpine`, bootstraps the Supabase-shaped placeholders (auth/storage/realtime schemas, anon/authenticated/service_role roles, btree_gin/gist/pg_trgm/pgcrypto/uuid-ossp/pg_stat_statements extensions, supabase_realtime publication, stub auth.users/storage.buckets), and replays every migration in `supabase/migrations/` in order. | Migrations that don't parse. Out-of-order references. Forgotten dependencies. |
| 2     | `drift` (gated by `vars.HAS_PROD_DB_URL=true`) | `pg_dump --schema-only` both the freshly-replayed ephemeral DB and the live production database, normalises both, and `diff -u` them. Any non-empty diff fails the run and uploads `schema-drift.diff` as an artifact.                                                                                                                                                   | Anything in prod that the migrations don't produce, or vice versa.            |

## Normalisation rules (Layer 2)

The diff goes through `sed`/`grep` filters before sorting because we
care about structural drift, not cosmetic noise. Filters in order:

1. **Strip pg_dump preamble noise** — `SET …`, SQL comments,
   `\restrict`/`\unrestrict` markers (the latter contain a per-dump
   random token).
2. **Strip Supabase-platform extensions** —
   `pg_graphql`, `supabase_vault`, `pg_stat_statements`, `btree_gin`,
   `btree_gist`, `pg_trgm`. These are installed by Supabase and our
   migrations should not codify them.
3. **Strip Supabase-platform event triggers** —
   `issue_pg_cron_access`, `issue_pg_graphql_access`,
   `issue_pg_net_access`, `issue_graphql_placeholder`,
   `pgrst_ddl_watch`, `pgrst_drop_watch`, `set_graphql_placeholder`,
   `grant_pg_*_access`. Plus the standalone `WHEN TAG IN ('CREATE
EXTENSION'|'DROP EXTENSION'|'CREATE FUNCTION')` clauses that
   belong to those triggers.
4. **Strip the supabase_realtime_messages publication** — installed
   by the `supabase_realtime` extension.
5. **Whitespace normalisation** — strip leading/trailing whitespace
   and collapse interior runs of whitespace. pg_dump preserves the
   source layout of plpgsql function bodies verbatim, so a function
   authored with 4-space indent in a migration vs a 5-space indent
   in a historical Supabase SQL editor session diffs on every line
   without this pass.
6. **`sort -u`** — semantic statements like `CREATE INDEX`, `ALTER
PUBLICATION ADD TABLE`, `CREATE POLICY` are order-independent.

The exclude-schema set is symmetric on both halves of the diff:

```
auth, storage, realtime, pgbouncer, graphql, graphql_public,
extensions, vault, net, cron, supabase_functions, _realtime,
_analytics, pgsodium, pgsodium_masks, supabase_migrations
```

## Activation history (2026-04-19)

The first end-to-end run against production produced **198 lines** of
diff. Iterative classification reduced that to **0** in four commits:

| Diff size | Cause                                                                                                                                                                                                                                                                                                           | Fix                                                                                                               |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 198 → 141 | `pg_graphql`, `supabase_vault`, etc. flagged as drift; pg_dump 18 emits `\restrict` markers with random tokens                                                                                                                                                                                                  | Add platform-extension filter and `\restrict`/`\unrestrict` filter                                                |
| 141 → 81  | Layer 1 used `postgres:16-alpine` while Layer 2 used pg_dump 18 → cosmetic deltas in extension dump filtering and statement layout                                                                                                                                                                              | Bump Layer 1 to `postgres:18-alpine` and pin host pg_dump to 18                                                   |
| 81 → 19   | `WHEN TAG IN ('CREATE EXTENSION')` clauses from Supabase event triggers slipped past per-name filter; whitespace differences in function bodies                                                                                                                                                                 | Add WHEN-TAG filter and whitespace-normalisation pass                                                             |
| 19 → 0    | **Real drift:** prod was running an `ensure_rls` event trigger + `rls_auto_enable()` function that had been added via Supabase SQL editor but never committed as a migration. As a side-effect, `public.doctor_addresses` (created in 041) ended up with RLS enabled in prod while the migration never said so. | Codify both as migration `057_rls_auto_enable_safety_net.sql` and deploy to prod with `supabase db push --linked` |

A separate finding surfaced during step 4: migrations 043 through 056
were physically applied to production but had never been registered in
`supabase_migrations.schema_migrations`. They were retroactively
marked as applied with `supabase migration repair --linked --status
applied 043 044 045 046 047 048 049 050 051 052 053 054 055 056` so
that `db push` could proceed cleanly.

## On-call rotation

When the daily 04:30 UTC run fails:

1. Pull the `schema-drift-diff` artifact from the failing run:

   ```bash
   gh run download <run-id> --name schema-drift-diff
   cat schema-drift.diff
   ```

2. Read every `+` line (only in production) and every `-` line (only
   in repo). Each line is one of:
   - **Real drift you authored** — open a PR with the corresponding
     migration. Filter `+` lines for new policies, new tables, new
     indices, new columns. Recent context likely tells you who and
     when.
   - **Real drift someone else authored out-of-band** — find the
     author via Supabase audit log (Dashboard → Logs → Database →
     filter by `INSERT|UPDATE|DELETE on supabase_migrations` or the
     CREATE/ALTER statement directly). Reach out and codify it.
   - **New Supabase-platform object** — Supabase enabled a new
     extension or event trigger as part of their platform upgrade.
     Add to the `NORMALIZE` filter in `schema-drift.yml` with a
     comment explaining provenance.

3. If you can't classify a delta within an hour, page the platform
   on-call. Long-lived schema drift is what backup-restore drills
   exist to detect months later — we want to know now.

## Provisioning a fresh environment

Layer 2 is gated by **two** independent secrets so PRs from external
contributors keep working:

- `secrets.SUPABASE_DB_URL` — direct connection string to the
  read-only role pg_dump uses. Stored at the repo level.
- `vars.HAS_PROD_DB_URL` — public flag set to `'true'` once the
  secret above is provisioned. Used in the Layer 2 `if:` condition
  because secrets cannot be referenced in `if:` directly.

To rotate the credential:

```bash
gh secret set SUPABASE_DB_URL --body "$NEW_URL"
gh workflow run schema-drift.yml
```

To temporarily disable Layer 2 (rare; only during a planned schema
mutation that must intentionally diverge for a few hours):

```bash
gh api -X DELETE repos/cabralandre82/clinipharma/actions/variables/HAS_PROD_DB_URL
# … do the work, deploy, then re-enable …
gh api -X POST repos/cabralandre82/clinipharma/actions/variables \
  -f name=HAS_PROD_DB_URL -f value=true
```

## Known limitations

- **Drift in non-public schemas** is not detected. We exclude
  Supabase-managed schemas wholesale because their contents are not
  ours to track. If we ever start putting our own objects in
  `auth` or `realtime` (we shouldn't), this gate will not see them.
- **Data drift** (rows that should/shouldn't exist) is out of scope.
  See `docs/observability/slos.md` for data-integrity SLIs and the
  `cron_runs` / `audit_chain_checkpoints` tables for ongoing
  reconciliation.
- **Function semantics drift** — two functions with identical SQL
  source but different `set search_path` settings or different
  `LANGUAGE` keywords compare equal under the whitespace-normalised
  diff. This has not bitten us yet but watch out.
