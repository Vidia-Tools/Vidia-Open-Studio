// =============================================================================
// Control type module: seed (number input + Generate + Copy buttons)
// Parity item P7: mirrors prod's dashboard.html seed section + seed-control.js.
// The seed_mode select (ctl_seed_mode) drives Random/Static visual state:
// Random -> input readonly, opacity 0.7, cursor default; Static -> editable.
// read() returns -1 for empty/NaN (VOS random semantics; worker resolves once).
// =============================================================================

import './seed.css';

/** @typedef {import('./registry.js').ControlModule} ControlModule */

/**
 * Apply the Random/Static visual state to the seed input.
 * @param {HTMLInputElement} seedInput
 * @param {string} mode - 'Random' | 'Static'
 */
function applyMode(seedInput, mode) {
  const isRandom = mode !== 'Static';
  seedInput.readOnly = isRandom;
  seedInput.style.opacity = isRandom ? '0.7' : '1';
  seedInput.style.cursor = isRandom ? 'default' : 'text';
}

/** @type {ControlModule} */
export default {
  type: 'seed',

  /**
   * @param {object} c - Control spec; c.default is the initial value (-1).
   * @param {string} id - DOM id (ctl_seed).
   * @returns {string}
   */
  control(c, id) {
    return `<div class="os-seed-row">`
      + `<input type="number" class="os-seed-input" id="${id}" value="${c.default ?? -1}">`
      + `<button type="button" class="advanced-button os-seed-btn" id="${id}_generate">Generate</button>`
      + `<button type="button" class="advanced-button os-seed-btn" id="${id}_copy">Copy</button>`
      + `</div>`;
  },

  /**
   * @param {HTMLInputElement} input
   * @returns {number}
   */
  read(input) {
    const raw = input.value;
    if (raw === '' || raw === null || raw === undefined) return -1;
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? -1 : n;
  },

  event: 'change',

  /**
   * Wire Generate (new random seed 0..1e9, dispatch change) and Copy
   * (clipboard with "Copied!" feedback for 1500ms). Sync Random/Static visual
   * state with the seed_mode select (ctl_seed_mode).
   * @param {HTMLInputElement} input
   */
  mount(input) {
    const row = input.closest('.os-seed-row');
    const generateBtn = row && row.querySelector(`#${input.id}_generate`);
    const copyBtn = row && row.querySelector(`#${input.id}_copy`);
    const modeSelect = document.getElementById('ctl_seed_mode');

    const syncMode = () => applyMode(input, modeSelect ? modeSelect.value : 'Random');

    if (generateBtn) {
      generateBtn.addEventListener('click', () => {
        input.value = Math.floor(Math.random() * 1e9);
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }

    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const text = String(input.value);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).catch(() => fallbackCopy(input));
        } else {
          fallbackCopy(input);
        }
        const original = copyBtn.textContent;
        copyBtn.classList.add('success');
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyBtn.textContent = original;
          copyBtn.classList.remove('success');
        }, 1500);
      });
    }

    if (modeSelect) {
      modeSelect.addEventListener('change', syncMode);
    }
    syncMode();
  },
};

/**
 * Legacy clipboard fallback (select + execCommand) for non-secure contexts.
 * @param {HTMLInputElement} input
 */
function fallbackCopy(input) {
  try {
    input.removeAttribute('readonly');
    input.select();
    document.execCommand('copy');
  } catch (_) { /* no-op */ }
}
