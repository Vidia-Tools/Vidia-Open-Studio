// =============================================================================
// Control type module: text (single-line text input)
// Prod had no generic advanced-setting text input, so this introduces an
// .os-text-input class (styled in text.css to match .advanced-select) without
// editing the parity-locked style.css. Also the registry's default fallback.
// =============================================================================

import './text.css';

/** @typedef {import('./registry.js').ControlModule} ControlModule */

/** @type {ControlModule} */
export default {
  type: 'text',

  /**
   * @param {object} c - Control spec; c.default is the initial value.
   * @param {string} id - DOM id (ctl_<param>).
   * @returns {string}
   */
  control(c, id) {
    return `<input type="text" class="os-text-input" id="${id}" value="${c.default ?? ''}">`;
  },

  /**
   * @param {HTMLInputElement} input
   * @returns {string}
   */
  read(input) {
    return input.value;
  },

  event: 'change',
};
