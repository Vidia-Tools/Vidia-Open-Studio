// =============================================================================
// Control type module: vfx-gallery (Envision IC-LoRA VFX picker)
// Envision-only gallery for the LTX-2.3 22B IC-LoRA VFX adapters. Reuses the
// prod gallery drawer/card classes (style.css) via the shared card() builder
// from lora-gallery.js, but drives different worker params:
//   - ic_lora: adapter file path (officials keep the ltxv/ltx2/ prefix;
//     community adapters are bare file names). Cleared (undefined) on deselect
//     so the worker keeps the baked union-control default.
//   - vfx_trigger: uiOnly; buildParams() prepends it to the prompt.
// While an adapter is selected the use_pose/use_depth/use_canny toggles are
// forced off and disabled (IC VFX adapters replace the control signals);
// they are restored on deselect. Exactly one adapter selectable at a time.
// EditAnything additionally shows a template select + free-text instruction
// that joins the prompt prepend.
// =============================================================================

import './vfx-gallery.css';
import { createLogger } from '../utils/logger.js';
import * as store from '../core/generation-store.js';
import { card } from './lora-gallery.js';

const logDebug = createLogger('VfxGallery');

const PLACEHOLDER_IMAGE = 'https://image.civitai.com/placeholder';

// Catalog from public/data/lora-credits.json section_b_vfx + the worker's
// dependencies.json file paths. Empty trigger = none confirmed / TODO (gated
// HF repos: Day To Night, Instant Shave, Cross Eyed). Lightricks officials +
// CrossView keep the placeholder image (no Civitai gallery; HF repos gated).
const vfxLoraOptions = [
  { fileName: 'ltxv/ltx2/ltx-2.3-22b-ic-lora-water-simulation-0.9.safetensors', displayName: 'Water Simulation', image: PLACEHOLDER_IMAGE, trigger: 'ADD WATER' },
  { fileName: 'ltxv/ltx2/ltx-2.3-22b-ic-lora-day-to-night-0.9.safetensors', displayName: 'Day To Night', image: PLACEHOLDER_IMAGE, trigger: '' },
  { fileName: 'ltxv/ltx2/ltx-2.3-22b-ic-lora-instant-shave-0.9.safetensors', displayName: 'Instant Shave', image: PLACEHOLDER_IMAGE, trigger: '' },
  { fileName: 'ltxv/ltx2/ltx-2.3-22b-ic-lora-cross-eyed-0.9.safetensors', displayName: 'Cross Eyed', image: PLACEHOLDER_IMAGE, trigger: '' },
  { fileName: 'ltxv/ltx2/ltx-2.3-22b-ic-lora-colorization-0.9.safetensors', displayName: 'Colorization', image: PLACEHOLDER_IMAGE, trigger: 'COLORIZE' },
  { fileName: 'LTX23_Obscura_Remova_v1.safetensors', displayName: 'Obscura Remova', image: 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/c3b559d0-0ef5-4285-bfa1-c72a895d375b/anim=false,transcode=true,width=450/129260005.jpeg', trigger: 'Remove the object from the foreground.' },
  { fileName: 'ltx23_edit_anything_global_rank128_v1_9000steps_adamw.safetensors', displayName: 'EditAnything', image: 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/e17830bc-adaa-454c-b9bb-105574937659/anim=false,transcode=true,width=450/127899287.jpeg', trigger: '', editInstruction: true },
  { fileName: 'LTX2.3-22B_IC-LoRA-Cameraman_v2_14000.safetensors', displayName: 'Cameraman v2', image: 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/dffefa1b-a80a-469f-badc-32edbcdb1b32/anim=false,transcode=true,width=450/134815682.jpeg', trigger: '' },
  { fileName: 'LTX2.3-22B_IC-LoRA-CrossView-Prompt_v0.9_13700.safetensors', displayName: 'CrossView v1', image: PLACEHOLDER_IMAGE, trigger: 'crossview. new camera angle: <direction>, <height>, <distance>' },
];

// Control-signal toggles the IC VFX adapters replace while selected. Includes
// the master control_guide toggle: IC-LoRAs must not mix with the union
// control adapter (one IC-LoRA at a time, per AVControl training).
const FORCED_TOGGLES = ['control_guide', 'use_pose', 'use_depth', 'use_canny'];

const EDIT_TEMPLATES = ['Add', 'Remove', 'Replace', 'Convert'];

let selectedFile = null;
// Checkbox states saved when an adapter forces the control toggles off,
// restored on deselect.
let savedToggleStates = null;

/** @typedef {import('./registry.js').ControlModule} ControlModule */

/** @type {ControlModule} */
export default {
  type: 'vfx-gallery',
  selfManaged: true,

  /**
   * Build the VFX gallery button + the (hidden) EditAnything instruction row.
   * @param {object} c - Control spec (unused beyond defaults).
   * @param {string} id - DOM id for the gallery button (ctl_<param>).
   * @returns {string}
   */
  control(c, id) {
    return `<button id="${id}" class="lora-gallery-button">View VFX Gallery</button>`
      + `<div class="os-vfx-edit" style="display:none">`
      + `<select class="advanced-select os-vfx-edit-template">`
      + EDIT_TEMPLATES.map(t => `<option value="${t}">${t}</option>`).join('')
      + `</select>`
      + `<input type="text" class="os-text-input os-vfx-edit-text" placeholder="Edit instruction (e.g. a red hat on the man)">`
      + `</div>`;
  },

  /** @returns {string} The selected VFX adapter file path (or ''). */
  read() { return selectedFile || ''; },

  /**
   * Wire the gallery button, drawer, selection flow, toggle forcing and the
   * EditAnything instruction input.
   * @param {HTMLButtonElement} button - The gallery button (ctl_<param>).
   * @returns {void}
   */
  mount(button) {
    // vfx_trigger only feeds the client-side prompt prepend in buildParams();
    // it must never ride in the request payload.
    store.markUiOnly('vfx_trigger');

    const wrap = button.closest('.advanced-setting') || button.parentElement;
    const editRow = wrap.querySelector('.os-vfx-edit');
    const editTemplate = editRow.querySelector('.os-vfx-edit-template');
    const editText = editRow.querySelector('.os-vfx-edit-text');
    const drawer = ensureDrawer();
    const selectedSlot = drawer.querySelector('.lora-selected-slot');
    const galleryContent = drawer.querySelector('.lora-gallery-content');

    button.addEventListener('click', (e) => {
      e.stopPropagation();
      const opening = !drawer.classList.contains('open');
      drawer.classList.toggle('open');
      if (opening) populate(galleryContent, select);
    });

    document.addEventListener('click', (event) => {
      if (drawer.classList.contains('open') && !drawer.contains(event.target) && !button.contains(event.target)) {
        drawer.classList.remove('open');
      }
    });

    /** Recompute vfx_trigger for the selected adapter (EditAnything joins the template + free text). */
    function syncTrigger() {
      const lora = vfxLoraOptions.find(l => l.fileName === selectedFile);
      if (!lora) return;
      let trigger = lora.trigger;
      if (lora.editInstruction) {
        const text = editText.value.trim();
        trigger = text ? `${editTemplate.value} ${text}` : '';
      }
      store.setParam('vfx_trigger', trigger);
      logDebug('VFX trigger updated', { file: selectedFile, trigger });
    }

    editTemplate.addEventListener('change', syncTrigger);
    editText.addEventListener('input', syncTrigger);

    /**
     * Force the use_pose/use_depth/use_canny toggles off and disable them
     * (saving their prior states), or restore/enable them.
     * @param {boolean} forced - True while a VFX adapter is selected.
     */
    function setControlToggles(forced) {
      if (forced && !savedToggleStates) {
        savedToggleStates = {};
        for (const p of FORCED_TOGGLES) {
          const input = document.getElementById(`ctl_${p}`);
          if (!input) continue;
          savedToggleStates[p] = input.checked;
          input.checked = false;
          input.disabled = true;
          store.setParam(p, false);
        }
        logDebug('Control toggles forced off', savedToggleStates);
      } else if (!forced && savedToggleStates) {
        for (const p of FORCED_TOGGLES) {
          const input = document.getElementById(`ctl_${p}`);
          if (!input) continue;
          input.checked = !!savedToggleStates[p];
          input.disabled = false;
          store.setParam(p, !!savedToggleStates[p]);
        }
        logDebug('Control toggles restored', savedToggleStates);
        savedToggleStates = null;
      }
    }

    /**
     * Select a VFX adapter: single selection, sets ic_lora + vfx_trigger,
     * forces the control toggles off, shows the EditAnything row if needed.
     * @param {string} file - Adapter file path.
     */
    function select(file) {
      const lora = vfxLoraOptions.find(l => l.fileName === file);
      if (!lora) return;
      selectedFile = file;
      button.classList.add('lora-selected');
      store.setParam('ic_lora', file);
      setControlToggles(true);
      editRow.style.display = lora.editInstruction ? '' : 'none';
      syncTrigger();
      selectedSlot.innerHTML = '';
      selectedSlot.appendChild(card(lora, true, deselect));
      drawer.classList.remove('open');
      logDebug('VFX adapter selected', { file, trigger: lora.trigger });
    }

    /**
     * Clear the selection: ic_lora is set to undefined so the key is dropped
     * from the JSON payload and the worker keeps the union-control default.
     */
    function deselect() {
      selectedFile = null;
      button.classList.remove('lora-selected');
      selectedSlot.innerHTML = '';
      store.setParam('ic_lora', undefined);
      store.setParam('vfx_trigger', '');
      setControlToggles(false);
      editRow.style.display = 'none';
      editText.value = '';
      logDebug('VFX adapter deselected');
    }
  },

  event: 'change',
};

/**
 * Create (once) the VFX gallery drawer in document.body, reusing the prod
 * .lora-gallery-drawer classes from style.css.
 * @returns {HTMLElement}
 */
function ensureDrawer() {
  let drawer = document.getElementById('vfxGalleryDrawer');
  if (drawer) return drawer;
  drawer = document.createElement('div');
  drawer.id = 'vfxGalleryDrawer';
  drawer.className = 'lora-gallery-drawer';
  drawer.innerHTML = `
    <div class="effects-disclaimer">
      These VFX adapters are LTX-2.3 IC-LoRAs from Lightricks and community creators.
      Full attribution available on our <a href="/credits-page.html" class="disclaimer-link">credits page</a>.
    </div>
    <div class="lora-selected-slot"></div>
    <div class="lora-gallery-content"></div>`;
  document.body.appendChild(drawer);
  return drawer;
}

/**
 * Populate the VFX gallery grid, skipping the selected adapter.
 * @param {HTMLElement} content - The .lora-gallery-content container.
 * @param {Function} onSelect - (fileName) selection callback.
 * @returns {void}
 */
function populate(content, onSelect) {
  content.innerHTML = '';
  for (const lora of vfxLoraOptions) {
    if (lora.fileName === selectedFile) continue;
    content.appendChild(card(lora, false, () => onSelect(lora.fileName)));
  }
}
