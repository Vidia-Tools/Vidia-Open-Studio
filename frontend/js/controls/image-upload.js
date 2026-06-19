// =============================================================================
// Control type module: image-upload (preview + S3 upload -> file slot)
// Reproduces prod's Style Transfer / Face Swap / Body Replacement upload areas
// (.upload-area.small-upload + .image-preview, styled by the parity-locked
// style.css). On select it previews the image and uploads it via the existing
// S3 presign flow (s3Uploader.uploadToS3), writing the public URL into the
// generation store's file slot (c.slot). Optionally renders a strength slider
// (c.strengthParam) and/or flips a feature gate on upload (c.enablesFeature).
// Self-managed: it writes the store directly, so the renderer skips the generic
// read/writeStore + default-seed path for this type.
// Prod refs: js/features/style-transfer.js, face.js, ui/s3Uploader.js.
// =============================================================================

import './image-upload.css';
import { uploadToS3 } from '../ui/s3Uploader.js';
import { mintGenerationId } from '../core/workflow.js';
import { createLogger } from '../utils/logger.js';
import * as store from '../core/generation-store.js';

const logDebug = createLogger('ImageUpload');

const UPLOAD_ICON = `<svg class="upload-icon" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><path d="M50 15L30 35h14v26h12V35h14L50 15zm-20 70h40v-10H30v10z"/></svg>`;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';

/** @typedef {import('./registry.js').ControlModule} ControlModule */

/** @type {ControlModule} */
export default {
  type: 'image-upload',
  selfManaged: true,

  /**
   * Build the upload area (+ optional strength slider) inner markup.
   * @param {object} c - Control spec; c.slot (file slot), c.fileType,
   *   optional c.strengthParam + c.range/c.default, c.enablesFeature.
   * @param {string} id - DOM id for the upload-area root (ctl_<param>).
   * @returns {string}
   */
  control(c, id) {
    const data = `data-slot="${c.slot}" data-filetype="${c.fileType}"`
      + (c.strengthParam ? ` data-strengthparam="${c.strengthParam}"` : '')
      + (c.enablesFeature ? ` data-enablesfeature="${c.enablesFeature}"` : '');
    let html = `<div id="${id}" class="upload-area small-upload" ${data}>`
      + UPLOAD_ICON
      + `<img class="image-preview" style="display: none;">`
      + `<input type="file" class="os-upload-input" style="display: none;" accept="${ACCEPT}">`
      + `</div>`;
    if (c.strengthParam) {
      const [min, max, step] = c.range || [0, 2, 0.01];
      const def = c.default ?? 1.2;
      html += `<input type="range" class="os-upload-strength" min="${min}" max="${max}" step="${step}" value="${def}" disabled>`
        + `<span class="advanced-setting-value os-upload-strength-value">${Number(def).toFixed(2)}</span>`;
    }
    return html;
  },

  /**
   * The canonical value is the uploaded URL (or '' when none).
   * @param {HTMLElement} root - The upload-area element.
   * @returns {string}
   */
  read(root) {
    return root.dataset.url || '';
  },

  /**
   * Wire click-to-pick, preview, S3 upload, strength, and deselect.
   * @param {HTMLElement} root - The upload-area element (ctl_<param>).
   * @returns {void}
   */
  mount(root) {
    const wrap = root.closest('.advanced-setting') || root.parentElement;
    const spec = readSpec(root, wrap);
    const fileInput = root.querySelector('.os-upload-input');
    const preview = root.querySelector('.image-preview');
    const uploadIcon = root.querySelector('.upload-icon');
    const strength = wrap.querySelector('.os-upload-strength');
    const strengthVal = wrap.querySelector('.os-upload-strength-value');

    root.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      // Local preview first (prod shows the image immediately).
      const reader = new FileReader();
      reader.onload = (e) => {
        preview.src = e.target.result;
        preview.style.display = 'block';
        if (uploadIcon) uploadIcon.style.display = 'none';
      };
      reader.readAsDataURL(file);

      try {
        const result = await uploadToS3(file, mintGenerationId(), spec.fileType);
        if (result && result.success) {
          root.dataset.url = result.url;
          store.setFile(spec.slot, result.url);
          if (spec.enablesFeature) store.setFeature(spec.enablesFeature, true);
          if (strength) {
            strength.disabled = false;
            // prod defaults the slider on first upload (style-transfer.js: 1.2).
            store.setParam(spec.strengthParam, Number(strength.value));
          }
          addDeselect(root, () => reset(root, preview, uploadIcon, strength, strengthVal, spec));
          logDebug('Uploaded', { slot: spec.slot, url: result.url });
        }
      } catch (err) {
        logDebug('Upload failed', { error: err.message });
      }
    });

    if (strength) {
      strength.addEventListener('input', () => {
        strengthVal.textContent = Number(strength.value).toFixed(2);
        store.setParam(spec.strengthParam, Number(strength.value));
      });
    }
  },

  event: 'change',
};

/**
 * Pull control config off data-* attributes the renderer leaves on the markup.
 * The renderer does not pass the spec to mount(), so control() stamps it.
 * @param {HTMLElement} root - Upload area.
 * @param {HTMLElement} wrap - The .advanced-setting wrapper.
 * @returns {{slot:string, fileType:string, strengthParam?:string, enablesFeature?:string}}
 */
function readSpec(root, wrap) {
  return {
    slot: root.dataset.slot,
    fileType: root.dataset.filetype,
    strengthParam: root.dataset.strengthparam || null,
    enablesFeature: root.dataset.enablesfeature || null,
  };
}

/**
 * Add prod's circular deselect button (× ) to the upload area.
 * @param {HTMLElement} container - Upload area.
 * @param {Function} onDeselect - Called when the button is clicked.
 * @returns {void}
 */
function addDeselect(container, onDeselect) {
  const existing = container.querySelector('.deselect-button');
  if (existing) existing.remove();
  const btn = document.createElement('div');
  btn.className = 'deselect-button';
  btn.textContent = '\u00D7';
  container.appendChild(btn);
  btn.addEventListener('click', (e) => { e.stopPropagation(); onDeselect(); btn.remove(); });
}

/**
 * Clear an upload back to its empty state (prod deselect behavior).
 * @returns {void}
 */
function reset(root, preview, uploadIcon, strength, strengthVal, spec) {
  root.dataset.url = '';
  preview.src = '';
  preview.style.display = 'none';
  if (uploadIcon) uploadIcon.style.display = 'block';
  store.setFile(spec.slot, null);
  if (spec.enablesFeature) store.setFeature(spec.enablesFeature, false);
  if (strength) {
    strength.disabled = true;
    if (strengthVal) strengthVal.textContent = Number(strength.value).toFixed(2);
  }
}
