// =============================================================================
// Control type registry
// One place the renderer consults to turn a manifest control spec into markup,
// read its value, and run any post-mount wiring. Each control TYPE is a module
// that bundles its markup builder + value reader + (co-located) CSS. Adding a
// new type = add a module file that imports its own CSS + add one line here.
// =============================================================================

import toggle from './toggle.js';
import slider from './slider.js';
import select from './select.js';
import text from './text.js';
import imageUpload from './image-upload.js';
import loraGallery from './lora-gallery.js';
import canvasPoints from './canvas-points.js';
import subjectChecklist from './subject-checklist.js';
import seed from './seed.js';

/**
 * @typedef {Object} ControlModule
 * @property {string} type - Manifest control type this module handles.
 * @property {(c: object, id: string) => string} control - Inner markup for
 *   the .advanced-setting-control container.
 * @property {(input: HTMLElement) => *} read - Current value from the input.
 * @property {(input: HTMLElement) => void} [mount] - Optional post-inject wiring.
 * @property {'input'|'change'} event - DOM event that signals a value change.
 */

const modules = [toggle, slider, select, text, imageUpload, loraGallery, canvasPoints, subjectChecklist, seed];

/** @type {Record<string, ControlModule>} */
const registry = Object.fromEntries(modules.map(m => [m.type, m]));

/**
 * Resolve the module for a control type. Unknown types fall back to text so a
 * typo in a manifest degrades to an editable field rather than throwing.
 * @param {string} type - Manifest control type.
 * @returns {ControlModule}
 */
export function getControlModule(type) {
  return registry[type] || text;
}
