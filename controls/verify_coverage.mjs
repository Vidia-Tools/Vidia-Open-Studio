// Open Studio controls coverage check (pure node stdlib, no deps).
// Flags ORPHAN simple controls: a slider/select/text/toggle whose `param` is
// not a workflow {param} tag, has no `optionParams` (derived), and is not a
// manifest feature gate. Composite controls (image-upload, lora-gallery,
// canvas-points, subject-checklist) are self-managed and skipped. Uncovered
// workflow tags are allowed (they keep their baked-in default); feature gates
// driven by the static prompt-area UI (promptEnhance, genAudio) need no
// manifest toggle. Run: node controls/verify_coverage.mjs  (exit 0 = no orphans)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOWS = path.join(HERE, '..', 'workflows');
const MANIFEST = path.join(HERE, '..', 'worker', 'src', 'pipeline', 'manifest.json');
// The renderer loads from frontend/public/controls (vite publicDir); check that set.
const CONTROLS = path.join(HERE, '..', 'frontend', 'public', 'controls');

const TAG = /\{([a-z_]+)\}/g;
const COMPOSITE = new Set(['image-upload', 'lora-gallery', 'canvas-points', 'subject-checklist']);
const SIMPLE = new Set(['slider', 'select', 'text', 'toggle']);

function collectTags() {
  const tags = new Set();
  for (const f of fs.readdirSync(WORKFLOWS).filter(n => n.endsWith('.json'))) {
    const g = JSON.parse(fs.readFileSync(path.join(WORKFLOWS, f), 'utf8'));
    for (const id of Object.keys(g)) {
      const title = (g[id]._meta && g[id]._meta.title) || '';
      let m; TAG.lastIndex = 0;
      while ((m = TAG.exec(title))) tags.add(m[1]);
    }
  }
  return tags;
}

function collectFeatures() {
  const man = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const feats = new Set();
  for (const s of man.stages) if (s.feature) feats.add(s.feature);
  return feats;
}

function collectControls() {
  const out = [];
  for (const f of fs.readdirSync(CONTROLS).filter(n => n.endsWith('.json'))) {
    const data = JSON.parse(fs.readFileSync(path.join(CONTROLS, f), 'utf8'));
    for (const c of (data.controls || [])) out.push({ ...c, file: f });
  }
  return out;
}

function main() {
  const tags = collectTags();
  const features = collectFeatures();
  const controls = collectControls();
  const gaps = [];

  // Params consumed by the pipeline runner itself (stage selection), not by any workflow tag.
  const RUNNER_PARAMS = new Set(['body_solo']);

  for (const c of controls) {
    if (COMPOSITE.has(c.type)) continue;          // self-managed; writes its own params/slots
    if (c.uiOnly) continue;                       // UI-only: seeds store for showWhen, never sent
    if (RUNNER_PARAMS.has(c.param)) continue;     // consumed by the pipeline runner, not a workflow
    if (!SIMPLE.has(c.type)) continue;            // unknown type, skip
    if (features.has(c.param)) continue;          // feature-gate toggle
    if (c.optionParams) continue;                 // derived select (T1.5)
    if (tags.has(c.param)) continue;              // maps to a real {param} tag
    gaps.push(`ORPHAN control (no {param} tag, no optionParams, not a feature): ${c.param} in ${c.file}`);
  }

  console.log(`tags=${tags.size} features=${features.size} controls=${controls.length}`);
  if (gaps.length) {
    console.log('\nGAPS:');
    for (const g of gaps) console.log('  ' + g);
    process.exit(1);
  }
  console.log('COVERAGE_OK: zero orphan controls.');
}

main();
