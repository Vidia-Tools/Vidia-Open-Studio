#!/usr/bin/env python3
"""Dry-run verification: load all 15 tagged workflows through loader.py with
dummy params and assert the tag contract holds:

  - every {param} tag resolves to a node input
  - every [in_*] slot is found and injected
  - exactly one terminal [out] per stage (named [out:*] allowed for prompt_prep)

Run from anywhere: python3 worker/scripts/dryrun_loader.py
"""

import os
import sys

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(SCRIPTS_DIR, "..", "src"))

from pipeline import loader  # noqa: E402

REPO_ROOT = os.path.abspath(os.path.join(SCRIPTS_DIR, "..", ".."))
WORKFLOWS = os.path.join(REPO_ROOT, "workflows")

DUMMY_PARAMS = {
    "method": "forge",
    "prompt": "a cinematic scene",
    "negative_prompt": "ugly, blurry",
    "seed": 12345,
    "steps": 20,
    "cfg": 6.0,
    "denoise": 0.7,
    "aspect": "16:9",
    "frame_divider": 2,
    "speed_lora": "Hyper-SDXL-8steps-CFG-lora.safetensors",
    "style_lora": "style.safetensors",
    "effects_lora": "effects.safetensors",
    "pusa_lora_low": "pusa_low.safetensors",
    "pusa_lora_high": "pusa_high.safetensors",
    "lora_strength": 0.8,
    "ipadapter_style_weight": 1.2,
    "upscale_multiplier": 2,
    "points_positive": "{\"positive\":[],\"negative\":[]}",
    "subject_person": True,
    "subject_object": False,
    "subject_place": True,
    "subject_original": False,
    "prompt_enhance_enabled": True,
    "use_cloud_llm": False,
    "openrouter_api_key": "dummy-key",
    "lora_keywords": "keywords",
    "prompt_enhance_template": "enhance {prompt}",
}

DUMMY_FILES = {
    "in_video": "/tmp/dummy/in_video.mp4",
    "in_ref_image": "/tmp/dummy/in_ref_image.png",
    "in_face_image": "/tmp/dummy/in_face_image.png",
    "in_style_ref": "/tmp/dummy/in_style_ref.png",
    "in_face_video": "/tmp/dummy/in_face_video.mp4",
}

# (filename, has_in_prev, text_stage, final)
FLOWS = [
    ("prompt_prep.json", False, True, False),
    ("body_replace.json", True, False, False),
    ("generate_wan.json", True, False, False),
    ("generate_animatediff.json", True, False, False),
    ("generate_reversenoise.json", True, False, False),
    ("generate_hunyuan.json", True, False, False),
    ("detailer.json", True, False, False),
    ("faceswap.json", True, False, False),
    ("liveportrait.json", True, False, False),
    ("upscale.json", True, False, False),
    ("post.json", True, False, False),
    ("audio.json", True, False, False),
    ("output_saver.json", True, False, True),
    ("skin.json", True, False, False),
]


def main():
    failures = []
    for filename, has_prev, text_stage, final in FLOWS:
        stage_name = filename.replace(".json", "")
        path = os.path.join(WORKFLOWS, filename)
        try:
            graph, info = loader.load_stage(
                path, stage_name, "dryrunGenID", dict(DUMMY_PARAMS), DUMMY_FILES,
                prev_output="/tmp/dummy/prev.mp4", text_output_dir="/tmp/dummy/text",
                final=final)
        except loader.StageLoadError as e:
            failures.append(f"{filename}: load failed: {e}")
            continue

        if info["params_unresolved"]:
            failures.append(f"{filename}: unresolved params: {info['params_unresolved']}")
        if has_prev and "in_prev" not in info["inputs"]:
            failures.append(f"{filename}: [in_prev] slot not found")
        if text_stage:
            if info["output_node"] is not None:
                failures.append(f"{filename}: text stage has a terminal [out]")
            if not info["text_outputs"]:
                failures.append(f"{filename}: text stage has no [out:*] outputs")
        else:
            if info["output_node"] is None:
                failures.append(f"{filename}: no terminal [out] node")

        outs = "/".join(info["text_outputs"]) if text_stage else info["output_node"]
        print(f"OK   {filename}: {len(graph)} nodes, inputs={sorted(info['inputs'])}, "
              f"out={outs}, params={len(info['params_resolved'])}")

    if failures:
        print("\nFAILURES:")
        for f in failures:
            print(f"  {f}")
        return 1
    print(f"\nAll {len(FLOWS)} workflows passed the dry run.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
