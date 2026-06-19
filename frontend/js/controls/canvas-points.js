// =============================================================================
// Control type module: canvas-points (Full Body Replacement subject points)
// Reproduces prod's #pointsCanvas editor: the user places positive (green) and
// negative (red) subject points and can reset them; the set serializes to the
// JSON shape the worker's Points Editor expects and is written to the
// points_positive param (worker tag {points_positive} -> points_store widget).
// Ported from prod js/features/full-body-replacement.js (point types, reset,
// JSON shape {"positive":[{x,y}],"negative":[{x,y}]}).
// Residual: prod converts canvas coords to ORIGINAL video coordinates using the
// source video dimensions; OS has no video-frame context here, so points are
// emitted in canvas space. Documented in the changelog.
// =============================================================================

import './canvas-points.css';
import { createLogger } from '../utils/logger.js';
import * as store from '../core/generation-store.js';

const logDebug = createLogger('CanvasPoints');

const MAX_POSITIVE = 10;
const MAX_NEGATIVE = 10;
const EMPTY = '{"positive":[],"negative":[]}';

/** @typedef {import('./registry.js').ControlModule} ControlModule */

/** @type {ControlModule} */
export default {
  type: 'canvas-points',
  selfManaged: true,

  /**
   * Build the canvas + reset button (prod .canvas-container markup).
   * @param {object} c - Control spec (param drives the store key).
   * @param {string} id - DOM id for the container root (ctl_<param>).
   * @returns {string}
   */
  control(c, id) {
    return `<div id="${id}" class="canvas-container" data-param="${c.param}">`
      + `<p class="os-points-hint">Left-click to add a subject (green) point; right-click to add a background (red) point.</p>`
      + `<canvas class="os-points-canvas" width="400" height="300"></canvas>`
      + `<button type="button" class="advanced-button os-reset-points">Reset Points</button>`
      + `</div>`;
  },

  /** @param {HTMLElement} root @returns {string} serialized points JSON */
  read(root) { return root.dataset.points || EMPTY; },

  /**
   * Wire point placement (left=positive, right=negative) and reset.
   * @param {HTMLElement} root - The .canvas-container (ctl_<param>).
   * @returns {void}
   */
  mount(root) {
    const param = root.dataset.param;
    const canvas = root.querySelector('.os-points-canvas');
    const resetBtn = root.querySelector('.os-reset-points');
    const ctx = canvas.getContext('2d');
    const points = []; // {x, y, type}

    root.dataset.points = EMPTY;
    store.setParam(param, EMPTY);
    redraw();

    canvas.addEventListener('click', (e) => add(e, 'positive'));
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); add(e, 'negative'); });
    resetBtn.addEventListener('click', () => {
      points.length = 0;
      commit();
      redraw();
      logDebug('Points reset');
    });

    /**
     * Add a point of a given type, honoring prod's per-type caps.
     * @param {MouseEvent} e - The mouse event.
     * @param {'positive'|'negative'} type - Point type.
     */
    function add(e, type) {
      const rect = canvas.getBoundingClientRect();
      const x = Math.round((e.clientX - rect.left) * (canvas.width / rect.width));
      const y = Math.round((e.clientY - rect.top) * (canvas.height / rect.height));
      const cap = type === 'positive' ? MAX_POSITIVE : MAX_NEGATIVE;
      if (points.filter(p => p.type === type).length >= cap) return;
      points.push({ x, y, type });
      commit();
      redraw();
    }

    /** Serialize points to the worker JSON shape and write the store. */
    function commit() {
      const json = JSON.stringify({
        positive: points.filter(p => p.type === 'positive').map(p => ({ x: p.x, y: p.y })),
        negative: points.filter(p => p.type === 'negative').map(p => ({ x: p.x, y: p.y })),
      });
      root.dataset.points = json;
      store.setParam(param, json);
    }

    /** Repaint the canvas background + all points. */
    function redraw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(0,0,0,0.04)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (const p of points) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.fillStyle = p.type === 'positive' ? '#4CAF50' : '#F44336';
        ctx.fill();
      }
    }
  },

  event: 'change',
};
