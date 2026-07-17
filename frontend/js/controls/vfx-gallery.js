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
// Instruction-driven adapters (EditAnything, Obscura Remova, CrossView)
// declare custom inputs + a buildTrigger() that composes the prompt prepend.
// =============================================================================

import './vfx-gallery.css';
import { createLogger } from '../utils/logger.js';
import * as store from '../core/generation-store.js';
import { card, animateToSlot } from './lora-gallery.js';
import { applyDisabledState } from '../ui/ui-style-constants.js';

const logDebug = createLogger('VfxGallery');

const PLACEHOLDER_IMAGE = 'https://image.civitai.com/placeholder';

// Catalog from public/data/lora-credits.json section_b_vfx + the worker's
// dependencies.json file paths. Empty trigger = none confirmed / TODO (gated
// HF repos: Day To Night, Instant Shave, Cross Eyed). Instruction-driven
// adapters carry `inputs` (rendered in the row under the gallery button) and
// `buildTrigger(values)` composing the prompt prepend from those inputs.
// Officials + CrossView have no Civitai gallery (gated HF repos): thematic
// Unsplash stock images are hotlinked instead (codebase hosts no images).
const vfxLoraOptions = [
  { fileName: 'ltxv/ltx2/ltx-2.3-22b-ic-lora-water-simulation-0.9.safetensors', displayName: 'Water Simulation', image: 'https://images.unsplash.com/photo-1505142468610-359e7d316be0?w=450&q=70&fm=jpg', trigger: 'ADD WATER' },
  { fileName: 'ltxv/ltx2/ltx-2.3-22b-ic-lora-day-to-night-0.9.safetensors', displayName: 'Day To Night', image: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=450&q=70&fm=jpg', trigger: '' },
  { fileName: 'ltxv/ltx2/ltx-2.3-22b-ic-lora-instant-shave-0.9.safetensors', displayName: 'Instant Shave', image: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=450&q=70&fm=jpg', trigger: '' },
  { fileName: 'ltxv/ltx2/ltx-2.3-22b-ic-lora-cross-eyed-0.9.safetensors', displayName: 'Cross Eyed', image: 'https://images.unsplash.com/photo-1494869042583-f6c911f04b4c?w=450&q=70&fm=jpg', trigger: '' },
  { fileName: 'ltxv/ltx2/ltx-2.3-22b-ic-lora-colorization-0.9.safetensors', displayName: 'Colorization', image: 'https://images.unsplash.com/photo-1502691876148-a84978e59af8?w=450&q=70&fm=jpg', trigger: 'COLORIZE' },
  {
    fileName: 'LTX23_Obscura_Remova_v1.safetensors',
    displayName: 'Obscura Remova',
    image: 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/c3b559d0-0ef5-4285-bfa1-c72a895d375b/anim=false,transcode=true,width=450/129260005.jpeg',
    trigger: 'Remove the object from the foreground.',
    inputs: [
      { name: 'object', kind: 'text', placeholder: 'Object to remove (e.g. the lamppost)' },
    ],
    buildTrigger: (v) => v.object ? `Remove ${v.object} from the video.` : 'Remove the object from the foreground.',
  },
  {
    fileName: 'ltx23_edit_anything_global_rank128_v1_9000steps_adamw.safetensors',
    displayName: 'EditAnything',
    image: 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/e17830bc-adaa-454c-b9bb-105574937659/anim=false,transcode=true,width=450/127899287.jpeg',
    trigger: '',
    inputs: [
      { name: 'template', kind: 'select', options: ['Add', 'Remove', 'Replace', 'Convert'] },
      { name: 'text', kind: 'text', placeholder: 'Edit instruction (e.g. a red hat on the man)' },
    ],
    buildTrigger: (v) => v.text ? `${v.template} ${v.text}` : '',
  },
  { fileName: 'LTX2.3-22B_IC-LoRA-Cameraman_v2_14000.safetensors', displayName: 'Cameraman v2', image: 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/dffefa1b-a80a-469f-badc-32edbcdb1b32/anim=false,transcode=true,width=450/134815682.jpeg', trigger: '' },
  {
    fileName: 'LTX2.3-22B_IC-LoRA-CrossView-Prompt_v0.9_13700.safetensors',
    displayName: 'CrossView v1',
    image: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=450&q=70&fm=jpg',
    trigger: '',
    inputs: [
      { name: 'direction', kind: 'select', options: ['front', 'back', 'left side', 'right side', 'three-quarter left', 'three-quarter right'] },
      { name: 'height', kind: 'select', options: ['eye level', 'high angle', 'low angle', 'overhead'] },
      { name: 'distance', kind: 'select', options: ['close-up', 'medium distance', 'far away'] },
    ],
    buildTrigger: (v) => `crossview. new camera angle: ${v.direction}, ${v.height}, ${v.distance}`,
  },
];

// Control-signal toggles the IC VFX adapters replace while selected. Includes
// the master control_guide toggle: IC-LoRAs must not mix with the union
// control adapter (one IC-LoRA at a time, per AVControl training).
const FORCED_TOGGLES = ['control_guide', 'use_pose', 'use_depth', 'use_canny'];

const FORCED_REASON = 'Unavailable while a VFX adapter is selected: VFX IC-LoRAs replace the control guidance signals.';

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
   * Build the VFX gallery button + the (hidden) per-adapter instruction row.
   * @param {object} c - Control spec (unused beyond defaults).
   * @param {string} id - DOM id for the gallery button (ctl_<param>).
   * @returns {string}
   */
  control(c, id) {
    return `<button id="${id}" class="lora-gallery-button">View VFX Gallery</button>`
      + `<div class="os-vfx-edit" style="display:none"></div>`;
  },

  /** @returns {string} The selected VFX adapter file path (or ''). */
  read() { return selectedFile || ''; },

  /**
   * Wire the gallery button, drawer, selection flow, toggle forcing and the
   * per-adapter instruction inputs.
   * @param {HTMLButtonElement} button - The gallery button (ctl_<param>).
   * @returns {void}
   */
  mount(button) {
    // vfx_trigger only feeds the client-side prompt prepend in buildParams();
    // it must never ride in the request payload.
    store.markUiOnly('vfx_trigger');

    const wrap = button.closest('.advanced-setting') || button.parentElement;
    const editRow = wrap.querySelector('.os-vfx-edit');
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

    /** Recompute vfx_trigger from the selected adapter's inputs (or fixed trigger). */
    function syncTrigger() {
      const lora = vfxLoraOptions.find(l => l.fileName === selectedFile);
      if (!lora) return;
      let trigger = lora.trigger;
      if (lora.buildTrigger) {
        const values = {};
        for (const spec of lora.inputs) {
          const el = editRow.querySelector(`[data-vfx-input="${spec.name}"]`);
          values[spec.name] = el ? el.value.trim() : '';
        }
        trigger = lora.buildTrigger(values);
      }
      store.setParam('vfx_trigger', trigger);
      logDebug('VFX trigger updated', { file: selectedFile, trigger });
    }

    /**
     * Render the selected adapter's instruction inputs into the row and wire
     * them to syncTrigger. Hides the row for fixed-trigger adapters.
     * @param {object|null} lora - Selected catalog entry (or null on deselect).
     */
    function renderInputs(lora) {
      editRow.innerHTML = '';
      if (!lora || !lora.inputs) {
        editRow.style.display = 'none';
        return;
      }
      for (const spec of lora.inputs) {
        let el;
        if (spec.kind === 'select') {
          el = document.createElement('select');
          el.className = 'advanced-select';
          el.innerHTML = spec.options.map(o => `<option value="${o}">${o}</option>`).join('');
        } else {
          el = document.createElement('input');
          el.type = 'text';
          el.className = 'os-text-input os-vfx-edit-text';
          el.placeholder = spec.placeholder || '';
        }
        el.setAttribute('data-vfx-input', spec.name);
        el.addEventListener(spec.kind === 'select' ? 'change' : 'input', syncTrigger);
        editRow.appendChild(el);
      }
      editRow.style.display = '';
    }

    /**
     * Force the control-guidance toggles off, grey them out and make them
     * unclickable with a reason tooltip (established applyDisabledState
     * pattern, same as the preview button), or restore them.
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
          store.setParam(p, false);
          // Programmatic .checked changes do not fire 'change'; dependent
          // visibility logic (e.g. hiding pose/depth/canny under control_guide)
          // listens for it, so dispatch manually before disabling.
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.disabled = true;
          const wrap = input.closest('.advanced-setting');
          if (wrap) applyDisabledState(wrap, true, FORCED_REASON);
        }
        logDebug('Control toggles forced off', savedToggleStates);
      } else if (!forced && savedToggleStates) {
        for (const p of FORCED_TOGGLES) {
          const input = document.getElementById(`ctl_${p}`);
          if (!input) continue;
          const wrap = input.closest('.advanced-setting');
          if (wrap) applyDisabledState(wrap, false, '');
          input.disabled = false;
          input.checked = !!savedToggleStates[p];
          store.setParam(p, !!savedToggleStates[p]);
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        logDebug('Control toggles restored', savedToggleStates);
        savedToggleStates = null;
      }
    }

    /**
     * Select a VFX adapter: single selection, sets ic_lora + vfx_trigger,
     * forces the control toggles off, renders the adapter's instruction row.
     * Animates the clicked card flying into the selected slot.
     * @param {string} file - Adapter file path.
     * @param {HTMLElement} [el] - The clicked gallery card (for the animation).
     */
    function select(file, el) {
      const lora = vfxLoraOptions.find(l => l.fileName === file);
      if (!lora) return;
      selectedFile = file;
      button.classList.add('lora-selected');
      store.setParam('ic_lora', file);
      setControlToggles(true);
      renderInputs(lora);
      syncTrigger();
      const finalize = () => {
        selectedSlot.innerHTML = '';
        selectedSlot.appendChild(card(lora, true, deselect));
        drawer.classList.remove('open');
      };
      if (el) {
        animateToSlot(el, selectedSlot, finalize);
      } else {
        finalize();
      }
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
      renderInputs(null);
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
 * @param {Function} onSelect - (fileName, cardEl) selection callback.
 * @returns {void}
 */
function populate(content, onSelect) {
  content.innerHTML = '';
  for (const lora of vfxLoraOptions) {
    if (lora.fileName === selectedFile) continue;
    const el = card(lora, false, () => onSelect(lora.fileName, el));
    content.appendChild(el);
  }
}
