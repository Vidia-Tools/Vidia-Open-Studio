// =============================================================================
// Control type module: subject-checklist (Forge Reconstruct "Subject")
// Reproduces prod's subject type checklist (js/features/subject-select.js):
// Human or Biped / Object / Place / Preserve Color. Prod toggles four node
// conds; in the OS param model each checkbox writes a boolean param keyed to
// prod's node names (subject_person/object/place/original). Self-managed: the
// module seeds defaults and writes the store directly. At least one type must
// stay selected (prod invariant).
// =============================================================================

import { createLogger } from '../utils/logger.js';
import * as store from '../core/generation-store.js';

const logDebug = createLogger('SubjectChecklist');

// [param key, label, default checked] - defaults match prod's checked state.
const SUBJECTS = [
  ['subject_person', 'Human or Biped', true],
  ['subject_object', 'Object', false],
  ['subject_place', 'Place', true],
  ['subject_original', 'Preserve Color', false],
];

/** @typedef {import('./registry.js').ControlModule} ControlModule */

/** @type {ControlModule} */
export default {
  type: 'subject-checklist',
  selfManaged: true,

  /**
   * Build the prod subject checklist markup.
   * @param {object} c - Control spec (c.param is unused; per-subject keys are fixed).
   * @param {string} id - DOM id for the checklist root (ctl_<param>).
   * @returns {string}
   */
  control(c, id) {
    const rows = SUBJECTS.map(([key, label, checked]) =>
      `<label class="subject-checkbox-label">`
      + `<input type="checkbox" data-subject="${key}"${checked ? ' checked' : ''}>`
      + `<span class="checkbox-custom"></span><span>${label}</span></label>`
    ).join('');
    return `<div id="${id}" class="subject-checklist">${rows}</div>`;
  },

  /**
   * @param {HTMLElement} root - The checklist root.
   * @returns {Object<string, boolean>} Map of subject key -> selected.
   */
  read(root) {
    const out = {};
    root.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      out[cb.dataset.subject] = cb.checked;
    });
    return out;
  },

  /**
   * Seed the four subject params and keep them in sync; enforce >= 1 selected.
   * @param {HTMLElement} root - The checklist root (ctl_<param>).
   * @returns {void}
   */
  mount(root) {
    const boxes = root.querySelectorAll('input[type="checkbox"]');
    boxes.forEach((cb) => {
      store.setParam(cb.dataset.subject, cb.checked);
      cb.addEventListener('change', () => {
        const anyChecked = Array.from(boxes).some((b) => b.checked);
        if (!anyChecked) {
          cb.checked = true; // prod invariant: at least one subject type selected
          return;
        }
        store.setParam(cb.dataset.subject, cb.checked);
        logDebug('Subject toggled', { subject: cb.dataset.subject, selected: cb.checked });
      });
    });
  },

  event: 'change',
};
