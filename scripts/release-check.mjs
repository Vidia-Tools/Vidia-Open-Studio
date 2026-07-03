#!/usr/bin/env node
// Vidia Open Studio - release safety guard.
//
// Dependency-free (Node standard library only). Reads release-allowlist.txt,
// expands it against the working tree, strips forbidden local-only paths by
// rule, verifies required safe template files exist, scans included text files
// for high-risk secret patterns and real infrastructure values, and exits
// nonzero on any failure.
//
// Usage:
//   node scripts/release-check.mjs            # run the guard
//   node scripts/release-check.mjs --self-test # run built-in negative self-test
//
// This script never deletes or publishes anything. It is a read-only guard.

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, relative, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ---------------------------------------------------------------------------
// Forbidden-path rules. These are stripped UNCONDITIONALLY from the release
// set, even when an allowlisted directory pattern would otherwise match.
// ---------------------------------------------------------------------------
const FORBIDDEN_EXACT = new Set([
  '.env',
  'backend/wrangler.toml',
]);
const FORBIDDEN_SEGMENTS = new Set([
  'node_modules',
  '.wrangler',
  'dist',
  '__pycache__',
  '.git',
  '.vscode',
  '.idea',
  'tmp',
  '.cache',
]);
const FORBIDDEN_NAMES = new Set([
  '.env',
  '.env.local',
  '.env.development.local',
  '.env.test.local',
  '.env.production.local',
  '.dev.vars',
  '.DS_Store',
  'npm-debug.log',
]);
const FORBIDDEN_SUFFIXES = ['.log', '.pyc', '.pyo'];

function toPosix(p) {
  return p.split(sep).join('/');
}

function isForbidden(relPath) {
  const posix = toPosix(relPath);
  if (FORBIDDEN_EXACT.has(posix)) return true;
  const parts = posix.split('/');
  for (const part of parts) {
    if (FORBIDDEN_SEGMENTS.has(part)) return true;
    if (FORBIDDEN_NAMES.has(part)) return true;
  }
  const name = parts[parts.length - 1];
  for (const suf of FORBIDDEN_SUFFIXES) {
    if (name.endsWith(suf)) return true;
  }
  if (name.startsWith('.env.') && name.endsWith('.local')) return true;
  return false;
}

// Required safe template files that MUST exist in the release set.
const REQUIRED_TEMPLATES = ['.env.example', 'backend/wrangler.toml.example'];

// Example/template files are exempt from infrastructure-value and
// secret-variable-assignment checks (placeholders are expected there).
function isExampleOrTemplate(relPath) {
  const posix = toPosix(relPath);
  if (posix.endsWith('.example')) return true;
  if (posix === '.env.example') return true;
  if (posix.includes('.example.')) return true;
  return false;
}

// Config-ish extensions: infrastructure-value and secret-variable checks run
// only on these (and .env* names), to avoid false positives on legal/contact
// HTML, markdown, and patch files that legitimately reference public domains.
const CONFIG_EXTS = new Set([
  '.toml', '.json', '.sh', '.sh', '.yml', '.yaml', '.js', '.mjs', '.py',
  '.cfg', '.ini', '.conf', '.vars', '.env',
]);
function isConfigFile(relPath) {
  const posix = toPosix(relPath);
  const name = posix.split('/').pop();
  if (name.startsWith('.env')) return true;
  const ext = extname(posix).toLowerCase();
  return CONFIG_EXTS.has(ext);
}

// Binary extensions: content scan is skipped for these.
const BINARY_EXTS = new Set([
  '.ico', '.mp3', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.woff',
  '.woff2', '.ttf', '.eot', '.zip', '.gz', '.tar', '.7z', '.rar', '.pdf',
  '.class', '.o', '.so', '.dll', '.exe', '.pyc', '.pyo',
]);
function isLikelyBinary(relPath) {
  const ext = extname(relPath).toLowerCase();
  if (BINARY_EXTS.has(ext)) return true;
  return false;
}

function looksLikeText(buf) {
  // Null byte in the first 8KB => treat as binary.
  const slice = buf.length > 8192 ? buf.subarray(0, 8192) : buf;
  for (let i = 0; i < slice.length; i++) {
    if (slice[i] === 0) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Placeholder detection. Values that are obviously placeholders do not count
// as real secrets/infrastructure values.
// ---------------------------------------------------------------------------
function isPlaceholder(raw) {
  if (raw === undefined || raw === null) return true;
  let s = String(raw).trim();
  // Strip surrounding quotes.
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  if (!s) return true;
  if (/^<.+>$/i.test(s)) return true;
  if (/^YOUR_[A-Z0-9_]+$/i.test(s)) return true;
  if (/^your[-_][a-z0-9_-]+$/i.test(s)) return true;
  if (/change[-_]?me/i.test(s)) return true;
  if (/example\.com/i.test(s)) return true;
  if (/0xYOUR/i.test(s)) return true;
  if (/^(xxx|placeholder|test|demo|sample|todo|none|null|false|true)$/i.test(s)) return true;
  if (/your-backend/i.test(s)) return true;
  if (/workers\.dev$/i.test(s) && /your-/i.test(s)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Secret / infrastructure patterns.
// ---------------------------------------------------------------------------

// Hard secret patterns: applied to ALL included text files (including examples,
// since a real live key must never be committed anywhere).
const HARD_PATTERNS = [
  { re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/, label: 'private key block' },
  { re: /sk_live_[A-Za-z0-9]{20,}/, label: 'Stripe live secret key' },
  { re: /whsec_[A-Za-z0-9]{20,}/, label: 'Stripe webhook secret' },
  { re: /AKIA[0-9A-Z]{16}/, label: 'AWS access key id' },
  { re: /ghp_[A-Za-z0-9]{36,}/, label: 'GitHub personal access token' },
  { re: /xox[baprs]-[A-Za-z0-9-]{10,}/, label: 'Slack token' },
];

// Infrastructure-value patterns: applied only to NON-example config files.
const INFRA_PATTERNS = [
  { re: /\baccount_id\s*=\s*["']?[0-9a-f]{32}["']?/i, label: 'Cloudflare account_id (32-hex)' },
  { re: /\bACCOUNT_ID\s*=\s*["']?[0-9a-f]{32}["']?/, label: 'ACCOUNT_ID (32-hex)' },
  { re: /\bid\s*=\s*["']?[0-9a-f]{32}["']?/, label: 'KV/namespace id (32-hex)' },
];

// RunPod endpoint ID assignment with a non-placeholder value.
const RUNPOD_ENDPOINT_RE =
  /\bRUNPOD_[A-Z_]*ENDPOINT_ID\s*=\s*["']?([A-Za-z0-9_-]+)["']?/g;

// Real production domain in non-example config files.
const VIDIA_TOOLS_RE = /\bvidia\.tools\b/;

// Secret-variable assignment with a real (non-placeholder) value.
const SECRET_VAR_RE =
  /\b(JWT_SECRET|RUNPOD_CALLBACK_SECRET|RUNPOD_API_KEY|EMAIL_API_KEY|MAILERLITE_API_KEY|TURNSTILE_SECRET_KEY_[A-Z]+|S3_SECRET_ACCESS_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|HF_TOKEN|CIVITAI_TOKEN|OPENROUTER_API_KEY)\s*[=:]\s*["']?([A-Za-z0-9_\-]+)["']?/g;

function scanContent(relPath, content) {
  const findings = [];
  const example = isExampleOrTemplate(relPath);
  const config = isConfigFile(relPath);
  const lines = content.split('\n');

  const lineOf = (idx) => {
    let n = 1;
    for (let i = 0; i < idx; i++) if (content[i] === '\n') n++;
    return n;
  };

  // Hard patterns: all text files.
  for (const { re, label } of HARD_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      findings.push({ path: relPath, line: lineOf(m.index), label });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }

  if (example) return findings; // examples exempt from infra/secret-var checks.

  // Infrastructure-value patterns: non-example config files only.
  if (config) {
    for (const { re, label } of INFRA_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(content)) !== null) {
        findings.push({ path: relPath, line: lineOf(m.index), label });
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }

    // RunPod endpoint IDs with non-placeholder values.
    RUNPOD_ENDPOINT_RE.lastIndex = 0;
    let m;
    while ((m = RUNPOD_ENDPOINT_RE.exec(content)) !== null) {
      if (!isPlaceholder(m[1])) {
        findings.push({
          path: relPath,
          line: lineOf(m.index),
          label: `RunPod endpoint ID set to real value (${m[1]})`,
        });
      }
      if (m.index === RUNPOD_ENDPOINT_RE.lastIndex) RUNPOD_ENDPOINT_RE.lastIndex++;
    }

    // Real production domain in config.
    VIDIA_TOOLS_RE.lastIndex = 0;
    let vm;
    while ((vm = VIDIA_TOOLS_RE.exec(content)) !== null) {
      findings.push({
        path: relPath,
        line: lineOf(vm.index),
        label: 'real vidia.tools deployment domain in config',
      });
      if (vm.index === VIDIA_TOOLS_RE.lastIndex) VIDIA_TOOLS_RE.lastIndex++;
    }

    // Secret-variable assignments with real values.
    SECRET_VAR_RE.lastIndex = 0;
    let sm;
    while ((sm = SECRET_VAR_RE.exec(content)) !== null) {
      if (!isPlaceholder(sm[2]) && sm[2].length >= 16) {
        findings.push({
          path: relPath,
          line: lineOf(sm.index),
          label: `secret variable ${sm[1]} set to real value`,
        });
      }
      if (sm.index === SECRET_VAR_RE.lastIndex) SECRET_VAR_RE.lastIndex++;
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Allowlist parsing + expansion.
// ---------------------------------------------------------------------------
function parseAllowlist(text) {
  const patterns = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    patterns.push(line);
  }
  return patterns;
}

const WALK_PRUNE = new Set([
  'node_modules', '.wrangler', 'dist', '__pycache__', '.git', '.vscode',
  '.idea', 'tmp', '.cache',
]);

function walkDir(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.isDirectory()) {
      if (WALK_PRUNE.has(ent.name)) continue; // never descend into local-only dirs
      walkDir(join(dir, ent.name), out);
    } else if (ent.isFile()) {
      out.push(join(dir, ent.name));
    }
  }
}

function expandAllowlist(patterns) {
  const files = new Set();
  for (const pat of patterns) {
    if (pat.endsWith('/**')) {
      const dir = pat.slice(0, -3);
      const absDir = join(ROOT, dir);
      if (existsSync(absDir) && statSync(absDir).isDirectory()) {
        const found = [];
        walkDir(absDir, found);
        for (const f of found) files.add(toPosix(relative(ROOT, f)));
      }
    } else {
      const abs = join(ROOT, pat);
      if (existsSync(abs) && statSync(abs).isFile()) {
        files.add(toPosix(relative(ROOT, abs)));
      }
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Core check.
// ---------------------------------------------------------------------------
function checkReleaseSet({ included, allowMissingTemplates = false } = {}) {
  const failures = [];
  const notes = [];

  // Required template files.
  for (const t of REQUIRED_TEMPLATES) {
    if (!included.has(t)) {
      if (!allowMissingTemplates) {
        failures.push(`missing required safe template: ${t}`);
      } else {
        notes.push(`(self-test) skipping required template check for ${t}`);
      }
    }
  }

  // Forbidden files must not be in the release set.
  const forbiddenSeen = [];
  for (const f of included) {
    if (isForbidden(f)) forbiddenSeen.push(f);
  }
  for (const f of forbiddenSeen) {
    failures.push(`forbidden path included in release set: ${f}`);
  }

  // Secret scan.
  const findings = [];
  for (const rel of included) {
    if (isForbidden(rel)) continue;
    if (isLikelyBinary(rel)) continue;
    const abs = join(ROOT, rel);
    let buf;
    try {
      buf = readFileSync(abs);
    } catch {
      continue;
    }
    if (!looksLikeText(buf)) continue;
    const content = buf.toString('utf8');
    findings.push(...scanContent(rel, content));
  }
  for (const fnd of findings) {
    failures.push(`secret scan: ${fnd.path}:${fnd.line}: ${fnd.label}`);
  }

  return { failures, notes, findings, forbiddenSeen };
}

function runGuard() {
  const allowlistPath = join(ROOT, 'release-allowlist.txt');
  if (!existsSync(allowlistPath)) {
    return { ok: false, summary: 'FAIL: release-allowlist.txt not found.' };
  }
  const patterns = parseAllowlist(readFileSync(allowlistPath, 'utf8'));
  const candidates = expandAllowlist(patterns);

  // Strip forbidden paths from the release set (they stay on disk, just excluded).
  const included = new Set();
  const excluded = [];
  for (const f of [...candidates].sort()) {
    if (isForbidden(f)) {
      excluded.push(f);
    } else {
      included.add(f);
    }
  }

  const { failures, findings } = checkReleaseSet({ included });

  // Acknowledge local-only sensitive files that are present but excluded.
  const localSensitive = ['.env', 'backend/wrangler.toml'];
  const presentExcluded = localSensitive.filter((p) => existsSync(join(ROOT, p)));

  const lines = [];
  lines.push('=== Vidia Open Studio release safety guard ===');
  lines.push(`Allowlist patterns: ${patterns.length}`);
  lines.push(`Files in release set: ${included.size}`);
  lines.push(`Forbidden paths excluded: ${excluded.length}`);
  if (presentExcluded.length) {
    lines.push(
      `Local-only sensitive files present but EXCLUDED from release: ${presentExcluded.join(', ')}`,
    );
  }
  lines.push(`Required templates: ${REQUIRED_TEMPLATES.join(', ')}`);
  lines.push(`Secret-scan findings: ${findings.length}`);
  if (findings.length) {
    for (const f of findings) lines.push(`  - ${f.path}:${f.line}: ${f.label}`);
  }
  if (failures.length) {
    lines.push('--- FAILURES ---');
    for (const f of failures) lines.push(`  - ${f}`);
    lines.push('RESULT: FAIL (' + failures.length + ' issue(s))');
  } else {
    lines.push('RESULT: PASS');
  }
  return { ok: failures.length === 0, summary: lines.join('\n') };
}

// ---------------------------------------------------------------------------
// Negative self-test: prove the guard fails on synthetic bad inputs without
// touching the real working tree.
// ---------------------------------------------------------------------------
function runSelfTest() {
  const lines = [];
  let allPassed = true;

  // 1. A release set containing a forbidden exact path must fail.
  {
    const included = new Set(['.env.example', 'backend/wrangler.toml.example', '.env']);
    const { failures } = checkReleaseSet({ included, allowMissingTemplates: true });
    const ok = failures.some((f) => f.includes('forbidden path included') && f.includes('.env'));
    lines.push(`[1] forbidden .env in set -> ${ok ? 'FAIL (expected)' : 'no failure (BAD)'}`);
    if (!ok) allPassed = false;
  }

  // 2. A release set containing backend/wrangler.toml must fail.
  {
    const included = new Set([
      '.env.example',
      'backend/wrangler.toml.example',
      'backend/wrangler.toml',
    ]);
    const { failures } = checkReleaseSet({ included, allowMissingTemplates: true });
    const ok = failures.some((f) => f.includes('backend/wrangler.toml'));
    lines.push(`[2] forbidden backend/wrangler.toml in set -> ${ok ? 'FAIL (expected)' : 'no failure (BAD)'}`);
    if (!ok) allPassed = false;
  }

  // 3. A missing required template must fail.
  {
    const included = new Set(['backend/wrangler.toml.example']);
    const { failures } = checkReleaseSet({ included });
    const ok = failures.some((f) => f.includes('missing required safe template') && f.includes('.env.example'));
    lines.push(`[3] missing .env.example -> ${ok ? 'FAIL (expected)' : 'no failure (BAD)'}`);
    if (!ok) allPassed = false;
  }

  // 4. A private key in an included file must be flagged. We verify the scanner
  //    directly against synthetic content.
  {
    const findings = scanContent(
      'synthetic/config.toml',
      'JWT_SECRET = "-----BEGIN RSA PRIVATE KEY-----abcd"',
    );
    const ok = findings.some((f) => f.label.includes('private key block'));
    lines.push(`[4] private key block detected -> ${ok ? 'detected (expected)' : 'missed (BAD)'}`);
    if (!ok) allPassed = false;
  }

  // 5. A real Cloudflare account_id (32-hex) in a non-example config file must
  //    be flagged, while the same value in an example file must NOT.
  {
    const real = 'account_id = "cb5a472009030142b598cddb8e98f733"';
    const realFindings = scanContent('synthetic/wrangler.toml', real);
    const exFindings = scanContent('synthetic/wrangler.toml.example', real);
    const realOk = realFindings.some((f) => f.label.includes('account_id'));
    const exOk = exFindings.length === 0;
    lines.push(`[5] real account_id flagged in config -> ${realOk ? 'flagged (expected)' : 'missed (BAD)'}`);
    lines.push(`    same in .example exempt -> ${exOk ? 'exempt (expected)' : 'flagged (BAD)'}`);
    if (!realOk || !exOk) allPassed = false;
  }

  // 6. A placeholder RunPod endpoint ID must NOT be flagged; a real one must.
  {
    const placeholder = scanContent(
      'synthetic/wrangler.toml',
      'RUNPOD_BASIC_ENDPOINT_ID = "YOUR_BASIC_ENDPOINT_ID"',
    );
    const realVal = scanContent(
      'synthetic/wrangler.toml',
      'RUNPOD_BASIC_ENDPOINT_ID = "pa7spb8nax9idw"',
    );
    const phOk = placeholder.length === 0;
    const realOk = realVal.some((f) => f.label.includes('RunPod endpoint ID'));
    lines.push(`[6] placeholder endpoint exempt -> ${phOk ? 'exempt (expected)' : 'flagged (BAD)'}`);
    lines.push(`    real endpoint flagged -> ${realOk ? 'flagged (expected)' : 'missed (BAD)'}`);
    if (!phOk || !realOk) allPassed = false;
  }

  lines.push('');
  lines.push(allPassed ? 'SELF-TEST: PASS' : 'SELF-TEST: FAIL');
  return { ok: allPassed, summary: lines.join('\n') };
}

// ---------------------------------------------------------------------------
// CLI entry point.
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const selfTest = args.includes('--self-test');

const result = selfTest ? runSelfTest() : runGuard();
console.log(result.summary);
process.exit(result.ok ? 0 : 1);
