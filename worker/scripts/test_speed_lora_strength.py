#!/usr/bin/env python3
"""Non-GPU unit test for speed_lora_strength dual-write in loader.load_stage.

Proves (ST-2.2): loading generate_animatediff.json with speed_lora_strength=0
sets BOTH strength_model AND strength_clip on the tagged LoraLoader node to 0
(Prod parity: Quality preset neutralizes the speed LoRA via strength 0).

Run: python3 worker/scripts/test_speed_lora_strength.py
No GPU, no ComfyUI, no network required.
"""

import os
import sys

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(SCRIPTS_DIR, "..", "src"))

from pipeline import loader  # noqa: E402

REPO_ROOT = os.path.abspath(os.path.join(SCRIPTS_DIR, "..", ".."))
WORKFLOWS = os.path.join(REPO_ROOT, "workflows")

PARAMS = {
    "method": "evolve",
    "prompt": "a cinematic scene",
    "negative_prompt": "ugly, blurry",
    "seed": 12345,
    "steps": 30,
    "cfg": 6.0,
    "denoise": 0.7,
    "frame_divider": 2,
    "speed_lora": "Hyper-SDXL-12steps-CFG-lora.safetensors",
    "speed_lora_strength": 0,
    "style_lora": "style.safetensors",
    "ipadapter_style_weight": 1.2,
}

FILES = {
    "in_video": "/tmp/dummy/in_video.mp4",
    "in_style_ref": "/tmp/dummy/in_style_ref.png",
}


def test_speed_lora_strength_zeroes_both_model_and_clip():
    path = os.path.join(WORKFLOWS, "generate_animatediff.json")
    graph, info = loader.load_stage(
        path, "generate_animatediff", "genID", dict(PARAMS), FILES,
        prev_output="/tmp/dummy/prev.mp4", text_output_dir="/tmp/dummy/text",
        final=False)

    lora_node = None
    for node_id, node in graph.items():
        title = node.get("_meta", {}).get("title", "")
        if "speed_lora_strength" in title and node.get("class_type") == "LoraLoader":
            lora_node = node
            break

    assert lora_node is not None, "No LoraLoader node tagged {speed_lora_strength} found"
    inputs = lora_node["inputs"]
    assert inputs["strength_model"] == 0, \
        f"strength_model should be 0, got {inputs['strength_model']}"
    assert inputs["strength_clip"] == 0, \
        f"strength_clip should be 0, got {inputs['strength_clip']}"


if __name__ == "__main__":
    test_speed_lora_strength_zeroes_both_model_and_clip()
    print("OK: speed_lora_strength=0 sets both strength_model and strength_clip to 0")
