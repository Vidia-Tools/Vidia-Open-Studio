// =============================================================================
// Control type module: slider (range input + live value readout)
// Emits a bare input[type=range] (styled by style.css via the
// .advanced-setting-control input[type="range"] rule) plus a prod
// .advanced-setting-value span. No .slider class on the range: that class is
// prod's iOS toggle track and would clobber the range visuals.
// =============================================================================

import './slider.css';

/** @typedef {import('./registry.js').ControlModule} ControlModule */

/** @type {ControlModule} */
export default {
  type: 'slider',

  /**
   * Build the range input plus its value readout.
   * @param {object} c - Control spec; c.range is [min, max, step].
   * @param {string} id - DOM id for the input (ctl_<param>).
   * @returns {string}
   */
  control(c, id) {
    const [min, max, step] = c.range || [0, 1, 0.01];
    return `<input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${c.default}"><span class="advanced-setting-value" data-value-for="${id}">${c.default}</span>`;
  },

  /**
   * @param {HTMLInputElement} input - The range input.
   * @returns {number}
   */
  read(input) {
    return Number(input.value);
  },

  /**
   * Keep the value readout in sync as the slider moves.
   * @param {HTMLInputElement} input - The range input.
   */
  mount(input) {
    const out = input.parentElement.querySelector(`[data-value-for="${input.id}"]`);
    if (out) input.addEventListener('input', () => { out.textContent = input.value; });
  },

  event: 'input',
};
