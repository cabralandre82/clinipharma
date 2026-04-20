#!/usr/bin/env node
// scripts/claims/check-metric-emission.mjs
// Claim: every metric name cited in a runbook / skill / rule / AGENTS.md
// is actually emitted somewhere in the codebase — either by being listed
// in `lib/metrics.ts`'s canonical `Metrics` registry, or via a direct
// string literal passed to `incCounter` / `observeHistogram` / `setGauge`.
//
// Why: during an incident the operator follows the runbook's "look at
// money_drift_total in Grafana" step. If the metric was renamed or never
// shipped, the operator chases a ghost during a P0 — the runbook is a
// lie. This verifier makes that drift loud.
//
// Severity contract:
//   - fail  — a metric cited in a **compliance-critical** skill/runbook
//             is not emitted (money, audit-chain, DSAR, RLS canary,
//             backup, legal-hold, secret-rotation).
//   - warn  — any other doc cites a metric not emitted.
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

function walk(p, filter, acc = []) {
  if (!fs.existsSync(p)) return acc;
  const st = fs.statSync(p);
  if (st.isFile()) {
    if (filter(p)) acc.push(p);
    return acc;
  }
  if (st.isDirectory()) {
    const base = path.basename(p);
    if (base === 'node_modules' || base === '.next' || base === '.results') return acc;
    for (const e of fs.readdirSync(p)) walk(path.join(p, e), filter, acc);
  }
  return acc;
}

function read(p) { return fs.readFileSync(p, 'utf8'); }

// ─── 1. Build the EMISSION catalog ─────────────────────────────────────────
// (a) All string values in the Metrics object in lib/metrics.ts
// (b) All raw literals passed to incCounter / observeHistogram / setGauge
//     anywhere in the repo (excluding tests).

const emitted = new Set();
const emissionSource = new Map();  // metric → where we found proof

function remember(metric, where) {
  emitted.add(metric);
  if (!emissionSource.has(metric)) emissionSource.set(metric, where);
}

// (a) Canonical registry
if (fs.existsSync('lib/metrics.ts')) {
  const src = read('lib/metrics.ts');
  // Match lines like:  FOO_BAR: 'foo_bar',
  const RE_REGISTRY = /^\s*[A-Z][A-Z0-9_]*:\s*['"]([a-z][a-z0-9_]+)['"]/gm;
  let m;
  while ((m = RE_REGISTRY.exec(src)) !== null) {
    remember(m[1], 'lib/metrics.ts (registry)');
  }
}

// (b) Raw emissions across the codebase
const codeFiles = walk('.', p => {
  if (/\/(node_modules|\.next|\.git|\.results)\//.test(p)) return false;
  if (/\.(test|spec)\.(ts|tsx|mjs|js)$/.test(p)) return false;    // test doubles
  if (/\/tests?\//.test(p)) return false;
  return /\.(ts|tsx|mjs|js)$/.test(p);
});

// Matches:
//   incCounter('foo_total', ...)
//   incCounter("foo_total", ...)
//   observeHistogram(`foo_ms`, ...)
//   setGauge('foo_count', ...)
const RE_EMIT = /\b(incCounter|observeHistogram|setGauge|incrementCounter)\(\s*['"`]([a-z][a-z0-9_]+)['"`]/g;
for (const f of codeFiles) {
  const src = read(f);
  let m;
  while ((m = RE_EMIT.exec(src)) !== null) {
    remember(m[2], f);
  }
}

// ─── 2. Build the REFERENCE catalog from docs/skills/rules ─────────────────
// A "metric reference" in a markdown doc looks like:
//   - backtick-quoted snake_case ending with a Prometheus-like suffix:
//     `money_drift_total`, `rate_limit_suspicious_ips_total`, `backup_age_seconds`
//
// This is tight on purpose — bare words in prose would false-positive.

// Prometheus-canonical suffixes ONLY. Weak suffixes (`_count`, `_percent`,
// `_state`, `_depth`) collide with SQL column names and state labels in
// markdown tables — too many false positives. If a `_count` metric is
// renamed, the refactor tool / code review catches it; this verifier
// deliberately focuses on the long-tail Prom names that usually get
// copied into runbooks by humans.
const METRIC_SUFFIXES = ['total', 'ms', 'bytes', 'seconds', 'ratio', 'ts'];
const RE_REF = new RegExp(
  '`([a-z][a-z0-9_]*_(?:' + METRIC_SUFFIXES.join('|') + '))`',
  'g'
);

// Historical / planning docs: logs of what we've done or will do. Not
// operator-facing runbooks. Metric references here are aspirational or
// archival, not part of the incident-response path.
const HISTORICAL_DOC_PATTERNS = [
  /^docs\/execution-log\.md$/,
  /^docs\/PENDING\.md$/,
  /^docs\/implementation-plan\.md$/,
  /^docs\/audit-qa-plena-[^/]+\.md$/,
  /^docs\/database\/performance-baseline\.md$/,
  /^docs\/legal\/REVIEW-[^/]+\.md$/,
];
function isHistorical(p) {
  return HISTORICAL_DOC_PATTERNS.some(rx => rx.test(p));
}

const docRoots = ['docs', '.cursor/skills', '.cursor/rules', 'AGENTS.md'];
const docFiles = [];
for (const r of docRoots) {
  if (!fs.existsSync(r)) continue;
  const st = fs.statSync(r);
  if (st.isFile()) { docFiles.push(r); continue; }
  for (const f of walk(r, p => /\.(md|mdc)$/.test(p))) docFiles.push(f);
}

// Compliance-critical paths — a broken metric reference here pages the
// operator during a regulated incident, so we promote to FAIL.
const COMPLIANCE_PATH_SIGNAL = [
  /audit-chain/i,
  /money/i,
  /dsar/i,
  /rls-canary/i,
  /rls_canary/i,
  /backup-verify/i,
  /backup-freshness/i,
  /legal-hold/i,
  /legal_hold/i,
  /secret-rotate/i,
  /secret_rotation/i,
  /data-breach/i,
  /retention/i,
];

function isCompliance(p) {
  return COMPLIANCE_PATH_SIGNAL.some(rx => rx.test(p));
}

const references = new Map();  // metric → [file, ...]
for (const f of docFiles) {
  if (isHistorical(f)) continue;
  const src = read(f);
  const seen = new Set();
  let m;
  RE_REF.lastIndex = 0;
  while ((m = RE_REF.exec(src)) !== null) {
    const metric = m[1];
    if (seen.has(metric)) continue;
    seen.add(metric);
    if (!references.has(metric)) references.set(metric, []);
    references.get(metric).push(f);
  }
}

// ─── 3. Cross-reference: every reference should match an emission ──────────
//
// Allow-list: metric name *families* that are templated in docs with
// variable suffixes. Prometheus-style metric families (e.g.
// `bucket_total{bucket="auth.login"}`) are emitted once but may be
// mentioned in docs with placeholder-style variants. We're generous
// here — if the metric exactly matches an emission, pass.

for (const [metric, locations] of references.entries()) {
  if (emitted.has(metric)) {
    pass();
    continue;
  }

  // Compute nearest emission by edit-distance to help the finding be
  // actionable (suggest the most likely typo).
  const suggestion = findClosest(metric, emitted);
  const firstLoc = locations[0];
  const severity = locations.some(isCompliance) ? 'fail' : 'warn';
  const detail = suggestion
    ? `cited in ${locations.length} doc(s); closest emitted metric is '${suggestion}'`
    : `cited in ${locations.length} doc(s); no similar metric is emitted anywhere`;
  if (severity === 'fail') {
    fail(
      `metric ${metric} is emitted`,
      detail,
      firstLoc
    );
  } else {
    warn(
      `metric ${metric} is emitted`,
      detail,
      firstLoc
    );
  }
}

function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 8) return 99;  // cheap short-circuit
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}
function findClosest(target, set) {
  let best = null, bestD = 4;  // <=3 edits away to count as a suggestion
  for (const candidate of set) {
    const d = editDistance(target, candidate);
    if (d < bestD) { bestD = d; best = candidate; }
  }
  return best;
}

const warnings = findings.filter(f => f.severity === 'warn').length;
const failed   = findings.filter(f => f.severity === 'fail').length;

console.log(JSON.stringify({
  name: 'metric-emission',
  passed,
  failed,
  warnings,
  findings,
}, null, 2));

process.exit(failed > 0 ? 1 : 0);
