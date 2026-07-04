"""Stage workflow loader.

Loads a tagged sub-workflow JSON and turns it into a concrete ComfyUI graph by
scanning _meta.title tags ONLY (widget values may legitimately contain literal
"{prompt}" text, e.g. the prompt-enhance template, and must never be touched):

  [in_prev]        previous stage's output file path
  [in_<slot>]      input file from params.files (in_video, in_ref_image, ...)
  [out]            terminal save node; filename_prefix = {generationID}_{stageName}
  [out:<name>]     named text output (easy saveText), prompt_prep stage only
  {param_key}      tunable input injected from request params (may repeat)

Node IDs are never hardcoded.
"""

import copy
import json
import re

TAG_RE = re.compile(r"\[(in_[a-z_]+|out(?::[a-z_]+)?)\]|\{([a-z_]+)\}")

# Which widget input receives an [in_*] file path, by load-node class.
INPUT_FIELD_BY_CLASS = {
    "VHS_LoadVideoPath": "video",
    "LoadImage": "image",
    "LoadImageFromUrl": "image",
}

# Param key -> candidate input names, tried in order when the key itself is
# not an input name on the node (e.g. {seed} matches KSampler's "seed" directly).
PARAM_INPUT_CANDIDATES = {
    "prompt": ["string", "value", "text"],
    "negative_prompt": ["string", "value", "text"],
    "frame_divider": ["int", "value"],
    "steps": ["steps", "value", "int"],
    "forge_quality": ["value", "int"],
    "seed": ["seed", "noise_seed"],
    "denoise": ["denoise"],
    "detailer_type": ["model_name"],
    "detailer_denoise": ["denoise"],
    "cfg": ["cfg"],
    "speed_lora": ["lora_name", "lora"],
    "style_lora": ["lora_name", "lora"],
    "effects_lora": ["lora_name", "lora"],
    "pusa_lora_low": ["lora_name", "lora"],
    "pusa_lora_high": ["lora_name", "lora"],
    "lora_strength": ["strength", "strength_model"],
    "speed_lora_strength": ["strength_model", "strength"],
    "ipadapter_style_weight": ["weight_style", "weight"],
    "upscale_multiplier": ["value", "int"],
    "points_positive": ["points_store"],
    "prompt_enhance_enabled": ["cond"],
    "use_cloud_llm": ["cond"],
    "openrouter_api_key": ["openrouter_api_key"],
    "lora_keywords": ["value", "string"],
    "prompt_enhance_template": ["value", "string"],
    # Subject-select branch conditions (ImpactConditionalBranch cond inputs).
    "subject_person": ["cond"],
    "subject_object": ["cond"],
    "subject_place": ["cond"],
    "subject_original": ["cond"],
    # Creativity/Model Temperature toggle (ImpactConditionalBranch cond input).
    "model_temperature": ["cond"],
}

# 2026-06-12: intermediates are re-encoded once per stage; near-lossless h264
# keeps generational loss negligible (plan section 1).
INTERMEDIATE_FORMAT = "video/h264-mp4"
INTERMEDIATE_CRF = 10


class StageLoadError(Exception):
    pass


def scan_tags(title):
    """Return (in_slots, out_tag, param_keys) found in a node title."""
    in_slots, out_tag, params = [], None, []
    for m in TAG_RE.finditer(title or ""):
        bracket, param = m.group(1), m.group(2)
        if param:
            params.append(param)
        elif bracket.startswith("in_"):
            in_slots.append(bracket)
        else:
            out_tag = bracket  # "out" or "out:name"
    return in_slots, out_tag, params


def _inject_param(node, key, value):
    """Set a {param} value on the right widget input. Returns True on success."""
    inputs = node.get("inputs", {})
    widgets = {k: v for k, v in inputs.items() if not isinstance(v, list)}
    if key in widgets:
        inputs[key] = value
        return True
    # 2026-07-04: speed_lora_strength must set both model+clip (Prod parity).
    if key == "speed_lora_strength" and "strength_model" in widgets and "strength_clip" in widgets:
        inputs["strength_model"] = value
        inputs["strength_clip"] = value
        return True
    for candidate in PARAM_INPUT_CANDIDATES.get(key, []):
        if candidate in widgets:
            inputs[candidate] = value
            return True
    if len(widgets) == 1:
        inputs[next(iter(widgets))] = value
        return True
    return False


def load_stage(workflow_path, stage_name, generation_id, params, file_paths,
               prev_output=None, text_output_dir=None, final=False, frame_cap=None):
    """Build a concrete graph for one stage.

    params:       flat dict of tunable values ({param} tags)
    file_paths:   dict slot -> local file path (in_video, in_ref_image, ...)
    prev_output:  local path of the previous stage's output ([in_prev])
    text_output_dir: directory for [out:name] saveText files
    final:        True for the output stage (save-node format left untouched)
    frame_cap:    optional positive int; when set, caps the source video load
                  (VHS_LoadVideoPath nodes receiving [in_video]/[in_prev]) by
                  setting frame_load_cap and zeroing skip_first_frames. Preview
                  runs pass this only for the initial source video load.

    Returns (graph, info) where info = {
      "inputs": {slot: [node_ids]}, "output_node": id or None,
      "text_outputs": {name: file_path}, "params_resolved": [...],
      "params_unresolved": [...],
    }
    """
    with open(workflow_path) as f:
        graph = copy.deepcopy(json.load(f))

    info = {"inputs": {}, "output_node": None, "text_outputs": {},
            "params_resolved": [], "params_unresolved": []}
    prefix = f"{generation_id}_{stage_name}"

    for node_id, node in graph.items():
        title = node.get("_meta", {}).get("title", "")
        in_slots, out_tag, param_keys = scan_tags(title)
        inputs = node.setdefault("inputs", {})

        for slot in in_slots:
            value = prev_output if slot == "in_prev" else file_paths.get(slot)
            if value is None:
                raise StageLoadError(
                    f"{stage_name}: no file for [{slot}] (node {node_id})")
            field = INPUT_FIELD_BY_CLASS.get(node.get("class_type"))
            if field is None:
                raise StageLoadError(
                    f"{stage_name}: unknown load node class "
                    f"{node.get('class_type')} for [{slot}] (node {node_id})")
            inputs[field] = value
            info["inputs"].setdefault(slot, []).append(node_id)
            # Preview frame cap (Prod parity): cap the source video load only.
            # Applies to VHS_LoadVideoPath nodes receiving [in_video]/[in_prev].
            if (isinstance(frame_cap, int) and frame_cap > 0
                    and slot in ("in_video", "in_prev")
                    and node.get("class_type") == "VHS_LoadVideoPath"):
                inputs["frame_load_cap"] = frame_cap
                inputs["skip_first_frames"] = 0

        if out_tag == "out":
            if info["output_node"] is not None:
                raise StageLoadError(
                    f"{stage_name}: multiple [out] nodes "
                    f"({info['output_node']}, {node_id})")
            info["output_node"] = node_id
            if "filename_prefix" in inputs:
                inputs["filename_prefix"] = prefix
            if not final and node.get("class_type") == "VHS_VideoCombine":
                inputs["format"] = INTERMEDIATE_FORMAT
                if "crf" in inputs:
                    inputs["crf"] = INTERMEDIATE_CRF
        elif out_tag and out_tag.startswith("out:"):
            name = out_tag.split(":", 1)[1]
            if text_output_dir:
                inputs["output_file_path"] = text_output_dir
            inputs["file_name"] = f"{prefix}_{name}"
            inputs["overwrite"] = True
            ext = inputs.get("file_extension", "txt").lstrip(".")
            base = inputs.get("output_file_path", text_output_dir or "")
            info["text_outputs"][name] = f"{base}/{prefix}_{name}.{ext}"

        for key in param_keys:
            if key not in params:
                info["params_unresolved"].append((node_id, key))
                continue
            if _inject_param(node, key, params[key]):
                info["params_resolved"].append((node_id, key))
            else:
                info["params_unresolved"].append((node_id, key))

    # Seed broadcast (prod parity): the resolved seed is injected into every
    # node with a seed/random_seed input, not only {seed}-tagged ones. The
    # runner resolves params["seed"] once (-1 -> random) before load_stage.
    seed_val = params.get("seed")
    if seed_val is not None:
        for node in graph.values():
            inputs = node.get("inputs", {})
            if isinstance(inputs, dict):
                if "seed" in inputs:
                    inputs["seed"] = seed_val
                if "random_seed" in inputs:
                    inputs["random_seed"] = seed_val

    return graph, info
