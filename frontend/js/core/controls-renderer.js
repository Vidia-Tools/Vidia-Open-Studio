// =============================================================================
// Open Studio render-from-manifest helper (plan 10.2 T1-T4)
// Builds the generation controls UI from controls/<stage>.json + modes.json,
// applies modes[]/feature visibility, and reads values back into the
// generation store (which buildParams() consumes). Reuses ui-factory-utilities.
// Retires the per-feature hand-wiring + sampling-settings/mode-visibility.js.
// =============================================================================

import { createAndInject } from '../ui/ui-factory-utilities.js';
import { createLogger } from '../utils/logger.js';
import { getControlModule } from '../controls/registry.js';
import { getCurrentModeName, MODE } from '../config/modes.js';
import { insertLogo } from '../ui/logos.js';
import * as store from './generation-store.js';
import { updateEstimatedCost } from '../features/pricing.js';

const logDebug = createLogger('Controls');

// Base paths (URLs only). Local mode / hosted v1.1 can override via VITE.
const CONTROLS_BASE = import.meta.env?.VITE_CONTROLS_BASE || '/controls';

// Prod Forge submode toggle markup (parity-locked classes in style.css). The
// toggle picks the worker generate method: Reconstruct -> 'forge', Inspire ->
// 'hunyuan' (prod Forge/Inspire runs the Hunyuan model; see lora-data.js).
const FORGE_MODE_HTML = `
  <div class="advanced-setting-label">
    Forge Mode
    <span class="hint-icon">?</span>
  </div>
  <div class="advanced-setting-control">
    <div class="mode-toggle-container">
      <input type="checkbox" id="forgeModeToggle" class="mode-toggle-checkbox">
      <label for="forgeModeToggle" class="mode-toggle">
        <span class="mode-toggle-option">Reconstruct</span>
        <span class="mode-toggle-option">Inspire</span>
        <span class="mode-toggle-slider"></span>
      </label>
    </div>
  </div>
  <div class="setting-hint">Choose how Forge processes your video: "Reconstruct" takes the core of your video and builds upon it, while "Inspire" creates a new video only inspired by your input.</div>
`;

// Stage controls files to load (mirrors the pipeline manifest stage names).
const STAGE_FILES = [
  'prompt_prep', 'body_replace', 'generate', 'detailer', 'faceswap',
  'liveportrait', 'upscale', 'post', 'audio', 'output',
];

let controlsByStage = {};
let rendered = [];   // {el, control} for visibility passes

async function loadJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`controls load failed ${res.status}: ${url}`);
  return res.json();
}

// Seed the store with a control's default and register it as a feature/param.
function seedDefault(c) {
  if (getControlModule(c.type).selfManaged) return;  // composite controls seed themselves
  // Mode-aware: a control scoped to other modes does not seed (avoids the
  // evolve "Change amount" and hunyuan "Creativity strength" both writing
  // `denoise` and clobbering each other).
  const mode = store.getMethod();
  if (Array.isArray(c.modes) && !c.modes.includes(mode)) return;
  if (c.feature || isFeatureToggle(c)) {
    if (isFeatureToggle(c)) store.setFeature(c.param, !!c.default);
  }
  if (!isFeatureToggle(c)) store.setParam(c.param, c.default);
  // Derived select (T1.5): seed the default option's param map too.
  if (c.optionParams && c.default && c.optionParams[c.default]) {
    for (const [k, v] of Object.entries(c.optionParams[c.default])) store.setParam(k, v);
  }
}

// A feature-toggle control is a toggle whose param is a manifest feature gate.
const FEATURE_KEYS = new Set([
  'fullBodyReplace', 'detailer', 'faceSwap', 'liveportrait', 'upscaler', 'genAudio',
]);
function isFeatureToggle(c) {
  return c.type === 'toggle' && FEATURE_KEYS.has(c.param);
}

const BADGE_CLASS = { Experimental: 'experimental-badge', Legacy: 'legacy-badge', Advanced: 'advanced-badge' };

export function controlHtml(c) {
  const id = `ctl_${c.param}`;
  const mod = getControlModule(c.type);
  const hintIcon = c.hint ? ' <span class="hint-icon">?</span>' : '';
  const badge = c.badge ? ` <span class="badge ${BADGE_CLASS[c.badge] || ''}">${c.badge}</span>` : '';
  const hint = c.hint ? `<div class="setting-hint">${c.hint}</div>` : '';
  // The .defining-feature glow must sit on the .advanced-setting element so its
  // border-radius + overflow:hidden clip the animated sweep (prod parity).
  const settingCls = c.definingFeature ? 'advanced-setting defining-feature' : 'advanced-setting';
  return `<div class="${settingCls}"><div class="advanced-setting-label">${c.label}${hintIcon}${badge}</div><div class="advanced-setting-control">${mod.control(c, id)}</div>${hint}</div>`;
}

function readValue(c, el) {
  const input = el.querySelector(`#ctl_${c.param}`);
  if (!input) return c.default;
  return getControlModule(c.type).read(input);
}

function writeStore(c, value) {
  if (isFeatureToggle(c)) store.setFeature(c.param, !!value);
  else store.setParam(c.param, value);
}

/**
 * Populate prod's .mode-indicator header (title, logo, tooltip) for a mode.
 * @param {string} mode - Top-level mode key (trace | evolve | forge).
 * @returns {void}
 */
function updateModeHeader(mode) {
  const def = MODE[mode];
  if (!def) return;
  const modeInfo = document.querySelector('.mode-info');
  const logoEl = document.querySelector('.mode-logo');
  const titleEl = document.querySelector('.mode-title');
  if (modeInfo) modeInfo.setAttribute('data-tooltip', def.description);
  if (logoEl) { logoEl.innerHTML = ''; insertLogo(mode, logoEl); }
  if (titleEl) titleEl.textContent = def.title;
}

/**
 * Mirror prod's Forge submode text colouring on the toggle.
 * @param {HTMLElement} container - The forge toggle container.
 * @param {boolean} isInspire - Whether Inspire is selected.
 * @returns {void}
 */
function updateForgeToggleColors(container, isInspire) {
  const options = container.querySelectorAll('.mode-toggle-option');
  if (options.length < 2) return;
  options[0].style.color = isInspire ? 'var(--text-color)' : 'white';
  options[1].style.color = isInspire ? 'white' : 'var(--text-color)';
}

/**
 * Render the Forge Reconstruct/Inspire submode toggle and wire it to the
 * generation method. Reconstruct -> 'forge', Inspire -> 'hunyuan'.
 * @param {string} containerId - Controls container id to prepend into.
 * @returns {void}
 */
function renderForgeSubmodeToggle(containerId) {
  const container = createAndInject(FORGE_MODE_HTML, containerId, {
    id: 'forgeModeContainer',
    className: 'advanced-setting defining-feature',
    position: 'prepend',
  });
  if (!container) return;
  const toggle = container.querySelector('#forgeModeToggle');
  if (!toggle) return;
  const sync = () => {
    const isInspire = toggle.checked;
    store.setMethod(isInspire ? 'hunyuan' : 'forge');
    updateForgeToggleColors(container, isInspire);
    applyVisibility();
    logDebug('Forge submode changed', { submode: isInspire ? 'inspire' : 'reconstruct', method: store.getMethod() });
  };
  toggle.addEventListener('change', sync);
  sync();
}

// Prod's collapsible "Advanced Controls" section (style.css drives .expanded).
const ADVANCED_DROPDOWN_HTML = `
  <div class="advanced-dropdown-header">
    <div class="dropdown-line"></div>
    <div class="dropdown-label">Advanced Controls</div>
    <div class="dropdown-line"></div>
    <div class="dropdown-arrow">\u25BC</div>
  </div>
  <div class="advanced-dropdown-content" id="advanced-dropdown-content"></div>
`;

/**
 * Create the Advanced Controls dropdown shell and wire its expand/collapse,
 * mirroring prod helpers.js initializeAdvancedDropdown (toggles .expanded).
 * @param {string} containerId - Controls mount to append the dropdown into.
 * @returns {void}
 */
function renderAdvancedDropdown(containerId) {
  const dropdown = createAndInject(ADVANCED_DROPDOWN_HTML, containerId, { className: 'advanced-dropdown' });
  if (!dropdown) return;
  const header = dropdown.querySelector('.advanced-dropdown-header');
  if (header) header.addEventListener('click', () => dropdown.classList.toggle('expanded'));
}

// Apply modes[]/feature visibility against current mode + feature toggles.
export function applyVisibility() {
  const mode = store.getMethod();
  const features = store.getFeatures();
  for (const { el, control } of rendered) {
    let visible = true;
    if (Array.isArray(control.modes) && !control.modes.includes(mode)) visible = false;
    if (control.feature && !features[control.feature]) visible = false;
    el.style.display = visible ? '' : 'none';
  }
}

// Render all stage controls into the controls container. The top-level mode is
// chosen by prod's page/?mode= model (getCurrentModeName) and shown via the
// .mode-indicator; Forge exposes an in-panel Reconstruct/Inspire submode toggle.
export async function renderControls({ controlsContainerId }) {
  controlsByStage = {};
  rendered = [];

  const mode = getCurrentModeName();
  updateModeHeader(mode);
  // Forge defaults to the Reconstruct submode (method 'forge'); evolve/trace
  // map their mode key directly to the worker method.
  store.setMethod(mode === 'forge' ? 'forge' : mode);

  // Controls per stage. Controls flagged group:"advanced" are routed into the
  // collapsible Advanced Controls dropdown (created once, after main controls).
  const flat = [];
  for (const stage of STAGE_FILES) {
    controlsByStage[stage] = await loadJson(`${CONTROLS_BASE}/${stage}.json`);
    for (const control of (controlsByStage[stage].controls || [])) {
      flat.push({ stage, control });
    }
  }

  const hasAdvanced = flat.some(({ control }) => control.group === 'advanced');

  const inject = ({ stage, control }, targetId) => {
    seedDefault(control);
    const el = createAndInject(controlHtml(control), targetId, { className: `os-stage-${stage}` });
    if (!el) return;
    const input = el.querySelector(`#ctl_${control.param}`);
    if (input) {
      const mod = getControlModule(control.type);
      if (mod.mount) mod.mount(input);
      if (!mod.selfManaged) {
        input.addEventListener(mod.event, () => {
          writeStore(control, readValue(control, el));
          // Derived select: write the selected option's param map (e.g. Speed
          // Priority -> steps + speed_lora).
          if (control.optionParams) {
            const derived = control.optionParams[readValue(control, el)] || {};
            for (const [k, v] of Object.entries(derived)) store.setParam(k, v);
          }
          applyVisibility();
          updateEstimatedCost();
        });
      }
    }
    rendered.push({ el, control });
  };

  // Main controls first (in manifest order).
  for (const item of flat) {
    if (item.control.group !== 'advanced') inject(item, controlsContainerId);
  }
  // Then the Advanced Controls dropdown + its members.
  if (hasAdvanced) {
    renderAdvancedDropdown(controlsContainerId);
    for (const item of flat) {
      if (item.control.group === 'advanced') inject(item, 'advanced-dropdown-content');
    }
  }

  // Forge exposes its Reconstruct/Inspire submode toggle as the mode's
  // defining feature (prod forge-mode.js). Prepended so it sits on top.
  if (mode === 'forge') renderForgeSubmodeToggle(controlsContainerId);

  applyVisibility();
  updateEstimatedCost();
  logDebug('Controls rendered', { mode, method: store.getMethod(), stages: STAGE_FILES.length, controls: rendered.length });
}
