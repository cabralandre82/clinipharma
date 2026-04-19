# Mutation Testing — Security Surface

| Field           | Value                                                               |
| --------------- | ------------------------------------------------------------------- |
| Owner           | Platform / Security                                                 |
| Tool            | [Stryker JS](https://stryker-mutator.io/) v9.6                      |
| Test runner     | Vitest 3.x (`vitest.stryker.config.ts`)                             |
| Scope           | `lib/crypto.ts` + `lib/security/**`                                 |
| Last reviewed   | 2026-04-19                                                          |
| Current score   | **86.50 %** overall (see per-file table below)                      |
| Break floor     | **84 %** (CI fails if mutation score drops below)                   |
| Cadence         | PR (paths-filtered) + weekly cron (Mon 06:00 UTC) + manual dispatch |
| Wall-clock cost | ~3–4 min per run (~540 mutants over 184 focused tests)              |

## Why mutation testing here?

Line / branch coverage tells us "the test executed this code". Mutation
testing tells us "the test would have caught a regression in this code".
Distinct things — covered code can still survive a `===` → `!==` swap if
no assertion observes the difference.

We restrict the gate to **security-critical primitives** because:

1. They are pure, deterministic functions — fast to mutate.
2. A silent regression in any of them is exploitable (CSRF bypass,
   timing oracle, broken HMAC verify, cipher swap).
3. The cost / signal ratio is highest here — these files churn rarely
   and any change deserves intense scrutiny.

We do **not** mutate ORM queries, server actions, or React components —
the run time would explode and most mutants would be equivalent or
non-actionable.

## Files in scope

| File                            | Purpose                                      |
| ------------------------------- | -------------------------------------------- |
| `lib/crypto.ts`                 | AES-256-GCM PII encryption                   |
| `lib/security/hmac.ts`          | Constant-time compare + HMAC verify          |
| `lib/security/safe-redirect.ts` | Open-redirect defence                        |
| `lib/security/csrf.ts`          | Origin / Referer + double-submit cookie      |
| `lib/security/client-csrf.ts`   | Client helper that reads the cookie          |
| `lib/security/csp.ts`           | Content-Security-Policy builder + nonce mint |
| `lib/security/csp-report.ts`    | Browser CSP-violation payload parser         |

## Current per-file score

Measured 2026-04-19 (Stryker 9.6.1, Vitest 3.2.4, Node 22.20):

| File                            |       Score | Notes                                                                  |
| ------------------------------- | ----------: | ---------------------------------------------------------------------- |
| `lib/crypto.ts`                 |     95.92 % | 2 surviving mutants (both equivalent — see § Equivalent mutants)       |
| `lib/security/csp-report.ts`    |     95.21 % | Lifted from 45.89 % in Wave Hardening III by adding 56 dedicated tests |
| `lib/security/safe-redirect.ts` |     95.65 % | Length boundary tested explicitly                                      |
| `lib/security/csrf.ts`          |     90.21 % | Defence-in-depth ⇒ several equivalent mutants                          |
| `lib/security/client-csrf.ts`   |     79.59 % | SSR-guarded helper not exercised in jsdom — see § Known gaps           |
| `lib/security/hmac.ts`          |     73.13 % | Mostly equivalent mutants (multiple defensive layers)                  |
| `lib/security/csp.ts`           |     63.49 % | `generateNonce` internals (UUID fallback path) not coverable in jsdom  |
| **Overall**                     | **86.50 %** | break: 84, low: 85, high: 90                                           |

## Equivalent mutants (acknowledged surviving)

A mutant is **equivalent** when its bytecode differs from the original
but its observable behaviour does not — no test, however thorough, can
distinguish them. We acknowledge these explicitly so reviewers don't
chase ghosts. Examples in this codebase:

1. **`lib/security/hmac.ts:28-29`** — `if (typeof a !== 'string' || typeof b !== 'string')`
   bypassed. The downstream `Buffer.from(a, ...)` + `timingSafeEqual`
   already returns `false` for any non-string input via the `try/catch`,
   so the mutant produces the same `false` result.

2. **`lib/security/hmac.ts:68`** — `/^sha256=/` → `/sha256=/` (anchor
   removed). `String.replace(regex, '')` only replaces the first
   match; for every realistic input the first occurrence is at index 0
   regardless of the anchor, so output is identical.

3. **`lib/crypto.ts:52,57`** — early-return guards bypassed. The
   downstream `try / catch` returns the raw value unchanged via the
   "fail-open" path, so the observable result matches the original.

4. **`lib/security/csp.ts:60`** — `reportOnly = false` default flipped.
   `buildCsp` consumes `reportOnly` only via `void reportOnly`; the
   value is read elsewhere by `cspHeaderName(reportOnly)` (which has
   its own dedicated test).

5. **`lib/security/csrf.ts:163-164`** — inner-length / inner-empty
   checks in `constantTimeEqualString`. The outer `verifyDoubleSubmit`
   already short-circuits length mismatches and missing values before
   reaching this helper, so bypassing the inner check has no
   observable effect via the public API.

These survive because the modules deliberately stack multiple
defensive layers. That's a security feature, not a test gap. We
quantify (≈ 50 surviving mutants) and document them rather than
artificially inflate the score by removing the redundant guards.

## Known gaps (real, not equivalent)

- **`lib/security/csp.ts:182-185` `fallbackUuid`**. Reached only when
  `globalThis.crypto.randomUUID` is absent — never true in jsdom or
  the Edge runtime. Worth a future test that explicitly stubs the
  global.
- **`lib/security/client-csrf.ts:60-66`**. The cookie-write helper
  runs only in a real browser context (uses `document.cookie`
  side-effects in a way jsdom does not fully model). A Playwright
  unit-style test would cover it.

Both are tracked but not blockers — they raise the ceiling, not the
floor.

## How to run locally

```bash
# Full Stryker run — 3–4 min wall-clock.
npm run test:mutation

# View the HTML report.
open reports/mutation/index.html
```

The run is configured by `stryker.config.mjs` and uses the dedicated
`vitest.stryker.config.ts` so per-mutant test latency stays around
250 ms (only the seven security/crypto test files run, not the full
600+ unit suite).

## CI integration

Workflow: `.github/workflows/mutation-test.yml`.

- Runs on PRs that touch any file under the mutate set OR the test
  files for those primitives OR the Stryker config itself.
- Runs every Monday at 06:00 UTC (drift detection).
- Manual dispatch available.

The workflow:

1. Executes `npm run test:mutation`.
2. Fails if the overall score drops below the `break` threshold
   (currently **84 %**).
3. Uploads the full HTML report as the `stryker-html-report`
   workflow artifact (30-day retention).
4. Writes a per-file score table to the GitHub Actions step
   summary so reviewers see the impact at a glance without
   downloading the artifact.

## Ratchet plan

Mirroring the Vitest coverage threshold pattern:

| Date       | Trigger                                 | New `break` |
| ---------- | --------------------------------------- | ----------: |
| 2026-04-19 | Initial activation, baseline 86.50 %    |        84 % |
| TBD        | After we cover `client-csrf` write path |        86 % |
| TBD        | After CSP `fallbackUuid` dedicated test |        88 % |

Do **not** lower `break` to make a regressing PR pass — add the
missing assertion instead. If the regression is genuinely an
equivalent mutant, document it under § Equivalent mutants and
exclude it via `mutator.excludedMutations` only as a last resort.

## How to add a new file to the mutate scope

1. Add the path to `mutate` in `stryker.config.mjs`.
2. Confirm a focused unit-test file exists in `tests/unit/lib/`. If
   not, create one — mutation testing without targeted tests is just
   a slow line-coverage report.
3. Add the test file to `vitest.stryker.config.ts → include`.
4. Re-run `npm run test:mutation` locally and observe the per-file
   row in the table. Fix any `< 80 %` outliers before merging.
5. Update this document's "Files in scope" + score tables.

## How to handle a CI failure

1. Open the workflow's step summary — it lists per-file scores.
2. Download the `stryker-html-report` artifact for the line-by-line
   diff of every surviving mutant.
3. For each survivor:
   - **Killable**? Add an assertion in the matching test file. The
     comment block in `tests/unit/lib/security-mutation-kills.test.ts`
     shows the pattern: name the file:line of the mutant, then write
     the test that distinguishes it.
   - **Equivalent**? Document in § Equivalent mutants of this file
     and re-run.
4. Push the fix; the gate flips green within ~4 min.

## References

- Stryker docs: <https://stryker-mutator.io/docs/stryker-js/>
- Equivalent mutants discussion: Just, R. et al. _Are mutants a
  valid substitute for real faults in software testing?_ (FSE 2014)
- `docs/testing/strategy.md` — overall test pyramid + thresholds.
- `stryker.config.mjs` — the active gate configuration.
- `vitest.stryker.config.ts` — the focused test bundle.
- `.github/workflows/mutation-test.yml` — CI definition.
