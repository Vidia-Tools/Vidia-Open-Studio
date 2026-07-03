// =============================================================================
// Open Studio Build Mode (ST7, local-first)
// A contributor-facing editor that talks to the local app_server.py /build/*
// endpoints to edit the pipeline manifest, upload+validate tagged workflows,
// edit a stage's controls JSON (with a live preview rendered by the existing
// controls-renderer), edit modes.json, and append dependency pins/models.
//
// Gated to local mode: only mounts when VITE_API_BASE points at a localhost
// app_server. No framework; reuses ui-factory-utilities + controls-renderer.
// No hosted write path, no auth (deferred to v1.1, see README/plan 10.4).
// EXCLUDED v1: node graph editing (edit graphs in ComfyUI, then upload here).
// =============================================================================

import { createAndInject } from '../ui/ui-factory-utilities.js';
import { controlHtml } from '../core/controls-renderer.js';

const API = (import.meta.env?.VITE_API_BASE || '').replace(/\/$/, '');

// Feature gates exposed in the controls editor (mirror the manifest features).
const FEATURE_KEYS = ['', 'fullBodyReplace', 'detailer', 'faceSwap',
  'liveportrait', 'upscaler', 'genAudio'];
const CONTROL_TYPES = ['slider', 'toggle', 'select', 'text'];

export function isLocalMode() {
  return /localhost|127\.0\.0\.1|\[::1\]/.test(API);
}

async function api(path, opts = {}) {
  const res = await fetch(API + path, opts);
  let data = {};
  try { data = await res.json(); } catch (_) { /* empty body */ }
  return { ok: res.ok, status: res.status, data };
}

function put(path, body) {
  return api(path, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const el = (html, parentId, opts) => createAndInject(html, parentId, opts);
const $ = (id) => document.getElementById(id);

function setStatus(id, msg, ok = true) {
  const node = $(id);
  if (node) {
    node.textContent = msg;
    node.style.color = ok ? '#2a7' : '#c33';
  }
}

// --- Pipeline editor ---------------------------------------------------------
let manifest = null;

function renderPipeline() {
  const host = $('bmPipeline');
  if (!host) return;
  host.innerHTML = '';
  manifest.stages.forEach((s, i) => {
    const gen = 'files' in s;
    const methodMap = gen
      ? Object.entries(s.files).map(([m, f]) =>
          `<div class="bm-row"><input data-method="${m}" value="${f}" class="bm-methodfile"> <span>(${m})</span></div>`).join('')
      : `<input class="bm-file" value="${s.file || ''}" placeholder="workflows/x.json">`;
    el(`
      <div class="bm-stage" data-i="${i}">
        <div class="bm-row">
          <strong>${i + 1}. ${s.name}</strong>
          <label><input type="checkbox" class="bm-enabled" ${s.enabled === false ? '' : 'checked'}> enabled</label>
          <button class="bm-up">↑</button><button class="bm-down">↓</button>
        </div>
        <label class="bm-row">feature gate
          <input class="bm-feature" value="${s.feature || ''}" placeholder="(none)"></label>
        <div class="bm-row">${gen ? 'method map:' : 'workflow:'} ${methodMap}</div>
      </div>`, 'bmPipeline');
  });
  host.querySelectorAll('.bm-stage').forEach(node => {
    const i = Number(node.dataset.i);
    node.querySelector('.bm-up').onclick = () => moveStage(i, -1);
    node.querySelector('.bm-down').onclick = () => moveStage(i, 1);
    node.querySelector('.bm-enabled').onchange = (e) => { manifest.stages[i].enabled = e.target.checked ? undefined : false; };
    node.querySelector('.bm-feature').onchange = (e) => { manifest.stages[i].feature = e.target.value || null; };
    const file = node.querySelector('.bm-file');
    if (file) file.onchange = (e) => { manifest.stages[i].file = e.target.value; };
    node.querySelectorAll('.bm-methodfile').forEach(inp => {
      inp.onchange = (e) => { manifest.stages[i].files[e.target.dataset.method] = e.target.value; };
    });
  });
}

function moveStage(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= manifest.stages.length) return;
  [manifest.stages[i], manifest.stages[j]] = [manifest.stages[j], manifest.stages[i]];
  renderPipeline();
}

async function loadPipeline() {
  const { ok, data } = await api('/build/manifest');
  if (!ok) return setStatus('bmPipelineStatus', 'load failed', false);
  manifest = data;
  renderPipeline();
}

async function savePipeline() {
  // Drop undefined "enabled" before save so JSON stays clean.
  manifest.stages.forEach(s => { if (s.enabled === undefined) delete s.enabled; });
  const { ok } = await put('/build/manifest', manifest);
  setStatus('bmPipelineStatus', ok ? 'manifest saved' : 'save failed', ok);
}

// --- Workflow manager --------------------------------------------------------
let uploadedGraph = null;

async function validateUpload() {
  const fileInput = $('bmWfFile');
  const f = fileInput.files[0];
  if (!f) return setStatus('bmWfStatus', 'pick a .json file first', false);
  try {
    uploadedGraph = JSON.parse(await f.text());
  } catch (e) {
    return setStatus('bmWfStatus', 'invalid JSON: ' + e.message, false);
  }
  // Validate without saving: post with a name flag but read errors first via a
  // dry call. The endpoint validates before writing and returns errors on fail,
  // so we validate by uploading to a throwaway name only on explicit Save.
  const res = await api('/build/workflow', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '__validate__.json', workflow: uploadedGraph,
      validateOnly: true }),
  });
  // Server saved __validate__.json only if valid; report either way.
  const r = res.data;
  $('bmWfResult').textContent = JSON.stringify(
    { valid: r.valid, errors: r.errors, summary: r.summary }, null, 2);
  setStatus('bmWfStatus', r.valid ? 'VALID' : 'INVALID', r.valid);
}

async function saveUpload() {
  if (!uploadedGraph) return setStatus('bmWfStatus', 'validate a workflow first', false);
  const name = $('bmWfName').value.trim();
  if (!name) return setStatus('bmWfStatus', 'enter a filename', false);
  const slot = $('bmWfSlot').value.trim();
  const method = $('bmWfMethod').value.trim();
  const body = { name, workflow: uploadedGraph };
  if (slot) body.slot = slot;
  if (method) body.method = method;
  const { data } = await api('/build/workflow', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  $('bmWfResult').textContent = JSON.stringify(data, null, 2);
  setStatus('bmWfStatus', data.saved ? `saved ${data.file}` : 'rejected', !!data.saved);
}

// --- Controls editor (with live preview) ------------------------------------
let controlsDoc = null;

function blankControl() {
  return { type: 'slider', param: '', range: [0, 1, 0.01], default: 0, label: '', modes: [] };
}

function renderControlsEditor() {
  const host = $('bmControls');
  host.innerHTML = '';
  (controlsDoc.controls || []).forEach((c, i) => {
    el(`
      <div class="bm-ctl" data-i="${i}">
        <select class="bm-c-type">${CONTROL_TYPES.map(t => `<option ${t === c.type ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <input class="bm-c-param" value="${c.param || ''}" placeholder="{param} key">
        <input class="bm-c-label" value="${c.label || ''}" placeholder="label">
        <input class="bm-c-range" value="${(c.range || []).join(',')}" placeholder="min,max,step">
        <input class="bm-c-default" value="${c.default ?? ''}" placeholder="default">
        <input class="bm-c-modes" value="${(c.modes || []).join(',')}" placeholder="modes (csv)">
        <select class="bm-c-feature">${FEATURE_KEYS.map(k => `<option ${k === (c.feature || '') ? 'selected' : ''}>${k}</option>`).join('')}</select>
        <button class="bm-c-del">remove</button>
      </div>`, 'bmControls');
  });
  host.querySelectorAll('.bm-ctl').forEach(node => {
    const i = Number(node.dataset.i);
    const read = () => {
      const c = controlsDoc.controls[i];
      c.type = node.querySelector('.bm-c-type').value;
      c.param = node.querySelector('.bm-c-param').value;
      c.label = node.querySelector('.bm-c-label').value;
      const range = node.querySelector('.bm-c-range').value.split(',').map(Number).filter(n => !isNaN(n));
      if (range.length) c.range = range; else delete c.range;
      const d = node.querySelector('.bm-c-default').value;
      c.default = d === '' ? '' : (isNaN(Number(d)) ? d : Number(d));
      const modes = node.querySelector('.bm-c-modes').value.split(',').map(s => s.trim()).filter(Boolean);
      if (modes.length) c.modes = modes; else delete c.modes;
      const feat = node.querySelector('.bm-c-feature').value;
      if (feat) c.feature = feat; else delete c.feature;
      renderPreview();
    };
    node.querySelectorAll('input,select').forEach(inp => inp.onchange = read);
    node.querySelector('.bm-c-del').onclick = () => {
      controlsDoc.controls.splice(i, 1); renderControlsEditor(); renderPreview();
    };
  });
  renderPreview();
}

function renderPreview() {
  const host = $('bmPreview');
  if (!host) return;
  host.innerHTML = (controlsDoc.controls || [])
    .filter(c => c.param)
    .map(c => `<div class="bm-prev-item">${controlHtml(c)}</div>`).join('');
}

async function loadControls() {
  const stage = $('bmCtlStage').value.trim();
  if (!stage) return setStatus('bmCtlStatus', 'enter a stage', false);
  const { ok, data } = await api(`/build/controls?stage=${encodeURIComponent(stage)}`);
  if (!ok) return setStatus('bmCtlStatus', 'load failed', false);
  controlsDoc = data.controls ? data : { stage, controls: [] };
  renderControlsEditor();
  setStatus('bmCtlStatus', `loaded ${stage}`, true);
}

async function saveControls() {
  const stage = $('bmCtlStage').value.trim();
  const { ok } = await put(`/build/controls?stage=${encodeURIComponent(stage)}`, controlsDoc);
  setStatus('bmCtlStatus', ok ? 'controls saved' : 'save failed', ok);
}

// --- Modes editor ------------------------------------------------------------
let modesDoc = null;

function renderModes() {
  const host = $('bmModes');
  host.innerHTML = '';
  modesDoc.forEach((m, i) => {
    el(`
      <div class="bm-mode" data-i="${i}">
        <input class="bm-m-key" value="${m.key || ''}" placeholder="key (generate workflow method)">
        <input class="bm-m-label" value="${m.label || ''}" placeholder="label">
        <input class="bm-m-desc" value="${m.description || ''}" placeholder="description">
        <input class="bm-m-icon" value="${m.icon || ''}" placeholder="icon">
        <button class="bm-m-del">remove</button>
      </div>`, 'bmModes');
  });
  host.querySelectorAll('.bm-mode').forEach(node => {
    const i = Number(node.dataset.i);
    const read = () => {
      modesDoc[i] = {
        key: node.querySelector('.bm-m-key').value,
        label: node.querySelector('.bm-m-label').value,
        description: node.querySelector('.bm-m-desc').value,
        icon: node.querySelector('.bm-m-icon').value,
      };
    };
    node.querySelectorAll('input').forEach(inp => inp.onchange = read);
    node.querySelector('.bm-m-del').onclick = () => { modesDoc.splice(i, 1); renderModes(); };
  });
}

async function loadModes() {
  const { ok, data } = await api('/build/modes');
  if (!ok) return setStatus('bmModesStatus', 'load failed', false);
  modesDoc = Array.isArray(data) ? data : [];
  renderModes();
}

async function saveModes() {
  const { ok } = await put('/build/modes', modesDoc);
  setStatus('bmModesStatus', ok ? 'modes saved' : 'save failed', ok);
}

// --- Dependencies helper -----------------------------------------------------
let depsDoc = null;

async function loadDeps() {
  const { ok, data } = await api('/build/dependencies');
  if (!ok) return setStatus('bmDepsStatus', 'load failed', false);
  depsDoc = data;
  setStatus('bmDepsStatus',
    `${(depsDoc.custom_nodes || []).length} nodes, ${(depsDoc.models || []).length} models`, true);
}

async function addNode() {
  if (!depsDoc) await loadDeps();
  const entry = { name: $('bmDepNodeName').value.trim(),
    repo_url: $('bmDepNodeRepo').value.trim(), commit: $('bmDepNodeCommit').value.trim() };
  if (!entry.name) return setStatus('bmDepsStatus', 'node name required', false);
  depsDoc.custom_nodes.push(entry);
  const { ok } = await put('/build/dependencies', depsDoc);
  setStatus('bmDepsStatus', ok ? `added node ${entry.name}` : 'save failed', ok);
}

async function addModel() {
  if (!depsDoc) await loadDeps();
  const entry = { filename: $('bmDepModelFile').value.trim(),
    dest_path: $('bmDepModelDest').value.trim(), url: $('bmDepModelUrl').value.trim(),
    used_by: $('bmDepModelUsedBy').value.split(',').map(s => s.trim()).filter(Boolean) };
  if (!entry.filename) return setStatus('bmDepsStatus', 'filename required', false);
  depsDoc.models.push(entry);
  const { ok } = await put('/build/dependencies', depsDoc);
  setStatus('bmDepsStatus', ok ? `added model ${entry.filename}` : 'save failed', ok);
}

// --- Shell + tabs ------------------------------------------------------------
const PANELS = `
  <div class="bm-tabs">
    <button data-tab="pipeline" class="bm-tab active">Pipeline</button>
    <button data-tab="workflows" class="bm-tab">Workflows</button>
    <button data-tab="controls" class="bm-tab">Controls</button>
    <button data-tab="modes" class="bm-tab">Modes</button>
    <button data-tab="deps" class="bm-tab">Dependencies</button>
    <button id="bmClose" class="bm-tab bm-close">close</button>
  </div>

  <section data-panel="pipeline">
    <h3>Pipeline editor</h3>
    <div id="bmPipeline"></div>
    <button id="bmPipelineSave">Save manifest</button>
    <span id="bmPipelineStatus" class="bm-status"></span>
  </section>

  <section data-panel="workflows" hidden>
    <h3>Workflow manager</h3>
    <input type="file" id="bmWfFile" accept=".json">
    <button id="bmWfValidate">Validate</button>
    <pre id="bmWfResult" class="bm-result"></pre>
    <div class="bm-row">
      <input id="bmWfName" placeholder="save as (e.g. my_stage.json)">
      <input id="bmWfSlot" placeholder="assign to manifest stage (optional)">
      <input id="bmWfMethod" placeholder="method (for generate select)">
      <button id="bmWfSave">Save + assign</button>
    </div>
    <span id="bmWfStatus" class="bm-status"></span>
  </section>

  <section data-panel="controls" hidden>
    <h3>Controls editor</h3>
    <div class="bm-row">
      <input id="bmCtlStage" placeholder="stage (e.g. generate)">
      <button id="bmCtlLoad">Load</button>
      <button id="bmCtlAdd">Add control</button>
      <button id="bmCtlSave">Save controls</button>
      <span id="bmCtlStatus" class="bm-status"></span>
    </div>
    <div class="bm-cols">
      <div id="bmControls"></div>
      <div><h4>Live preview</h4><div id="bmPreview"></div></div>
    </div>
  </section>

  <section data-panel="modes" hidden>
    <h3>Modes editor</h3>
    <div id="bmModes"></div>
    <button id="bmModesAdd">Add mode</button>
    <button id="bmModesSave">Save modes</button>
    <span id="bmModesStatus" class="bm-status"></span>
  </section>

  <section data-panel="deps" hidden>
    <h3>Dependencies helper</h3>
    <p>Pins/URLs only. This records what a new stage needs; it does not install.</p>
    <div class="bm-row"><strong>Node pin:</strong>
      <input id="bmDepNodeName" placeholder="name">
      <input id="bmDepNodeRepo" placeholder="repo_url">
      <input id="bmDepNodeCommit" placeholder="commit">
      <button id="bmDepNodeAdd">Add node</button>
    </div>
    <div class="bm-row"><strong>Model:</strong>
      <input id="bmDepModelFile" placeholder="filename">
      <input id="bmDepModelDest" placeholder="dest_path">
      <input id="bmDepModelUrl" placeholder="url">
      <input id="bmDepModelUsedBy" placeholder="used_by (csv)">
      <button id="bmDepModelAdd">Add model</button>
    </div>
    <span id="bmDepsStatus" class="bm-status"></span>
  </section>
`;

const STYLE = `
  #bmLaunch{position:fixed;bottom:16px;right:16px;z-index:9998;padding:8px 14px;
    background:#222;color:#fff;border:none;border-radius:6px;cursor:pointer}
  #bmPanel{position:fixed;inset:5% 5% 5% 5%;z-index:9999;background:#fff;color:#111;
    border:1px solid #ccc;border-radius:8px;overflow:auto;padding:16px;
    box-shadow:0 8px 40px rgba(0,0,0,.3);font-size:13px}
  #bmPanel[hidden]{display:none}
  .bm-tabs{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap}
  .bm-tab{padding:6px 12px;border:1px solid #ccc;background:#f3f3f3;cursor:pointer;border-radius:4px}
  .bm-tab.active{background:#222;color:#fff}
  .bm-close{margin-left:auto}
  .bm-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0}
  .bm-stage,.bm-ctl,.bm-mode{border:1px solid #e0e0e0;border-radius:6px;padding:8px;margin:6px 0}
  .bm-ctl input,.bm-ctl select,.bm-mode input{margin:2px}
  .bm-cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .bm-result{background:#f7f7f7;padding:8px;max-height:200px;overflow:auto;white-space:pre-wrap}
  .bm-status{font-weight:600}
  #bmPanel input,#bmPanel select{padding:4px;border:1px solid #ccc;border-radius:4px}
  #bmPanel button{padding:5px 10px;cursor:pointer}
`;

function showTab(tab) {
  document.querySelectorAll('#bmPanel .bm-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('#bmPanel section').forEach(s =>
    s.hidden = s.dataset.panel !== tab);
}

export function initBuildMode() {
  if (!isLocalMode()) return;          // hide entirely outside local mode

  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const launch = document.createElement('button');
  launch.id = 'bmLaunch';
  launch.type = 'button';
  launch.textContent = 'Build Mode';
  document.body.appendChild(launch);

  const panel = document.createElement('div');
  panel.id = 'bmPanel'; panel.hidden = true; panel.innerHTML = PANELS;
  document.body.appendChild(panel);

  $('bmLaunch').onclick = () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden && !manifest) loadPipeline();
  };
  $('bmClose').onclick = () => { panel.hidden = true; };
  panel.querySelectorAll('.bm-tab[data-tab]').forEach(b =>
    b.onclick = () => {
      showTab(b.dataset.tab);
      if (b.dataset.tab === 'modes' && !modesDoc) loadModes();
      if (b.dataset.tab === 'deps' && !depsDoc) loadDeps();
    });

  $('bmPipelineSave').onclick = savePipeline;
  $('bmWfValidate').onclick = validateUpload;
  $('bmWfSave').onclick = saveUpload;
  $('bmCtlLoad').onclick = loadControls;
  $('bmCtlAdd').onclick = () => {
    if (!controlsDoc) controlsDoc = { stage: $('bmCtlStage').value.trim(), controls: [] };
    controlsDoc.controls.push(blankControl()); renderControlsEditor();
  };
  $('bmCtlSave').onclick = saveControls;
  $('bmModesAdd').onclick = () => {
    if (!modesDoc) modesDoc = [];
    modesDoc.push({ key: '', label: '', description: '', icon: '' }); renderModes();
  };
  $('bmModesSave').onclick = saveModes;
  $('bmDepNodeAdd').onclick = addNode;
  $('bmDepModelAdd').onclick = addModel;
}
