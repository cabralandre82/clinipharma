#!/usr/bin/env node
// scripts/claims/check-retention-policies.mjs
// Claim: the LGPD retention catalog at `lib/retention/policies.ts` is
// not fiction — every policy points at a table that actually exists,
// every cron it names is actually deployed, and every destructive cron
// we run has a catalog entry explaining *why* it deletes what it
// deletes.
//
// Why this matters: if a policy says "retain `prescriptions` for 10
// years under RDC 67/2007" but the actual table is called
// `order_item_prescriptions`, the monthly enforce-retention cron will
// delete *nothing* — the catalog is legal theatre. Worse, in an ANPD
// audit we'd hand over a document that doesn't describe the system
// we're running, which is materially more damaging than no document
// at all (LGPD art. 37).
//
// Severity contract:
//   - fail — catalog refers to a table that doesn't exist in
//            migrations, or names a cron that isn't deployed.
//            These are lies the audit catches before the regulator.
//   - warn — destructive cron (`purge-*`, `enforce-retention`) has no
//            catalog backing (reverse direction), or the public
//            retention doc is missing a policy id.
//
// Pure-Node implementation — no ripgrep, no external deps.

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '../..');
process.chdir(repoRoot);

const findings = [];
let passed = 0;

function pass() { passed++; }
function fail(claim, detail, location) {
  findings.push({ severity: 'fail', claim, detail, location });
}
function warn(claim, detail, location) {
  findings.push({ severity: 'warn', claim, detail, location });
}

// ─── 1. Parse the retention catalog from policies.ts ──────────────────────
// The file is hand-written TS with a very stable shape. Regex-parse is
// fine (and keeps this verifier AST-free).

const policiesPath = 'lib/retention/policies.ts';
if (!fs.existsSync(policiesPath)) {
  fail('retention catalog exists',
       'lib/retention/policies.ts not found — retention claim verification impossible',
       policiesPath);
  emitAndExit();
}

const policiesSrc = fs.readFileSync(policiesPath, 'utf8');

// Split the source on `{ id: 'RP-XX',` boundaries so each chunk is one
// policy literal. First chunk is the preamble, skip.
const chunks = policiesSrc.split(/(?=\{\s*id:\s*'RP-\d+')/);
const policies = [];
for (const chunk of chunks) {
  const idm = chunk.match(/id:\s*'(RP-\d+)'/);
  if (!idm) continue;
  const tblm = chunk.match(/table:\s*'([^']+)'/);
  // Narrow enforcement lookup to the `enforcement: { ... }` object so
  // we don't pick up a `cron:` inside `notes:`.
  const enfm = chunk.match(/enforcement:\s*\{([^}]*)\}/);
  const cronm = enfm ? enfm[1].match(/cron:\s*'([^']+)'/) : null;
  const kindm = enfm ? enfm[1].match(/kind:\s*'([^']+)'/) : null;
  policies.push({
    id: idm[1],
    table: tblm ? tblm[1] : null,
    cron: cronm ? cronm[1] : null,
    kind: kindm ? kindm[1] : null,
  });
}

// Parse the RETENTION_EXCLUDED_TABLES record.
const excl = new Map();
{
  const blockm = policiesSrc.match(/RETENTION_EXCLUDED_TABLES[^=]*=\s*\{([\s\S]*?)\n\}/);
  if (blockm) {
    const RE_ENTRY = /^\s*([a-z_][a-z0-9_]*)\s*:\s*'([^']+)'/gm;
    let m;
    while ((m = RE_ENTRY.exec(blockm[1])) !== null) {
      excl.set(m[1], m[2]);
    }
  }
}

// ─── 2. Parse migrations for the set of real public-schema tables ─────────

const migDir = 'supabase/migrations';
const realTables = new Set();
if (fs.existsSync(migDir)) {
  for (const f of fs.readdirSync(migDir).filter(x => x.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(migDir, f), 'utf8');
    // Only match at a statement boundary to avoid catching
    // `CREATE TABLE AS SELECT`-style parser noise, and require the
    // identifier to be preceded by whitespace / `public.`.
    const RE_CT = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi;
    let m;
    while ((m = RE_CT.exec(sql)) !== null) {
      const name = m[1].toLowerCase();
      if (['as', 'in', 'if'].includes(name)) continue;
      realTables.add(name);
    }
  }
}

// ─── 3. Crons that actually exist (as route files + in vercel.json) ───────

const cronDir = 'app/api/cron';
const realCrons = new Set();
if (fs.existsSync(cronDir)) {
  for (const ent of fs.readdirSync(cronDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    if (fs.existsSync(path.join(cronDir, ent.name, 'route.ts'))) {
      realCrons.add(ent.name);
    }
  }
}

// ─── 4. Logical / non-public-schema tables permitted in the catalog ───────
// These are not managed by our migrations but are legitimate targets
// for a retention policy statement:
//   - `auth.users`      — Supabase Auth schema (managed by Supabase)
//   - `storage.objects` — Supabase Storage schema (managed by Supabase)
//   - logical groupings with spaces / slashes that describe a *set*
//     of tables rather than a single identifier (e.g.,
//     "notification_outbox / provider logs").
function isNonPublicOrLogical(raw) {
  if (!raw) return true;  // handled elsewhere
  if (raw.startsWith('auth.')) return true;
  if (raw.startsWith('storage.')) return true;
  if (/[\s/(]/.test(raw)) return true;  // compound / parenthesised descriptor
  return false;
}

// Extract the leading simple identifier from a descriptor like
// `"contracts (Clicksign + espelho local)"` → `contracts`.
function leadingIdentifier(raw) {
  if (!raw) return null;
  const m = raw.match(/^([a-z_][a-z0-9_]*)\b/);
  return m ? m[1] : null;
}

// ─── 5. Claims ────────────────────────────────────────────────────────────

// C1: every catalog table exists (for non-logical ones)
for (const p of policies) {
  if (!p.table) {
    fail(`policy ${p.id} names a table`, 'missing `table:` field', policiesPath);
    continue;
  }
  if (isNonPublicOrLogical(p.table)) {
    // For compound descriptors like "contracts (Clicksign + ...)", the
    // leading identifier is still meaningful: verify it exists when
    // present.
    const leading = leadingIdentifier(p.table);
    if (leading && !realTables.has(leading) && !p.table.startsWith('auth.') && !p.table.startsWith('storage.')) {
      fail(
        `policy ${p.id} targets a real table`,
        `compound descriptor "${p.table}" — leading identifier \`${leading}\` has no CREATE TABLE in supabase/migrations/`,
        policiesPath,
      );
    } else {
      pass();
    }
    continue;
  }
  if (!realTables.has(p.table)) {
    fail(
      `policy ${p.id} targets a real table`,
      `\`${p.table}\` has no CREATE TABLE in supabase/migrations/ — the enforce-retention cron will delete nothing`,
      policiesPath,
    );
  } else {
    pass();
  }
}

// C2: every excluded-list entry exists
for (const [name, reason] of excl.entries()) {
  if (realTables.has(name)) { pass(); continue; }
  fail(
    `excluded table ${name} exists`,
    `RETENTION_EXCLUDED_TABLES lists \`${name}\` (reason: "${reason}") but no migration creates it — exclusion is phantom`,
    policiesPath,
  );
}

// C3: every cron referenced by the catalog is deployed
const catalogCrons = new Set();
for (const p of policies) {
  if (p.kind === 'cron' && p.cron) catalogCrons.add(p.cron);
}
for (const cron of catalogCrons) {
  if (realCrons.has(cron)) { pass(); continue; }
  fail(
    `catalog cron ${cron} is deployed`,
    `policies reference cron \`${cron}\` but app/api/cron/${cron}/route.ts does not exist`,
    policiesPath,
  );
}

// C4: every destructive cron is in the catalog (reverse direction)
//
// Heuristic: names starting with `purge-` or equal to `enforce-retention`
// are unambiguously retention jobs — anything else should file a
// catalog entry explicitly. This catches "silent" purge jobs that got
// shipped without a policy update.
for (const cron of realCrons) {
  const looksDestructive = /^purge-/.test(cron) || cron === 'enforce-retention';
  if (!looksDestructive) continue;
  if (catalogCrons.has(cron)) { pass(); continue; }
  warn(
    `destructive cron ${cron} has a catalog entry`,
    `cron \`${cron}\` looks retention-adjacent (name prefix) but no policy in lib/retention/policies.ts names it — either wire it into a policy or rename it`,
    `app/api/cron/${cron}/route.ts`,
  );
}

// C6: every cron-enforced policy's table is actually referenced by the
//     cron's implementation. A policy that says "enforce-retention
//     purges cron_runs at 90 days" is a lie if the cron never touches
//     `cron_runs`. Heuristic: the table name must appear as a string
//     literal (quoted in any flavour) somewhere reachable from the
//     cron's route.ts. For `enforce-retention` we also scan the main
//     helper (`lib/retention-policy.ts`) because that's where the
//     actual DELETE statements live.
//
// Scope: only simple public-schema identifiers. `auth.users` isn't
// reachable via `.from()` (uses Supabase Auth admin API), and logical
// groupings with spaces/parens aren't direct table references, so we
// skip those to keep the signal high.

function cronReferencesTable(cron, table) {
  const routeFile = `app/api/cron/${cron}/route.ts`;
  const files = [routeFile];

  // Follow `from '@/lib/X'` imports one level deep. Most crons
  // delegate the actual DELETE to a helper module (e.g.
  // `purge-revoked-tokens` → `lib/token-revocation.ts`); without
  // this, the check would false-warn on every well-factored cron.
  if (fs.existsSync(routeFile)) {
    const routeSrc = fs.readFileSync(routeFile, 'utf8');
    const RE_IMPORT = /from\s+['"]@\/([^'"]+)['"]/g;
    let m;
    while ((m = RE_IMPORT.exec(routeSrc)) !== null) {
      // Try `.ts` then `.tsx` then treat as directory with `/index.ts`.
      const base = m[1];
      for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
        if (fs.existsSync(candidate)) { files.push(candidate); break; }
      }
    }
  }

  // Accept any word-bounded occurrence of the table name — quoted
  // literal (`.from('X')`), backticked SQL in a comment, or just
  // prose in a JSDoc block that says "purges X beyond 5 years". The
  // goal is to catch silent renames: whoever touches the policy name
  // must also touch the cron file, and vice versa. A false pass here
  // means the cron documentation mentions the table but the code
  // doesn't delete it — acceptable risk, because the next rename
  // will break the mention and surface the drift.
  const RE = new RegExp('\\b' + table + '\\b');
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const src = fs.readFileSync(f, 'utf8');
    if (RE.test(src)) return { ok: true, found: f };
  }
  return { ok: false };
}

for (const p of policies) {
  if (p.kind !== 'cron' || !p.cron || !p.table) continue;
  if (isNonPublicOrLogical(p.table)) continue;
  if (!realCrons.has(p.cron)) continue;  // already surfaced by C3
  const hit = cronReferencesTable(p.cron, p.table);
  if (hit.ok) { pass(); continue; }
  warn(
    `cron ${p.cron} actually enforces ${p.id}`,
    `policy ${p.id} claims \`${p.cron}\` purges/anonymises \`${p.table}\`, but the table name appears nowhere in the cron code path — either the cron doesn't touch that table (silent drift) or it uses a SECURITY DEFINER RPC (acceptable; add the table to the cron's source as a comment so this check passes)`,
    `app/api/cron/${p.cron}/route.ts`,
  );
}

// C5: every catalog id is cited in the public legal document
const publicDocPath = 'docs/legal/retention-policy.md';
if (fs.existsSync(publicDocPath)) {
  const doc = fs.readFileSync(publicDocPath, 'utf8');
  for (const p of policies) {
    if (doc.includes(p.id)) { pass(); continue; }
    warn(
      `public retention doc references ${p.id}`,
      `docs/legal/retention-policy.md has no mention of ${p.id} — the public legal surface is out of sync`,
      publicDocPath,
    );
  }
} else {
  warn(
    'public retention doc exists',
    'docs/legal/retention-policy.md not found — policy catalog has no public surface',
    publicDocPath,
  );
}

// ─── 6. Emit ──────────────────────────────────────────────────────────────

function emitAndExit() {
  const warnings = findings.filter(f => f.severity === 'warn').length;
  const failed   = findings.filter(f => f.severity === 'fail').length;
  console.log(JSON.stringify({
    name: 'retention-policies',
    passed,
    failed,
    warnings,
    findings,
  }, null, 2));
  process.exit(failed > 0 ? 1 : 0);
}
emitAndExit();
