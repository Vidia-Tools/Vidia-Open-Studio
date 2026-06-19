// =============================================================================
// Control type module: select (dropdown)
// Emits prod's .advanced-select markup; visuals live in style.css (parity).
// =============================================================================

import './select.css';

/** @typedef {import('./registry.js').ControlModule} ControlModule */

/** @type {ControlModule} */
export default {
  type: 'select',

  /**
   * @param {object} c - Control spec; c.options is the string list.
   * @param {string} id - DOM id (ctl_<param>).
   * @returns {string}
   */
  control(c, id) {
    const opts = (c.options || [])
      .map(o => `<option value="${o}"${o === c.default ? ' selected' : ''}>${o}</option>`)
      .join('');
    return `<select class="advanced-select" id="${id}">${opts}</select>`;
  },

  /**
   * @param {HTMLSelectElement} input
   * @returns {string}
   */
  read(input) {
    return input.value;
  },

  event: 'change',
};
