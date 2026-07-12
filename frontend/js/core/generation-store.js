// =============================================================================
// Open Studio generation store
// Central, node-free holder for the values the browser sends to the handler.
// The controls renderer writes scalar params + feature toggles here; the upload
// flow writes file slot URLs here. core/workflow.js buildParams() reads it.
// Replaces the retired graph mutation layer (no node IDs anywhere).
// =============================================================================

// Scalar {param} values keyed by param key (prompt, seed, steps, ...).
const params = {};
// Feature gate booleans keyed by manifest feature (detailer, upscaler, ...).
const features = {};
// File slot URLs keyed by [in_*] slot (in_video, in_style_ref, ...).
const files = {};
// Selected generate method/mode (forge | evolve | trace | inspire | envision).
let method = 'forge';
// Param names flagged uiOnly by the renderer: seeded into the store so showWhen
// children can key on them, but excluded from the request payload (buildParams).
const uiOnly = new Set();

export function setParam(key, value) { params[key] = value; }
export function getParam(key) { return params[key]; }
export function getParams() { return { ...params }; }

export function setFeature(key, enabled) { features[key] = !!enabled; }
export function getFeatures() { return { ...features }; }

export function setFile(slot, url) {
  if (url === null || url === undefined) { delete files[slot]; return; }
  files[slot] = url;
}
export function getFile(slot) { return files[slot]; }
export function getFiles() { return { ...files }; }

export function setMethod(m) { method = m; }
export function getMethod() { return method; }

/**
 * Mark a param as uiOnly: seeded into the store (so showWhen children can read
 * it) but excluded from the request payload by buildParams().
 * @param {string} param - The control's param key.
 * @returns {void}
 */
export function markUiOnly(param) { uiOnly.add(param); }

/**
 * Read the set of uiOnly param names so buildParams() can filter them out.
 * @returns {Set<string>}
 */
export function getUiOnlyParams() { return uiOnly; }
