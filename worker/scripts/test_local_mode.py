#!/usr/bin/env python3
"""Mock test for local mode: stubs ComfyUI HTTP endpoints (/, /prompt,
/history) and drives POST /generate through a minimal one-stage manifest to
assert app_server.py wires the runner correctly.

Run: python3 worker/scripts/test_local_mode.py
No GPU, no ComfyUI, no network required.
"""

import json
import os
import socket
import sys
import tempfile
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src")
sys.path.insert(0, SRC)

PROMPT_ID = "mock-prompt-1"
OUTPUT_FILENAME = "gen_test_output_00001.mp4"


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class MockComfy(BaseHTTPRequestHandler):
    def _json(self, payload):
        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/history/"):
            self._json({PROMPT_ID: {"outputs": {
                "1": {"gifs": [{"filename": OUTPUT_FILENAME, "subfolder": ""}]}}}})
        else:
            self._json({"status": "ok"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length))
        assert "prompt" in body, "queue_workflow must POST a {prompt: graph} body"
        MockComfy.last_graph = body["prompt"]
        self._json({"prompt_id": PROMPT_ID})

    def log_message(self, *args):
        pass


def main():
    comfy_port = free_port()
    app_port = free_port()
    tmp = tempfile.mkdtemp(prefix="vidia_local_test_")

    # Minimal final stage: one stock save node, no [in_prev] (first stage).
    workflow = {"1": {
        "inputs": {"filename_prefix": "VidiaExport", "format": "video/h264-mp4",
                   "save_output": True},
        "class_type": "VHS_VideoCombine",
        "_meta": {"title": "Video Combine [out]"},
    }}
    os.makedirs(os.path.join(tmp, "workflows"))
    with open(os.path.join(tmp, "workflows", "save_only.json"), "w") as f:
        json.dump(workflow, f)

    # Env before imports: comfy_support reads these at import time.
    os.environ["ENABLE_WEBSOCKET_PROGRESS"] = "false"
    os.environ["VIDIA_MODE"] = "local"
    os.environ["COMFY_POLLING_INTERVAL_MS"] = "50"
    os.environ["VIDIA_WORK_DIR"] = os.path.join(tmp, "work")
    os.environ["COMFY_OUTPUT_DIR"] = os.path.join(tmp, "comfy_output")
    sys.argv = ["app_server.py", "--comfy", f"http://127.0.0.1:{comfy_port}",
                "--port", str(app_port)]

    comfy_server = ThreadingHTTPServer(("127.0.0.1", comfy_port), MockComfy)
    threading.Thread(target=comfy_server.serve_forever, daemon=True).start()

    import app_server
    from pipeline import runner

    runner.load_manifest = lambda: {"stages": [
        {"name": "output", "file": "workflows/save_only.json",
         "feature": None, "final": True}]}
    runner.WORKFLOWS_BASE = tmp

    app = ThreadingHTTPServer(("127.0.0.1", app_port), app_server.AppHandler)
    threading.Thread(target=app.serve_forever, daemon=True).start()

    base = f"http://127.0.0.1:{app_port}"

    # Collect progress events via the hub (same events the SSE endpoint relays)
    events = app_server.HUB.subscribe("gen_test")

    # 1. Invalid payload rejected by the shared validate_input
    req = urllib.request.Request(f"{base}/generate", data=b"{}",
                                 headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req)
        raise AssertionError("invalid payload should return 400")
    except urllib.error.HTTPError as e:
        assert e.code == 400, f"expected 400, got {e.code}"

    # 2. Valid payload runs the pipeline against the mocked ComfyUI
    # ("client_id" exercises the alias normalization at the entry boundary)
    payload = json.dumps({"client_id": "gen_test", "params": {
        "method": "forge", "prompt": "a test", "features": {}, "files": {}}}).encode()
    req = urllib.request.Request(f"{base}/generate", data=payload,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read())

    assert result["status"] == "success", result
    assert result["generation_id"] == "gen_test"
    assert result["stages"] == 1
    assert isinstance(result["resolved_seed"], int), result
    assert result["output_file"].endswith(OUTPUT_FILENAME), result["output_file"]

    # Runner injected the filename_prefix through the loader
    graph = MockComfy.last_graph
    assert graph["1"]["inputs"]["filename_prefix"] == "gen_test_output", graph

    # Stage events were relayed with stage metadata under the canonical key
    seen = []
    while not events.empty():
        seen.append(events.get_nowait())
    types = [e["eventType"] for e in seen]
    assert "stage_start" in types and "stage_complete" in types, types
    start = next(e for e in seen if e["eventType"] == "stage_start")
    assert start["generation_id"] == "gen_test"
    assert start["progressData"]["stageName"] == "output"
    assert start["progressData"]["stageIndex"] == 1
    assert start["progressData"]["stageTotal"] == 1
    complete = next(e for e in seen if e["eventType"] == "stage_complete")
    assert complete["generation_id"] == "gen_test"
    assert complete["progressData"]["resolved_seed"] == result["resolved_seed"], complete

    # 3. Forced failure: stage workflow needs [in_ref_image] but no file is
    # provided, so the runner raises PipelineError carrying the stage name and
    # the wrapper returns the error envelope.
    fail_workflow = {"1": {
        "inputs": {"image": ""},
        "class_type": "LoadImage",
        "_meta": {"title": "Load Image [in_ref_image]"},
    }}
    with open(os.path.join(tmp, "workflows", "fail_stage.json"), "w") as f:
        json.dump(fail_workflow, f)
    runner.load_manifest = lambda: {"stages": [
        {"name": "output", "file": "workflows/fail_stage.json",
         "feature": None, "final": True}]}

    payload = json.dumps({"generation_id": "gen_fail", "params": {
        "method": "forge", "prompt": "a test", "features": {}, "files": {}}}).encode()
    req = urllib.request.Request(f"{base}/generate", data=payload,
                                 headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=30)
        raise AssertionError("forced failure should return 500")
    except urllib.error.HTTPError as e:
        assert e.code == 500, f"expected 500, got {e.code}"
        envelope = json.loads(e.read())
    assert envelope["error"], envelope
    assert envelope["generation_id"] == "gen_fail", envelope
    assert envelope["stage"] == "output", envelope

    print("OK: validate_input 400, /generate 200, output file resolved, "
          "filename_prefix injected, stage events relayed with metadata, "
          "completion event carries generation_id + resolved_seed, "
          "failure envelope carries stage")


if __name__ == "__main__":
    main()
