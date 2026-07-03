#!/usr/bin/env python3
"""Build Mode (ST7) static test: exercises build_mode.py against the real repo
config files while leaving the working tree byte-for-byte clean.

Covers: config-writer round-trips (manifest, controls, modes), config-writer
path-safety rejection, workflow validation pass + fail, and confirms a controls
write keeps the coverage script at 100%. Every file it writes is snapshotted as
raw bytes up front and restored in a finally block, so no tree churn remains.

Run: python3 worker/scripts/test_build_mode.py   (no GPU/ComfyUI/network)
"""

import os
import subprocess
import sys

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src")
sys.path.insert(0, SRC)

import build_mode  # noqa: E402

ROOT = build_mode.REPO_ROOT
SNAPSHOT_FILES = [
    os.path.join(ROOT, "worker/src/pipeline/manifest.json"),
    os.path.join(ROOT, "frontend/js/config/modes.json"),
    os.path.join(ROOT, "frontend/public/controls/generate.json"),
]

PASS_WORKFLOW = os.path.join(ROOT, "workflows/generate_wan.json")

# Missing terminal [out], one resolvable {param}: must fail validation.
FAIL_WORKFLOW = {
    "1": {"inputs": {"value": "x"}, "class_type": "PrimitiveNode",
          "_meta": {"title": "thing {prompt}"}},
}


def main():
    snapshots = {p: open(p, "rb").read() for p in SNAPSHOT_FILES}
    try:
        # 1. manifest read + write round-trip (data preserved)
        man = build_mode.read_config("manifest")
        build_mode.write_config("manifest", man)
        assert build_mode.read_config("manifest") == man, "manifest round-trip drift"

        # 2. modes read + write round-trip
        modes = build_mode.read_config("modes")
        build_mode.write_config("modes", modes)
        assert build_mode.read_config("modes") == modes, "modes round-trip drift"

        # 3. controls write, then coverage script must still report 100%
        ctl = build_mode.read_config("controls", "generate.json")
        build_mode.write_config("controls", ctl, "generate.json")
        assert build_mode.read_config("controls", "generate.json") == ctl
        cov = subprocess.run(["node", "controls/verify_coverage.mjs"],
                             cwd=ROOT, capture_output=True, text=True)
        assert cov.returncode == 0, f"coverage failed after write:\n{cov.stdout}\n{cov.stderr}"
        assert "COVERAGE_OK" in cov.stdout, cov.stdout

        # 4. workflow validation PASS (a real shipped workflow)
        import json
        with open(PASS_WORKFLOW) as f:
            good = json.load(f)
        res = build_mode.validate_workflow(good)
        assert res["valid"], f"real workflow should validate: {res['errors']}"
        assert res["summary"]["output_node"] is not None

        # 5. workflow validation FAIL (missing [out])
        bad = build_mode.validate_workflow(FAIL_WORKFLOW)
        assert not bad["valid"], "broken workflow should not validate"
        assert any("[out]" in e for e in bad["errors"]), bad["errors"]

        # 6. config-writer path-safety: a write outside allowed dirs is rejected
        for evil in ["../evil.json", "../../etc/passwd.json", "sub/dir.json"]:
            try:
                build_mode.write_config("controls", {}, evil)
                raise AssertionError(f"path escape not rejected: {evil}")
            except build_mode.ConfigError:
                pass

        print("OK: manifest/modes/controls round-trip, coverage 100% after "
              "controls write, workflow validate pass+fail, path-safety rejected")
    finally:
        for path, data in snapshots.items():
            with open(path, "wb") as f:
                f.write(data)


if __name__ == "__main__":
    main()
