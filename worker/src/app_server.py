#!/usr/bin/env python
"""Local mode entrypoint: a thin HTTP server wrapping the pipeline engine.

No RunPod SDK, no R2 uploads, no backend callbacks, no auth. The engine
(src/pipeline/) is identical to RunPod mode; only the wrapper differs.

Endpoints:
  POST /generate            section-3 params payload -> runs pipeline,
                            returns {"output_file": "..."} (path in the
                            ComfyUI output directory)
  GET  /progress?id=<gen>   Server-Sent Events stream of the same stage
                            events the RunPod relay emits (stage_start,
                            executing, progress, executed, stage_complete,
                            error, ...). Omit id to receive all generations.

Usage:
  python app_server.py --comfy http://127.0.0.1:8188 --port 8189
"""

import argparse
import json
import os
import queue
import random
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs


def _parse_args():
    parser = argparse.ArgumentParser(description="Vidia Open Studio local app server")
    parser.add_argument("--comfy", default=os.environ.get("COMFY_URL", "http://127.0.0.1:8188"),
                        help="ComfyUI base URL (default http://127.0.0.1:8188)")
    parser.add_argument("--port", type=int, default=int(os.environ.get("APP_SERVER_PORT", 8189)),
                        help="Port for this app server (default 8189)")
    parser.add_argument("--host", default="127.0.0.1",
                        help="Bind address (default 127.0.0.1; use 0.0.0.0 to "
                             "expose on all interfaces)")
    return parser.parse_args()


ARGS = _parse_args()
# comfy_support reads COMFY_HOST at import time, so set it before importing.
os.environ["COMFY_HOST"] = urlparse(ARGS.comfy).netloc or ARGS.comfy

from comfy_support import (  # noqa: E402
    COMFY_API_AVAILABLE_INTERVAL_MS, COMFY_API_AVAILABLE_MAX_RETRIES,
    COMFY_HOST, ENABLE_WEBSOCKET_PROGRESS, WS_READY_TIMEOUT,
    ProgressTracker, check_server, logger, validate_input,
)
from pipeline import runner  # noqa: E402
import build_mode  # noqa: E402

BUILD_PREFIX = "/build/"


class LocalProgressRelay:
    """Drop-in replacement for WebSocketProgressRelay that fans events out to
    SSE subscribers instead of POSTing to a backend. StageRelay wraps it
    unchanged, so events carry the same stageName/stageIndex/stageTotal."""

    def __init__(self):
        self.podId = "local"
        self._lock = threading.Lock()
        self._subscribers = []  # list of (generation_id filter or None, queue)

    def subscribe(self, generation_id=None):
        q = queue.Queue()
        with self._lock:
            self._subscribers.append((generation_id, q))
        return q

    def unsubscribe(self, q):
        with self._lock:
            self._subscribers = [(g, s) for g, s in self._subscribers if s is not q]

    def for_generation(self, generation_id):
        return _GenerationRelay(self, generation_id)

    def publish(self, generation_id, event_type, progress_data):
        event = {"generation_id": generation_id, "eventType": event_type,
                 "progressData": progress_data}
        with self._lock:
            for gen_filter, q in self._subscribers:
                if gen_filter is None or gen_filter == generation_id:
                    q.put(event)
        return True


class _GenerationRelay:
    """Per-generation view exposing the WebSocketProgressRelay interface."""

    def __init__(self, hub, generation_id):
        self._hub = hub
        self.generation_id = generation_id
        self.podId = hub.podId

    def send_progress(self, event_type, progress_data):
        return self._hub.publish(self.generation_id, event_type, progress_data)

    def notify_video_ready(self, video_url):
        return self._hub.publish(self.generation_id, "video_ready", {"videoUrl": video_url})

    def send_terminal_logs(self, log_content, user_id=None):
        return self._hub.publish(self.generation_id, "terminal_logs",
                                 {"terminalOutput": log_content})


HUB = LocalProgressRelay()


def run_generation(validated):
    """Run one generation through the pipeline. Returns the runner result."""
    generation_id = validated["generation_id"]
    relay = HUB.for_generation(generation_id)

    progress = None
    if ENABLE_WEBSOCKET_PROGRESS:
        progress = ProgressTracker(relay)
        deadline = time.time() + WS_READY_TIMEOUT
        while time.time() < deadline:
            if progress.connect():
                break
            time.sleep(1)
        else:
            logger.info(f"Warning: ComfyUI WebSocket not ready within {WS_READY_TIMEOUT}s; "
                        "proceeding without WS gating")

    try:
        return runner.run_pipeline(generation_id, validated["user_id"],
                                   validated["params"], relay, progress,
                                   run_type=validated.get("type", "full"))
    finally:
        if progress:
            try:
                progress.stop()
            except Exception:
                pass


class AppHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        # Local Build Mode UI runs on the vite dev origin; allow cross-origin.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        """Parse a JSON request body, or None if absent/invalid."""
        try:
            length = int(self.headers.get("Content-Length", 0))
            if not length:
                return None
            return json.loads(self.rfile.read(length))
        except (ValueError, json.JSONDecodeError):
            return None

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_PUT(self):
        parsed = urlparse(self.path)
        if not parsed.path.startswith(BUILD_PREFIX):
            self._json(404, {"error": "Not found"})
            return
        sub = parsed.path[len(BUILD_PREFIX):]
        status, payload = build_mode.dispatch(
            "PUT", sub, parse_qs(parsed.query), self._read_body())
        self._json(status, payload)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith(BUILD_PREFIX):
            sub = parsed.path[len(BUILD_PREFIX):]
            status, payload = build_mode.dispatch(
                "POST", sub, parse_qs(parsed.query), self._read_body())
            self._json(status, payload)
            return
        if parsed.path != "/generate":
            self._json(404, {"error": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length))
        except (ValueError, json.JSONDecodeError):
            self._json(400, {"error": "Invalid JSON body", "generation_id": None,
                             "stage": None})
            return

        # "client_id" accepted as an alias at this entry boundary only;
        # mint a generation_id when the client supplies neither.
        if isinstance(payload, dict):
            if not payload.get("generation_id") and payload.get("client_id"):
                payload["generation_id"] = payload["client_id"]
            if not payload.get("generation_id"):
                payload["generation_id"] = (
                    f"gen_{int(time.time())}_{random.getrandbits(32):08x}")

        validated, error = validate_input(payload)
        if error:
            self._json(400, {"error": error,
                             "generation_id": payload.get("generation_id")
                             if isinstance(payload, dict) else None,
                             "stage": None})
            return

        generation_id = validated["generation_id"]
        logger.info(f"[LOCAL] generate start generation_id={generation_id}")
        try:
            result = run_generation(validated)
            self._json(200, {"status": "success",
                             "generation_id": generation_id,
                             "output_file": result.get("final_output"),
                             "resolved_seed": result.get("resolved_seed"),
                             "stages": result.get("stages")})
        except runner.PipelineError as e:
            HUB.publish(generation_id, "error",
                        {"error": str(e), "generation_id": generation_id,
                         "stage": e.stage})
            self._json(500, {"error": str(e), "generation_id": generation_id,
                             "stage": e.stage})
        except Exception as e:
            self._json(500, {"error": f"Unexpected error: {e}",
                             "generation_id": generation_id, "stage": None})

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith(BUILD_PREFIX):
            sub = parsed.path[len(BUILD_PREFIX):]
            status, payload = build_mode.dispatch(
                "GET", sub, parse_qs(parsed.query), None)
            self._json(status, payload)
            return
        if parsed.path != "/progress":
            self._json(404, {"error": "Not found"})
            return
        generation_id = (parse_qs(parsed.query).get("id") or [None])[0]
        q = HUB.subscribe(generation_id)
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            while True:
                try:
                    event = q.get(timeout=15)
                    data = json.dumps(event)
                except queue.Empty:
                    data = json.dumps({"eventType": "heartbeat",
                                       "progressData": {"ts": int(time.time() * 1000)}})
                self.wfile.write(f"data: {data}\n\n".encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            HUB.unsubscribe(q)

    def log_message(self, fmt, *args):
        logger.debug(f"[HTTP] {fmt % args}")


def main():
    check_server(f"http://{COMFY_HOST}",
                 COMFY_API_AVAILABLE_MAX_RETRIES,
                 COMFY_API_AVAILABLE_INTERVAL_MS)
    server = ThreadingHTTPServer((ARGS.host, ARGS.port), AppHandler)
    logger.info(f"Vidia Open Studio local server on {ARGS.host}:{ARGS.port} "
                f"(ComfyUI at {COMFY_HOST})")
    server.serve_forever()


if __name__ == "__main__":
    main()
