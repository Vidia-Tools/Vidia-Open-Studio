#!/usr/bin/env python3
"""Non-GPU unit test for preview frame capping in loader.load_stage.

Proves (ST-1.1):
  (a) preview + method evolve caps at 16 on the VHS_LoadVideoPath node
  (b) preview + forge caps at 120
  (c) full (frame_cap=None) leaves frame_load_cap untouched

Uses loader.load_stage directly with a minimal synthetic graph: a single
VHS_LoadVideoPath node tagged [in_video] in _meta.title, plus a terminal
[out] save node so the graph is well-formed.

Run: python3 worker/scripts/test_frame_cap.py
No GPU, no ComfyUI, no network required.
"""

import json
import os
import sys
import tempfile

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(SCRIPTS_DIR, "..", "src"))

from pipeline import loader  # noqa: E402


def _synthetic_graph():
    """A minimal two-node graph: a VHS_LoadVideoPath [in_video] load + a save [out]."""
    return {
        "load": {
            "class_type": "VHS_LoadVideoPath",
            "inputs": {"video": "", "frame_load_cap": 0, "skip_first_frames": 0},
            "_meta": {"title": "Load Video (Path) [in_video]"},
        },
        "save": {
            "class_type": "VHS_VideoCombine",
            "inputs": {"filename_prefix": "x", "format": "video/h264-mp4"},
            "_meta": {"title": "Save [out]"},
        },
    }


def _load(frame_cap):
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "stage.json")
        with open(path, "w") as f:
            json.dump(_synthetic_graph(), f)
        params = {"method": "forge", "seed": 1}
        files = {"in_video": "/tmp/dummy/in_video.mp4"}
        graph, info = loader.load_stage(
            path, "generate", "genID", params, files,
            prev_output=None, text_output_dir=d, final=False, frame_cap=frame_cap)
    return graph, info


def test_preview_evolve_caps_at_16():
    graph, info = _load(16)
    assert graph["load"]["inputs"]["frame_load_cap"] == 16, \
        f"evolve preview cap should be 16, got {graph['load']['inputs']['frame_load_cap']}"
    assert graph["load"]["inputs"]["skip_first_frames"] == 0
    assert "in_video" in info["inputs"]
    print("OK: preview + evolve caps VHS_LoadVideoPath at 16 frames")


def test_preview_forge_caps_at_120():
    graph, info = _load(120)
    assert graph["load"]["inputs"]["frame_load_cap"] == 120, \
        f"forge preview cap should be 120, got {graph['load']['inputs']['frame_load_cap']}"
    assert graph["load"]["inputs"]["skip_first_frames"] == 0
    print("OK: preview + forge caps VHS_LoadVideoPath at 120 frames")


def test_full_leaves_frame_load_cap_untouched():
    graph, info = _load(None)
    assert graph["load"]["inputs"]["frame_load_cap"] == 0, \
        f"full run should leave frame_load_cap at 0, got {graph['load']['inputs']['frame_load_cap']}"
    assert graph["load"]["inputs"]["skip_first_frames"] == 0
    print("OK: full run leaves frame_load_cap untouched (0)")


def main():
    test_preview_evolve_caps_at_16()
    test_preview_forge_caps_at_120()
    test_full_leaves_frame_load_cap_untouched()
    print("\nAll frame-cap unit tests passed.")


if __name__ == "__main__":
    main()
