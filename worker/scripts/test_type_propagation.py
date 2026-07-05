#!/usr/bin/env python3
"""Non-GPU payload-shape test for the preview `type` propagation chain.

Proves the worker end of the fix for the bug where preview runs reached the
worker with input.type absent (so validate_input defaulted to "full" and
PREVIEW_FRAME_CAPS never applied, leaving VHS_LoadVideoPath frame_load_cap=0).

Chain covered (worker side; the broken link was backend/routes/runpod.js
dropping `type` from the RunPod job input):
  job_input["type"] -> validate_input -> validated["type"]
  -> run_pipeline(run_type=...) -> frame_cap = PREVIEW_FRAME_CAPS[method]

  (a) type="preview" + method="forge" -> validated["type"]=="preview" and
      the frame_cap the runner would compute == PREVIEW_FRAME_CAPS["forge"] (120)
  (b) type omitted -> validated["type"]=="full" and frame_cap == 0
  (c) type="garbage" -> normalized to "full" and frame_cap == 0

Run: python3 worker/scripts/test_type_propagation.py
No GPU, no ComfyUI, no network required.
"""

import os
import sys

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(SCRIPTS_DIR, "..", "src"))

from comfy_support import validate_input  # noqa: E402
from pipeline import runner  # noqa: E402


def _job_input(method, type_=None):
    """Build a minimal section-3 job_input like the backend forwards to RunPod."""
    params = {"method": method, "prompt": "a prompt", "features": {}, "files": {}}
    ji = {"generation_id": "gen_test", "user_id": "u", "params": params}
    if type_ is not None:
        ji["type"] = type_
    return ji


def _frame_cap_for(run_type, method):
    """Replicate runner.run_pipeline's frame_cap selection (runner.py:437-439)."""
    if run_type == "preview":
        return runner.PREVIEW_FRAME_CAPS.get(method, 0)
    return 0


def test_preview_forge_propagates_and_caps_120():
    ji = _job_input("forge", "preview")
    validated, err = validate_input(ji)
    assert err is None, f"expected no validation error, got {err}"
    assert validated["type"] == "preview", \
        f"type should propagate as preview, got {validated['type']}"
    cap = _frame_cap_for(validated["type"], validated["params"]["method"])
    assert cap == 120, f"forge preview cap should be 120, got {cap}"
    print("OK: type=preview + forge -> validated type=preview, frame_cap=120")


def test_type_omitted_defaults_full_and_zero_cap():
    ji = _job_input("forge")
    validated, err = validate_input(ji)
    assert err is None, f"expected no validation error, got {err}"
    assert validated["type"] == "full", \
        f"missing type should default to full, got {validated['type']}"
    cap = _frame_cap_for(validated["type"], validated["params"]["method"])
    assert cap == 0, f"full run should have frame_cap 0, got {cap}"
    print("OK: type omitted -> full, frame_cap=0")


def test_type_garbage_normalized_to_full():
    ji = _job_input("forge", "garbage")
    validated, err = validate_input(ji)
    assert err is None, f"expected no validation error, got {err}"
    assert validated["type"] == "full", \
        f"garbage type should normalize to full, got {validated['type']}"
    cap = _frame_cap_for(validated["type"], validated["params"]["method"])
    assert cap == 0, f"normalized-full run should have frame_cap 0, got {cap}"
    print("OK: type=garbage -> normalized full, frame_cap=0")


def main():
    test_preview_forge_propagates_and_caps_120()
    test_type_omitted_defaults_full_and_zero_cap()
    test_type_garbage_normalized_to_full()
    print("\nAll type-propagation unit tests passed.")


if __name__ == "__main__":
    main()
