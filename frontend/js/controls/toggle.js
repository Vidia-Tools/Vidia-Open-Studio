// =============================================================================
// Control type module: toggle (iOS-style switch)
// Emits prod's contracted .switch/.slider markup so the parity-locked style.css
// styles it. Visual rules live in style.css (.switch, .slider); see toggle.css.
// =============================================================================

import './toggle.css';

/** @typedef {import('./registry.js').ControlModule} ControlModule */

/** @type {ControlModule} */
export default {
  type: 'toggle',

  /**
   * Build the inner markup placed inside .advanced-setting-control.
   * @param {object} c - Control spec from the stage manifest.
   * @param {string} id - DOM id for the input (ctl_<param>).
   * @returns {string} HTML for the switch.
   */
  control(c, id) {
    return `<label class="switch"><input type="checkbox" id="${id}"${c.default ? ' checked' : ''}><span class="slider round"></span></label>`;
  },

  /**
   * Read the control's current value.
   * @param {HTMLInputElement} input - The checkbox input.
   * @returns {boolean}
   */
  read(input) {
    return input.checked;
  },

  event: 'change',
};
