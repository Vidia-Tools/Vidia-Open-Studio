// =============================================================================
// Control type module: lora-gallery (Effects picker)
// Reproduces prod's Effects/LoRA control: a "View Gallery" button + strength
// slider + the slide-in gallery drawer (.lora-gallery-drawer) with selectable
// cards and a selected slot. Catalog + mode logic ported from prod
// js/features/effects-modules/lora-data.js, lora-ui.js, lora-workflow.js.
// Mode-aware via the generation store method (set by the Forge submode toggle):
//   forge    -> Reconstruct (WAN effects loras)   -> param effects_lora
//   hunyuan  -> Inspire     (Hunyuan loras)        -> param lora_strength only*
//   evolve   -> SDXL loras                          -> param style_lora
//   trace    -> SDXL loras                          -> param style_lora
// *Inspire: the hunyuan workflow exposes only a {lora_strength} tag (no
//  lora_name tag), so the chosen file name cannot be injected; documented as a
//  residual. Strength + keywords still reach the worker. The selected file name
//  is written to the mode's lora_name param where a tag exists.
// All classes match style.css (parity-locked); this module adds none of its own
// chrome beyond the empty co-located css (lego contract).
// =============================================================================

import './lora-gallery.css';
import { createLogger } from '../utils/logger.js';
import * as store from '../core/generation-store.js';

const logDebug = createLogger('LoraGallery');

const DEFAULT_STRENGTH = 0.65;

// --- Catalog (ported verbatim from prod lora-data.js) -----------------------
const loraOptions = [
  { fileName: 'SDXL_EldritchComicsXL1.2.safetensors', displayName: 'Eldritch Comics', image: 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/3f6aa056-23d3-4c3c-97f2-3b010b7f4611/width=450/SDXL-Lora-NoRefiner_03862_.jpeg', keywords: 'comic book' },
  { fileName: 'SDXL_Vintage_VHS.safetensors', displayName: 'Vintage VHS', image: 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/a198444b-573d-40f1-a8b1-570112754304/original=true,quality=90/06421.jpeg', keywords: '' },
  { fileName: 'SDXL_pixel-art-xl-v1.1.safetensors', displayName: 'Pixel Art XL', image: 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/0770e5fc-4260-4e3c-a0ee-bf2253028e9f/width=450/x8_upscaled__00144_.jpeg', keywords: '' },
  { fileName: 'SDXL_AnimeArt.safetensors', displayName: 'Anime Art', image: 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/00bfef19-7400-4f4a-a043-26ec790c4591/width=450/00004-313237122.jpeg', keywords: 'animeart' },
  { fileName: 'SDXL_3DMM_XL_V13.safetensors', displayName: '3D Model Maker XL', image: 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/76b40ceb-72ff-4863-91f7-0c070993c63b/original=true,quality=90/3dmm_00011_.jpeg', keywords: '3DMM' },
  { fileName: 'SDXL_Clay-Animation.safetensors', displayName: 'Clay Animation', image: 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/f776f326-1d99-4eca-9fa4-af4af3a7f4af/width=450/00426-3216997761-_lora_Clay%20Animation_1_Clay%20Animation%20-%20a%20CLAYMATION%20a%20happy%2024%20year%20old%20man%20with%20a%20beard%20in%20the%20style%20of%20Erwin%20Olaf%20in%20CLAYMATI.jpeg', keywords: 'Clay Animation page' },
  { fileName: 'SDXL_facial-expression-style-v3.safetensors', displayName: 'Facial Expression Style', image: 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/7a6bf100-2ed8-445e-9f78-2cdc66de58bf/width=450/00578-944440993.jpeg', keywords: 'facial expression style' },
  { fileName: 'SDXL_Technicolor_style.safetensors', displayName: 'Technicolor', image: 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/f5467d42-d16c-477e-bf37-ba48d8f93187/width=450/00093-998533311.jpeg', keywords: 'Technicolor style, 1950s Technicolor style, Film' },
  { fileName: 'SDXL_101_novuschroma_1.safetensors', displayName: 'Novus Chroma', image: 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/3bd7d928-472f-49ed-bb15-13f9cb2ee19e/width=450/06_Euler%20a_lora%20101%20novuschroma%201%201%20dragon%20novuschroma%20style.jpeg', keywords: '' },
  { fileName: 'SDXL_Minimalist_vector_art.safetensors', displayName: 'Minimalist Vector Art', image: 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/592bad92-3e9c-4b75-a653-b63b7e8f233e/width=450/Minimalist_vector_art_e000010_00_20240818121750.jpeg', keywords: 'ArsMJStyle, Minimalist Vector Art' },
  { fileName: 'SDXL_Kodak-Portra-400-analog-film-stock-style-v2.safetensors', displayName: 'Kodak Portra 400', image: 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/f989fc61-ceb3-4483-b369-7376d1515a7e/width=450/00016-1030514297.jpeg', keywords: 'Kodak Portra 400, analog film stocks' },
  { fileName: 'SDXL_detailed.safetensors', displayName: 'Detailed Style', image: 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/745a834c-5afe-4183-b90f-9566f8409c5c/width=450/00563-4125486649.jpeg', keywords: 'detailed, detailed style, perfect' },
  { fileName: 'SDXL_ArsMJStylePony_-_Stained_GlassSDXL.safetensors', displayName: 'Stained Glass', image: 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/6c66ed8a-02d5-4164-b975-6f3575e71e1d/width=450/DMWZY3PDK75B5XDPTCXHNK6FC0.jpeg', keywords: 'ArsMJStyle, Stained Glass' },
  { fileName: 'SDXL_xl-shanbailing-1003fire-000010.safetensors', displayName: 'Shanbailing Fire', image: 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/52714ba5-23ad-4ad8-9d9e-12baccc3b449/width=450/08350-2407568206-(Masterpiece,%20high%20quality,%20best%20quality,%20official%20art,%20beauty%20and%20aesthetics_1.2),(fire%20element_1.1),composed%20of%20fire%20elements,.jpeg', keywords: 'fire element, composed of fire elements' },
  { fileName: 'SDXL_Hollywood-Anamorphic-format-film-style-v2.safetensors', displayName: 'Hollywood Anamorphic', image: 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/d42e4e38-d837-42b4-8be1-8d5756d043f2/width=450/00137-4193514465.jpeg', keywords: 'Hollywood Anamorphic format film style' },
];

const forgeInspireLoraOptions = [
  { fileName: 'hunyuan_GlitchyDVCam.safetensors', displayName: 'Glitchy Camcorder Style', image: 'https://imagedelivery.net/LpDR7JO2m28imzB37PYhCw/f760d0b4-0222-4db1-6da1-4461372b9e00/public', keywords: 'yellowjackets intro filmstyle' },
  { fileName: 'hunyuan_DreamyVibesStyle.safetensors', displayName: 'Dreamyvibes Style', image: 'https://imagedelivery.net/LpDR7JO2m28imzB37PYhCw/bba79554-2fce-4871-33d7-b05b5d26bd00/public', keywords: 'dreamyvibes style' },
  { fileName: 'hunyuan_Cyber.safetensors', displayName: 'Cyber', image: 'https://imagedelivery.net/LpDR7JO2m28imzB37PYhCw/0995af52-d054-4d54-7992-d0965b9da700/public', keywords: '' },
];

const forgeReconstructLoraOptions = [
  { fileName: 'WAN_animalPeople.safetensors', displayName: 'Animal People', image: 'https://imagedelivery.net/LpDR7JO2m28imzB37PYhCw/164622c0-6774-4fb3-2947-dd40d9ac1b00/public', keywords: 'anthro, furry' },
  { fileName: 'WAN_blossoms.safetensors', displayName: 'Everything Blossoms', image: 'https://imagedelivery.net/LpDR7JO2m28imzB37PYhCw/26d4cd99-8bea-4081-b6bb-a069f9cca000/public', keywords: 'ww2hk effect' },
  { fileName: 'WAN_breathingFire.safetensors', displayName: 'Breathing Fire', image: 'https://imagedelivery.net/LpDR7JO2m28imzB37PYhCw/d80b0d0e-be03-4fa4-3434-283e9bfc5900/public', keywords: 'H-penhuo-v1' },
  { fileName: 'WAN_darkAngel.safetensors', displayName: 'Dark Angel', image: 'https://imagedelivery.net/LpDR7JO2m28imzB37PYhCw/9548623c-aa94-41d9-7d75-434dee479a00/public', keywords: 'H-hcbyb-v1' },
  { fileName: 'WAN_disguiseDrop.safetensors', displayName: 'Drop the Disguise', image: 'https://imagedelivery.net/LpDR7JO2m28imzB37PYhCw/6ad1376e-278b-4f66-3774-7e3a2e2c9b00/public', keywords: 'touches the top of head with hand and then fully unzips skin in two halves' },
  { fileName: 'WAN_Invisibility.safetensors', displayName: 'Invisibility', image: 'https://imagedelivery.net/LpDR7JO2m28imzB37PYhCw/80b98c62-37cd-4deb-77ee-7bd72a10d600/public', keywords: 'H-yinshen-v1' },
];

/**
 * Resolve the active catalog + worker lora_name param for the current method.
 * @returns {{options: Array, nameParam: (string|null)}}
 */
function currentConfig() {
  const method = store.getMethod();
  if (method === 'hunyuan') return { options: forgeInspireLoraOptions, nameParam: null };
  if (method === 'forge') return { options: forgeReconstructLoraOptions, nameParam: 'effects_lora' };
  return { options: loraOptions, nameParam: 'style_lora' };
}

let selectedFile = null;

/** @typedef {import('./registry.js').ControlModule} ControlModule */

/** @type {ControlModule} */
export default {
  type: 'lora-gallery',
  selfManaged: true,

  /**
   * Build prod's #loraContainer inner markup: gallery button + strength slider.
   * @param {object} c - Control spec (unused beyond defaults).
   * @param {string} id - DOM id for the gallery button (ctl_<param>).
   * @returns {string}
   */
  control(c, id) {
    return `<button id="${id}" class="lora-gallery-button">View Gallery</button>`
      + `<input type="range" class="os-lora-strength" min="0" max="1" step="0.01" value="0" disabled>`
      + `<span class="advanced-setting-value os-lora-strength-value">0.00</span>`;
  },

  /** @returns {string} The selected lora file name (or ''). */
  read() { return selectedFile || ''; },

  /**
   * Wire the gallery button, strength slider, drawer, and selection flow.
   * @param {HTMLButtonElement} button - The gallery button (ctl_<param>).
   * @returns {void}
   */
  mount(button) {
    const wrap = button.closest('.advanced-setting') || button.parentElement;
    const slider = wrap.querySelector('.os-lora-strength');
    const sliderVal = wrap.querySelector('.os-lora-strength-value');
    const drawer = ensureDrawer();
    const selectedSlot = drawer.querySelector('.lora-selected-slot');
    const galleryContent = drawer.querySelector('.lora-gallery-content');

    button.addEventListener('click', (e) => {
      e.stopPropagation();
      const opening = !drawer.classList.contains('open');
      drawer.classList.toggle('open');
      if (opening) populate(galleryContent, (file, name) => select(file, name));
    });

    document.addEventListener('click', (event) => {
      if (drawer.classList.contains('open') && !drawer.contains(event.target) && !button.contains(event.target)) {
        drawer.classList.remove('open');
      }
    });

    slider.addEventListener('input', () => {
      if (!selectedFile) return;
      const v = parseFloat(slider.value);
      sliderVal.textContent = v.toFixed(2);
      store.setParam('lora_strength', v);
    });

    /**
     * Select a lora: update slot UI, slider, button, and worker params.
     * @param {string} file - Lora file name.
     * @param {string} name - Display name.
     */
    function select(file, name) {
      const cfg = currentConfig();
      const lora = cfg.options.find(l => l.fileName === file);
      if (!lora) return;
      selectedFile = file;
      // Forge Reconstruct pins strength to 1.0 (prod handleLoraStateChange).
      const strength = store.getMethod() === 'forge' ? 1.0 : DEFAULT_STRENGTH;
      slider.disabled = false;
      slider.value = strength;
      sliderVal.textContent = strength.toFixed(2);
      button.classList.add('lora-selected');

      store.setParam('lora_strength', strength);
      store.setParam('lora_keywords', lora.keywords || '');
      if (cfg.nameParam) store.setParam(cfg.nameParam, file);

      selectedSlot.innerHTML = '';
      selectedSlot.appendChild(card(lora, true, () => deselect()));
      drawer.classList.remove('open');
      logDebug('LoRA selected', { file, strength, nameParam: cfg.nameParam });
    }

    /** Clear selection back to defaults (prod deselect). */
    function deselect() {
      selectedFile = null;
      slider.disabled = true;
      slider.value = 0;
      sliderVal.textContent = '0.00';
      button.classList.remove('lora-selected');
      selectedSlot.innerHTML = '';
      store.setParam('lora_strength', 0);
      store.setParam('lora_keywords', '');
      const cfg = currentConfig();
      if (cfg.nameParam) store.setParam(cfg.nameParam, '');
      logDebug('LoRA deselected');
    }
  },

  event: 'change',
};

/**
 * Create (once) the slide-in gallery drawer in document.body, mirroring prod's
 * #loraGalleryDrawer markup so style.css positions/styles it.
 * @returns {HTMLElement}
 */
function ensureDrawer() {
  let drawer = document.getElementById('loraGalleryDrawer');
  if (drawer) return drawer;
  drawer = document.createElement('div');
  drawer.id = 'loraGalleryDrawer';
  drawer.className = 'lora-gallery-drawer';
  drawer.innerHTML = `
    <div class="effects-disclaimer">
      The visual styles shown here are temporary curated examples to demonstrate Vidia's capabilities.
      Original artwork and models are from talented creators on CivitAI.
      Full attribution available on our <a href="/credits-page.html" class="disclaimer-link">credits page</a>.
    </div>
    <div class="lora-selected-slot"></div>
    <div class="lora-gallery-content"></div>`;
  document.body.appendChild(drawer);
  return drawer;
}

/**
 * Populate the gallery grid with the current mode's catalog.
 * @param {HTMLElement} content - The .lora-gallery-content container.
 * @param {Function} onSelect - (fileName, displayName) selection callback.
 * @returns {void}
 */
function populate(content, onSelect) {
  content.innerHTML = '';
  for (const lora of currentConfig().options) {
    if (lora.fileName === selectedFile) continue;
    content.appendChild(card(lora, false, () => onSelect(lora.fileName, lora.displayName)));
  }
}

/**
 * Build a lora card matching prod's .lora-option markup, with the 3D hover
 * effect (style.css reads --rotateX/--rotateY) and optional deselect button.
 * @param {object} lora - Catalog entry.
 * @param {boolean} selected - Whether this is the selected-slot card.
 * @param {Function} onClick - Click (select) or deselect handler.
 * @returns {HTMLElement}
 */
function card(lora, selected, onClick) {
  const el = document.createElement('div');
  el.className = selected ? 'lora-option selected' : 'lora-option';
  el.setAttribute('data-filename', lora.fileName);
  el.innerHTML = `
    <div class="card-content">
      <div class="lora-cassette"><div class="image-container">
        <img src="${lora.image}" alt="${lora.displayName}" class="lora-preview">
      </div></div>
      <p title="${lora.displayName}">${lora.displayName}</p>
    </div>`;
  const content = el.querySelector('.card-content');
  el.addEventListener('mousemove', (e) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--rotateY', `${((e.clientX - r.left) / r.width - 0.5) * 20}deg`);
    el.style.setProperty('--rotateX', `${(0.5 - (e.clientY - r.top) / r.height) * 20}deg`);
  });
  el.addEventListener('mouseleave', () => { content.style.transform = ''; el.style.removeProperty('--rotateX'); el.style.removeProperty('--rotateY'); });

  if (selected) {
    const btn = document.createElement('div');
    btn.className = 'deselect-button';
    btn.textContent = '\u00D7';
    btn.style.display = 'block';
    el.appendChild(btn);
    btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  } else {
    el.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  }
  return el;
}
