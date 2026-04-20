#!/usr/bin/env bash
# scripts/claims/check-invariants.sh
# Claim: a subset of AGENTS.md invariants can be machine-verified against the
# actual codebase. If code regressed vs. the documented invariant, we want a
# loud signal — otherwise the invariant is a lie.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

node <<'NODE'
const fs = require('fs');
const { execSync } = require('node:child_process');

const findings = [];
let passed = 0;

function pass(claim) { passed++; }
function fail(claim, detail, location) {
  findings.push({ severity: 'fail', claim, detail, location });
}
function warn(claim, detail, location) {
  findings.push({ severity: 'warn', claim, detail, location });
}
function exists(p) { return fs.existsSync(p); }
function read(p) { return fs.readFileSync(p, 'utf8'); }

// Pure-Node grep replacement — returns matching lines as "path:line:content".
function grep(pattern, roots, excludeDirs = []) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i');
  const matches = [];
  function visit(p) {
    if (!fs.existsSync(p)) return;
    const st = fs.statSync(p);
    if (st.isFile()) {
      // Only scan source-ish files
      if (!/\.(ts|tsx|js|mjs|sql|md|mdc|yml|yaml)$/.test(p)) return;
      const lines = fs.readFileSync(p, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) matches.push(`${p}:${i + 1}:${lines[i]}`);
      }
      return;
    }
    if (st.isDirectory()) {
      const base = require('path').basename(p);
      if (excludeDirs.includes(base)) return;
      for (const e of fs.readdirSync(p)) visit(require('path').join(p, e));
    }
  }
  for (const r of roots) visit(r);
  return matches;
}

// --- Invariant 2: AES-256-GCM + ENCRYPTION_KEY ---
if (exists('lib/crypto.ts')) {
  const src = read('lib/crypto.ts');
  if (!/aes-256-gcm/i.test(src)) {
    fail('crypto uses AES-256-GCM', "lib/crypto.ts missing 'aes-256-gcm' string", 'lib/crypto.ts');
  } else pass();
  if (!/ENCRYPTION_KEY/.test(src)) {
    fail('crypto reads ENCRYPTION_KEY', "lib/crypto.ts never references process.env.ENCRYPTION_KEY", 'lib/crypto.ts');
  } else pass();
} else {
  fail('lib/crypto.ts present', 'file missing', 'lib/crypto.ts');
}

// --- Invariant 3/4: CSP + nonce + no unsafe-inline in script-src ---
if (exists('lib/security/csp.ts')) {
  const src = read('lib/security/csp.ts');
  if (/script-src[^;]*unsafe-inline/i.test(src)) {
    fail("no 'unsafe-inline' in script-src", 'lib/security/csp.ts contains unsafe-inline in script-src directive', 'lib/security/csp.ts');
  } else pass();
  if (!/nonce/i.test(src)) {
    warn('CSP uses nonce', "lib/security/csp.ts doesn't reference nonce", 'lib/security/csp.ts');
  } else pass();
} else {
  fail('lib/security/csp.ts present', 'file missing', 'lib/security/csp.ts');
}

// --- Invariant 5: audit_logs is append-only (no raw DELETE/UPDATE outside migrations/audit infra) ---
const auditRoots = ['app', 'lib', 'components', 'scripts', 'services'];
const auditHits = grep(
  /\b(delete\s+from|update)\s+(public\.)?audit_logs\b/i,
  auditRoots,
  ['node_modules', '.next', 'audit']
).filter(h => {
  // exclude lib/audit/** and test files
  if (/\blib\/audit\b/.test(h)) return false;
  if (/\.test\.(ts|tsx|js|mjs)/.test(h)) return false;
  if (/\/tests?\//.test(h)) return false;
  return true;
});
if (auditHits.length > 0) {
  fail('audit_logs is append-only', `raw DELETE/UPDATE on audit_logs found outside lib/audit/`, auditHits[0]);
} else pass();

// --- Invariant 6: CSRF double-submit cookie + __Host-csrf ---
if (exists('lib/security/csrf.ts')) {
  const src = read('lib/security/csrf.ts');
  if (!/__Host-csrf/.test(src)) {
    warn('CSRF uses __Host-csrf cookie', "lib/security/csrf.ts doesn't reference __Host-csrf", 'lib/security/csrf.ts');
  } else pass();
} else {
  fail('lib/security/csrf.ts present', 'file missing', 'lib/security/csrf.ts');
}

// --- Invariant 7: money is cents (bigint) ---
if (exists('lib/money.ts')) {
  const src = read('lib/money.ts');
  if (!/bigint|\bcents\b/i.test(src)) {
    warn('lib/money.ts uses cents/bigint', 'no cents/bigint vocabulary found', 'lib/money.ts');
  } else pass();
} else {
  fail('lib/money.ts present', 'file missing', 'lib/money.ts');
}

// --- Invariant 8: migrations are append-only (no edits to existing SHA → out of scope here) ---
if (exists('supabase/migrations/057_rls_auto_enable_safety_net.sql')) {
  pass();
} else {
  warn('RLS safety-net migration exists', 'supabase/migrations/057_rls_auto_enable_safety_net.sql missing', 'supabase/migrations/');
}

// --- Invariant (Wave 15): X-Powered-By stripped in next.config.ts ---
if (exists('next.config.ts')) {
  const src = read('next.config.ts');
  if (!/poweredByHeader\s*:\s*false/.test(src)) {
    fail('X-Powered-By header stripped', 'next.config.ts missing poweredByHeader: false', 'next.config.ts');
  } else pass();
} else {
  fail('next.config.ts present', 'file missing', 'next.config.ts');
}

// --- Invariant 15: mutation testing threshold 84% ---
if (exists('stryker.config.mjs')) {
  const src = read('stryker.config.mjs');
  const m = src.match(/break\s*:\s*(\d+)/);
  if (!m || parseInt(m[1], 10) < 84) {
    fail('Stryker break threshold >= 84', m ? `break=${m[1]}` : 'no break threshold', 'stryker.config.mjs');
  } else pass();
} else {
  warn('stryker.config.mjs present', 'mutation-test config missing', 'stryker.config.mjs');
}

// --- Claim: 19 crons declared (matches AGENTS.md / SOLO_OPERATOR.md narrative) ---
if (exists('vercel.json')) {
  const v = JSON.parse(read('vercel.json'));
  const count = (v.crons || []).length;
  if (count === 0) {
    fail('crons declared in vercel.json', 'zero crons found', 'vercel.json');
  } else if (count < 15) {
    warn('cron count reasonable', `only ${count} crons declared (solo-operator docs claim ~16+)`, 'vercel.json');
  } else pass();
} else {
  fail('vercel.json present', 'file missing', 'vercel.json');
}

// --- Claim: required workflows exist ---
const requiredWorkflows = [
  'ci.yml',
  'cost-guard.yml',
  'external-probe.yml',
  'mutation-test.yml',
  'offsite-backup.yml',
  'restore-drill.yml',
  'schema-drift.yml',
  'zap-baseline.yml',
];
for (const wf of requiredWorkflows) {
  const p = `.github/workflows/${wf}`;
  if (!exists(p)) {
    fail(`workflow ${wf} exists`, 'file missing', p);
  } else pass();
}

// --- Claim: every skill directory has a SKILL.md ---
if (exists('.cursor/skills')) {
  for (const d of fs.readdirSync('.cursor/skills', { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const p = `.cursor/skills/${d.name}/SKILL.md`;
    if (!exists(p)) {
      fail(`skill ${d.name} has SKILL.md`, 'missing', p);
    } else pass();
  }
}

// --- Claim: every .cursor/rules/*.mdc has frontmatter with description ---
if (exists('.cursor/rules')) {
  for (const f of fs.readdirSync('.cursor/rules')) {
    if (!f.endsWith('.mdc')) continue;
    const p = `.cursor/rules/${f}`;
    const src = read(p);
    if (!src.startsWith('---')) {
      fail(`rule ${f} has frontmatter`, 'no --- delimiter', p);
      continue;
    }
    if (!/^description:\s*\S+/m.test(src)) {
      warn(`rule ${f} has description`, 'description missing in frontmatter', p);
      continue;
    }
    pass();
  }
}

// ============================================================================
//  Expansion — Wave 16 ("invariants as flywheel")
//  Added 2026-04-20. Each section below codifies an AGENTS.md rule that
//  previously relied on operator memory. Broken invariant here = real bug.
// ============================================================================

const path = require('path');

function walkFiles(root, extRe = /\.(ts|tsx)$/) {
  const out = [];
  function visit(p) {
    if (!fs.existsSync(p)) return;
    const st = fs.statSync(p);
    if (st.isFile()) {
      if (extRe.test(p)) out.push(p);
      return;
    }
    if (st.isDirectory()) {
      for (const e of fs.readdirSync(p)) visit(path.join(p, e));
    }
  }
  visit(root);
  return out;
}

// --- Invariant 16.1: every /api/*/route.ts has rate-limit OR auth gate ---
//
// Routes that reach production without either:
//   (a) rate-limit (via lib/rate-limit) — bounded abuse surface
//   (b) auth gate (requireRole / requireUser / getCurrentUser / session client)
//   (c) secret-based auth (CRON_SECRET, METRICS_SECRET, BACKUP_LEDGER_SECRET, HMAC webhook signature)
//   (d) explicit public marker (// @auth: public, // @rate-limit: skipped — <reason>)
// are bots' best friend: unauthenticated + unbounded = DoS / scraping.
//
// Framework-blanket exemptions: /api/cron (CRON_SECRET by convention),
// /api/health (platform-pinged, 0 side effects), /api/inngest (self-signed).
const apiRoutes = walkFiles('app/api').filter(p => /\/route\.(ts|tsx)$/.test(p));

const BLANKET_EXEMPT = [
  /^app\/api\/cron\//,
  /^app\/api\/health\//,
];

const PROTECTIVE_PATTERNS = [
  /from\s+['"]@\/lib\/rate-limit['"]/,
  /from\s+['"]@\/lib\/rbac['"]/,
  /from\s+['"]@\/lib\/auth\/session['"]/,
  /from\s+['"]@\/lib\/db\/server['"]/,          // SSR Supabase = session-aware
  /from\s+['"]@\/lib\/security\/hmac['"]/,
  /from\s+['"]inngest\/next['"]/,
  /\bCRON_SECRET\b/,
  /\bMETRICS_SECRET\b/,
  /\bBACKUP_LEDGER_SECRET\b/,
  /\bverifyWebhookSignature\b/,
  /\bsafeEqualString\b/,
  /\brequireRole\b/,
  /\brequireUser\b/,
  /\brequireSuperAdmin\b/,
  /\bgetCurrentUser\b/,
  /\bgetSession\b/,
  /@rate-limit:\s*skipped/i,
  /@auth:\s*public/i,
];

for (const route of apiRoutes) {
  const rel = route.replace(/^\.\//, '');
  if (BLANKET_EXEMPT.some(rx => rx.test(rel))) { pass(); continue; }
  const src = read(route);
  const protectedRoute = PROTECTIVE_PATTERNS.some(rx => rx.test(src));
  if (protectedRoute) { pass(); continue; }
  warn(
    'API route has rate-limit or auth gate',
    "no protective pattern matched — add lib/rate-limit, lib/rbac, lib/auth/session, or '// @auth: public' with rationale",
    rel
  );
}

// --- Invariant 16.2: RLS auto-enable event-trigger is installed ---
//
// Migration 057 installs a Postgres event trigger that ENABLEs RLS after
// every CREATE TABLE in `public`. This is the safety net: any future
// table shipped without explicit RLS boilerplate is still protected.
// If the trigger ever gets removed, a forgetful migration can ship an
// open table to prod. This check makes that regression impossible.
if (exists('supabase/migrations/057_rls_auto_enable_safety_net.sql')) {
  const src = read('supabase/migrations/057_rls_auto_enable_safety_net.sql');
  const hasFn = /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.rls_auto_enable/i.test(src);
  const hasTrigger = /CREATE\s+EVENT\s+TRIGGER\s+ensure_rls/i.test(src);
  if (!hasFn) {
    fail('RLS auto-enable function exists', 'public.rls_auto_enable() not declared in 057', 'supabase/migrations/057_rls_auto_enable_safety_net.sql');
  } else pass();
  if (!hasTrigger) {
    fail('RLS ensure_rls event trigger exists', 'CREATE EVENT TRIGGER ensure_rls missing in 057', 'supabase/migrations/057_rls_auto_enable_safety_net.sql');
  } else pass();
} else {
  fail('RLS safety net migration exists', '057_rls_auto_enable_safety_net.sql missing', 'supabase/migrations/');
}

// --- Invariant 16.3: migrations numbered sequentially with no gaps ---
//
// Gaps signal: (a) a file was deleted (migrations are append-only), or
// (b) two developers raced on numbering. Both indicate the CI pipeline
// missed a blocker upstream.
if (exists('supabase/migrations')) {
  const nums = fs.readdirSync('supabase/migrations')
    .filter(f => /^\d{3}_.+\.sql$/.test(f))
    .map(f => parseInt(f.slice(0, 3), 10))
    .sort((a, b) => a - b);
  let gapFound = false;
  for (let i = 0; i < nums.length; i++) {
    const expected = i + 1;
    if (nums[i] !== expected) {
      fail(
        'migrations numbered sequentially',
        `gap: expected ${String(expected).padStart(3, '0')}, found ${String(nums[i]).padStart(3, '0')}`,
        'supabase/migrations/'
      );
      gapFound = true;
      break;
    }
  }
  if (!gapFound && nums.length > 0) pass();
}

// --- Invariant 16.4: .env.example contains no real secrets ---
//
// .env.example is commit-ed. A real secret here = instant leak on the
// next `git clone`. Guard against patterns of known credential shapes.
if (exists('.env.example')) {
  const src = read('.env.example');
  const SECRET_PATTERNS = [
    // Resend keys: re_ + base62 (20+ chars)
    { re: /\bre_[A-Za-z0-9]{20,}/,             name: 'Resend API key' },
    // Vercel personal tokens: vcp_ / vrc_ / tok_ + base62
    { re: /\b(vcp|vrc|tok)_[A-Za-z0-9]{20,}/,  name: 'Vercel token' },
    // OpenAI keys: sk-[A-Za-z0-9]{20+}
    { re: /\bsk-[A-Za-z0-9]{20,}/,             name: 'OpenAI-style secret key' },
    // GitHub PATs: ghp_ / ghs_ / github_pat_
    { re: /\b(ghp|ghs|ghu)_[A-Za-z0-9]{20,}/,  name: 'GitHub PAT' },
    { re: /\bgithub_pat_[A-Za-z0-9_]{20,}/,    name: 'GitHub fine-grained PAT' },
    // JWT (header.payload.signature, base64url, 3 parts)
    { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, name: 'JWT' },
    // AWS access keys
    { re: /\bAKIA[0-9A-Z]{16}\b/,              name: 'AWS access key ID' },
    // Supabase service role key pattern (we can't detect generically, but
    // the sr key is long base64; placeholders like "your_...", "<foo>",
    // and "xxx" wouldn't match this).
    // NOTE: kept loose on purpose to avoid false positives on placeholders.
  ];
  let hit = false;
  for (const { re, name } of SECRET_PATTERNS) {
    const m = src.match(re);
    if (m) {
      fail(
        '.env.example contains no real secrets',
        `matched pattern for "${name}" — revoke immediately and replace with placeholder`,
        '.env.example'
      );
      hit = true;
    }
  }
  if (!hit) pass();
} else {
  warn('.env.example present', 'file missing — new contributors have no template', '.env.example');
}

// --- Invariant 16.5: /(private) layout redirects unauthenticated users ---
//
// Next.js App Router: auth for a whole subtree is enforced by the subtree's
// layout.tsx. If someone forgets this, every private page leaks. We look for
// three signals in app/(private)/layout.tsx:
//   1. imports getCurrentUser or requireRole / requireUser
//   2. imports `redirect` from 'next/navigation'
//   3. redirects to /login (or /unauthorized)
const privLayout = 'app/(private)/layout.tsx';
if (exists(privLayout)) {
  const src = read(privLayout);
  const hasAuthRead = /\b(getCurrentUser|requireRole|requireUser|requireSuperAdmin|getSession)\b/.test(src);
  const hasRedirect = /from\s+['"]next\/navigation['"]/.test(src) && /\bredirect\s*\(/.test(src);
  const goesToLogin = /redirect\(['"`]\/(login|unauthorized|sign-in)/i.test(src);
  if (!hasAuthRead)  fail('private layout reads session', "no getCurrentUser/requireRole/requireUser in app/(private)/layout.tsx", privLayout);
  else pass();
  if (!hasRedirect)  fail('private layout uses redirect()', "no import+call of next/navigation redirect()", privLayout);
  else pass();
  if (!goesToLogin)  fail('private layout redirects to /login', "no redirect('/login' | '/unauthorized' | '/sign-in') call found", privLayout);
  else pass();
} else {
  fail('app/(private)/layout.tsx exists', 'file missing — every private page is unguarded', privLayout);
}

// --- Invariant 16.6: compliance crons are documented somewhere ---
//
// A separate verifier (check-cron-claims.mjs) already warns on undocumented
// crons. This invariant promotes the **compliance-critical** ones to fail,
// because an undocumented compliance cron means operator gets paged with no
// runbook. Upstream regulators (LGPD, ANPD) expect these crons; losing the
// reference is a real drift risk.
const COMPLIANCE_CRONS = [
  '/api/cron/verify-audit-chain',
  '/api/cron/backup-freshness',
  '/api/cron/rls-canary',
  '/api/cron/dsar-sla-check',
  '/api/cron/rotate-secrets',
  '/api/cron/enforce-retention',
];
const docRoots = ['docs', '.cursor/skills', '.cursor/rules', 'AGENTS.md'];
const docFiles = [];
for (const r of docRoots) {
  if (!fs.existsSync(r)) continue;
  const st = fs.statSync(r);
  if (st.isFile()) { docFiles.push(r); continue; }
  for (const f of walkFiles(r, /\.(md|mdc)$/)) docFiles.push(f);
}
const docCorpus = docFiles.map(f => read(f)).join('\n');
for (const cron of COMPLIANCE_CRONS) {
  if (docCorpus.includes(cron)) pass();
  else fail(
    `compliance cron ${cron} is documented`,
    'operator would get paged with no runbook — add reference in a skill or runbook',
    'docs/ + .cursor/'
  );
}

const warnings = findings.filter(f => f.severity === 'warn').length;
const failed = findings.filter(f => f.severity === 'fail').length;

console.log(JSON.stringify({ name: 'invariants', passed, failed, warnings, findings }, null, 2));
process.exit(failed > 0 ? 1 : 0);
NODE
