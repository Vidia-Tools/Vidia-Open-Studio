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

// Prod Forge submode select (parity-locked classes in style.css). The
// select picks the worker generate method: Envision -> 'envision',
// Reconstruct -> 'forge', Inspire -> 'inspire'.
const FORGE_MODE_HTML = `
  <div class="advanced-setting-label">
    Forge Mode
    <span class="hint-icon">?</span>
  </div>
  <div class="advanced-setting-control">
    <select id="forgeModeSelect" class="advanced-select">
      <option value="envision">Envision</option>
      <option value="forge">Reconstruct</option>
      <option value="inspire">Inspire</option>
    </select>
  </div>
  <div class="setting-hint">Choose how Forge processes your video: "Envision" generates a new video from your prompt and references, "Reconstruct" takes the core of your video and builds upon it, while "Inspire" creates a new video only inspired by your input.</div>
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
  // evolve "Change amount" and inspire "Creativity strength" both writing
  // `denoise` and clobbering each other).
  const mode = store.getMethod();
  if (Array.isArray(c.modes) && !c.modes.includes(mode)) return;
  // uiOnly params seed into the store (so showWhen children can key on them)
  // but are filtered out of the request payload by buildParams().
  if (c.uiOnly) store.markUiOnly(c.param);
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
  // Sub-controls (showWhen children and feature-gated children) render
  // indented; showWhen toggles get a compact checkbox look
  // (os-subcontrol-toggle) instead of the full iOS switch.
  const subCls = (c.showWhen || c.feature)
    ? ` os-subcontrol${c.showWhen && c.type === 'toggle' ? ' os-subcontrol-toggle' : ''}`
    : '';
  return `<div class="${settingCls}${subCls}"><div class="advanced-setting-label">${c.label}${hintIcon}${badge}</div><div class="advanced-setting-control">${mod.control(c, id)}</div>${hint}</div>`;
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
 * Render the Forge Envision/Reconstruct/Inspire submode select and wire it to
 * the generation method. Envision -> 'envision', Reconstruct -> 'forge',
 * Inspire -> 'inspire'.
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
  const select = container.querySelector('#forgeModeSelect');
  if (!select) return;
  const sync = () => {
    store.setMethod(select.value);
    applyVisibility();
    logDebug('Forge submode changed', { method: store.getMethod() });
  };
  select.addEventListener('change', sync);
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

// Apply modes[]/feature/showWhen visibility against current mode + store.
export function applyVisibility() {
  const mode = store.getMethod();
  const features = store.getFeatures();
  let subEnterIndex = 0;   // staggers the osSubPop entrance of sub-controls
  for (const { el, control } of rendered) {
    let visible = true;
    if (Array.isArray(control.modes) && !control.modes.includes(mode)) visible = false;
    if (control.feature && !features[control.feature]) visible = false;
    // showWhen: hide when the referenced store param's current value does not
    // match `equals`. Hidden sub-controls reset their param (and feature, for
    // feature toggles) to the control's default so disabling a parent zeroes
    // its children rather than leaking stale values into the request.
    if (visible && control.showWhen) {
      const cur = isFeatureToggle(control) ? features[control.showWhen.param] : store.getParam(control.showWhen.param);
      if (cur !== control.showWhen.equals) visible = false;
    }
    const isSub = !!(control.showWhen || control.feature);
    const wasHidden = el.style.display === 'none' || el.classList.contains('control-exit');
    if (visible) {
      el.classList.remove('control-exit');
      el.style.display = '';
      if (wasHidden) {
        // Replay the entrance animation when a control appears. Sub-controls
        // get the pronounced osSubPop with a per-sibling stagger (toggle.css)
        // instead of the generic fade-up.
        if (isSub) el.style.setProperty('--os-sub-delay', `${subEnterIndex++ * 70}ms`);
        el.classList.remove('control-enter');
        void el.offsetWidth;
        el.classList.add('control-enter');
      }
    } else if (isSub && !wasHidden) {
      // Smooth exit for sub-controls: play osSubFold, then hide when it ends.
      // The timeout fallback guarantees display:none even if the animation
      // never fires (e.g. stylesheet failed to load).
      el.classList.remove('control-enter');
      el.classList.add('control-exit');
      const finishExit = () => {
        if (el.classList.contains('control-exit')) {
          el.classList.remove('control-exit');
          el.style.display = 'none';
        }
      };
      el.addEventListener('animationend', finishExit, { once: true });
      setTimeout(finishExit, 500);
    } else if (!isSub) {
      el.style.display = 'none';
    }
    // showWhen hidden -> reset this control's store value (and feature) to its
    // default so children of a disabled parent do not ride in the payload.
    if (!visible && control.showWhen && !getControlModule(control.type).selfManaged) {
      if (isFeatureToggle(control)) store.setFeature(control.param, !!control.default);
      else store.setParam(control.param, control.default);
    }
    // strengthModes: an image-upload's strength slider is scoped to the modes
    // whose workflow actually consumes its strengthParam (e.g. the SDXL flows
    // read ipadapter_style_weight, the forge/WAN ref-image path does not).
    // Out of scope only the sub-slider hides -- the parent upload area stays --
    // and the param is cleared so it never rides in the request payload.
    if (visible && control.strengthParam && Array.isArray(control.strengthModes)) {
      const inScope = control.strengthModes.includes(mode);
      for (const s of el.querySelectorAll('.os-upload-strength, .os-upload-strength-value')) {
        s.style.display = inScope ? '' : 'none';
      }
      if (inScope) {
        const slider = el.querySelector('.os-upload-strength');
        if (slider && store.getFile(control.slot)) {
          slider.disabled = false;
          store.setParam(control.strengthParam, Number(slider.value));
        }
      } else {
        store.setParam(control.strengthParam, undefined);
      }
    }
    // Mode-scoped controls can share a param key across modes (e.g. the forge
    // and inspire `scheduler` selects). Defaults are seeded once at render
    // time under the initial method, so on a mode change the now-active
    // control must rewrite its value into the store or the stale mode's
    // value leaks into the request (inspire got forge's 'sgm_uniform' and
    // ComfyUI dropped the video output at validation).
    if (visible && Array.isArray(control.modes) && !getControlModule(control.type).selfManaged) {
      const value = readValue(control, el);
      writeStore(control, value);
      if (control.optionParams && control.optionParams[value]) {
        for (const [k, v] of Object.entries(control.optionParams[value])) store.setParam(k, v);
      }
    }
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
  // Forge defaults to the Envision submode (method 'envision'); evolve/trace
  // map their mode key directly to the worker method.
  store.setMethod(mode === 'forge' ? 'envision' : mode);

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
