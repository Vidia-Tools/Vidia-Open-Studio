# Control-type module system

The generation controls panel is rendered from manifests, not hand-written
HTML. Each control in a `controls/<stage>.json` manifest declares a `type`
(`toggle`, `slider`, `select`, `text`, `image-upload`, `lora-gallery`,
`canvas-points`). The renderer
([`js/core/controls-renderer.js`](../core/controls-renderer.js)) asks the
**registry** ([`registry.js`](./registry.js)) for the module that owns that
type, and the module supplies the markup, the value reader, and (co-located) the
CSS. Add a control to a manifest and its styling/behavior come for free. Add a
brand-new control type by dropping in one module + one registry line.

## Anatomy of a control-type module

```js
// my-type.js
import './my-type.css';            // co-located CSS, auto-bundled by Vite

export default {
  type: 'my-type',                 // matches the manifest "type" value
  control(c, id) {                 // inner HTML of .advanced-setting-control
    return `<input id="${id}" ...>`;
  },
  read(input) { return input.value; },  // value -> generation store
  mount(input) { /* optional post-inject wiring */ },
  event: 'input',                  // 'input' or 'change'
};
```

The renderer wraps every control in the prod chrome:

```html
<div class="advanced-setting">
  <span class="advanced-setting-label">{label}</span>
  <div class="advanced-setting-control">{module.control(c, id)}</div>
</div>
```

so a module only emits the inner control. The input's id is always
`ctl_<param>`; use the passed `id`.

## CSS / parity rule

`frontend/style.css` is byte-identical to prod and is **never edited**. It
already styles the prod control classes (`.advanced-setting`, `.switch`,
`.slider`, `.advanced-select`, `.advanced-setting-value`, `.setting-hint`,
`.experimental-badge`). So a module reproduces prod by **emitting those exact
classes**. A module's own `.css` file is only for chrome prod's style.css does
not already cover (for example [`text.css`](./text.css) adds `.os-text-input`,
[`mode-picker.css`](./mode-picker.css) adds the tab bar). When in doubt, reuse a
prod class and add nothing.

Note: `.slider` is prod's iOS toggle track. Do NOT put `class="slider"` on a
range input; range inputs are styled by the
`.advanced-setting-control input[type="range"]` attribute selector in style.css.

## How to add a control (to an existing type)

1. Add an entry to the relevant `frontend/public/controls/<stage>.json`:
   ```json
   { "type": "slider", "param": "my_param", "range": [0, 1, 0.05],
     "default": 0.5, "label": "My param", "_modes": ["forge"] }
   ```
2. Optional keys: `modes` (array; control only shows for those modes),
   `feature` (string; control only shows when that feature toggle is on).
3. Nothing else. The value lands in the generation store under `param`.

## How to add a NEW control type

1. Create `js/controls/<type>.js` exporting the module shape above.
2. Create `js/controls/<type>.css` and `import './<type>.css'` at the top of the
   module (even if empty, this keeps the lego contract: type = js + css).
3. Register it in [`registry.js`](./registry.js): import it and add it to the
   `modules` array.
4. Use `"type": "<type>"` in a manifest. Done.

## Known limitation: section grouping

Manifests now carry an optional `group` field. A control with `"group":
"advanced"` is rendered inside the collapsible **Advanced Controls** dropdown
(prod's `.advanced-dropdown`, toggled via `.expanded`), created once after the
main controls. All other controls render in the main panel in manifest order.

## Optional manifest fields

- `modes` (array): control only shows for those generate methods.
- `feature` (string): control only shows when that feature toggle is on.
- `group` ("advanced"): route into the Advanced Controls dropdown.
- `hint` (string): renders prod's `?` hint icon + `.setting-hint` line.
- `badge` ("Experimental" | "Legacy" | "Advanced"): renders the prod badge.
- `definingFeature` (true): adds prod's `.defining-feature` glow to the control,
  marking it as the highlighted feature that defines a mode. Pair with `modes`
  so the glowing control only shows for that mode (e.g. Evolve's "Change amount").
  Forge's Reconstruct/Inspire submode toggle is rendered as Forge's defining
  feature automatically by the renderer.

## Helpers (hints + helper text)

Two independent helper channels exist; each is a single-place edit.

1. **Per-control hint** (the `?` icon next to a control). Set the `hint` field
   on the control in its `controls/<stage>.json`. The renderer emits the prod
   `.hint-icon` + `.setting-hint` markup; a single delegated click handler in
   [`js/core/app.js`](../core/app.js) (`toggleHint` from
   [`js/ui/helpers.js`](../ui/helpers.js)) shows/hides the hint. No JS edit
   needed: add/change the `hint` string in the JSON and you are done.

   ```json
   { "type": "slider", "param": "denoise", "range": [0, 1, 0.05],
     "default": 0.7, "label": "Denoise", "hint": "How much the source is changed." }
   ```

2. **Prompt-area helper text** (the `#helperText` line under the prompt). Static
   prompt-area elements in [`dashboard.html`](../../dashboard.html) carry
   `data-helper="KEY"`; the message for each `KEY` lives in
   [`js/config/helper-messages.js`](../config/helper-messages.js) under
   `MESSAGES.HELPER`. `setupHelperText` (wired in `app.js`) shows the message on
   hover/focus. To add or edit one: add the `data-helper` key to the element and
   the matching message in that one config file.

## Per-mode defining features (the glow)

A "defining feature" is the highlighted control that characterizes a mode. To add
one, declare a control with both `modes` and `definingFeature` in the stage JSON:

```json
{ "type": "slider", "param": "denoise", "range": [0, 1, 0.01], "default": 0.65,
  "label": "Change amount", "modes": ["evolve"], "definingFeature": true,
  "hint": "How much the video changes from the original." }
```

The `param` must be a key the worker consumes (see the worker's
`PARAM_INPUT_CANDIDATES`); declaring a control whose `param` has no worker tag
renders the UI but has no backend effect.

## Incompatibility warnings

Conflicting features surface an inline warning under a control, prod-style. Add a
conflict in one place: the `FEATURE_CONFLICTS` array in
[`js/ui/feature-warnings.js`](../ui/feature-warnings.js). Each entry reads the
generation store features and anchors its warning under a manifest control via
`document.getElementById('ctl_<param>')`. Warnings re-evaluate on every control
change (delegated on `#osControls`).

## Composite ("self-managed") control types

`image-upload`, `lora-gallery`, and `canvas-points` set `selfManaged: true`.
The renderer mounts them but does NOT seed a default or attach the generic
read -> store listener; instead each module writes the generation store directly
(file slots, params, features). The control root carries `id="ctl_<param>"` so
the renderer can find and mount it.

- **image-upload** (`js/controls/image-upload.js`): prod's small upload area
  (Style Transfer, Face Swap, Body Replacement). Manifest keys: `slot` (file
  slot, e.g. `in_style_ref`), `fileType` (`style`|`face`|`body`),
  optional `strengthParam` (+`range`/`default`) and `enablesFeature`. Previews
  the image and uploads via `s3Uploader.uploadToS3`, writing the URL to
  `store.setFile(slot, url)`.
- **lora-gallery** (`js/controls/lora-gallery.js`): prod's Effects picker. Mode
  aware via `store.getMethod()`: `forge`->`effects_lora`, `evolve`/`trace`->
  `style_lora`, `hunyuan`->`lora_strength` only. Writes `lora_strength` +
  `lora_keywords` and the mode's lora_name param. Creates the gallery drawer in
  `document.body`.
- **canvas-points** (`js/controls/canvas-points.js`): prod's Full Body
  Replacement points editor. Left-click = positive, right-click = negative,
  reset clears; serializes to `points_positive` as
  `{"positive":[{x,y}],"negative":[{x,y}]}`.
- **subject-checklist** (`js/controls/subject-checklist.js`): prod's Forge
  Reconstruct "Subject" selector (Human or Biped / Object / Place / Preserve
  Color). Writes one boolean param per type (`subject_person`, `subject_object`,
  `subject_place`, `subject_original`), enforces at least one selected. Gate it
  with `"modes": ["forge"]` + `"definingFeature": true`.
