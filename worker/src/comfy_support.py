#!/usr/bin/env python
"""Support code shared by the handler and the pipeline runner.

Imported from the legacy rp_handler.py (COPY tier) with the named IMPROVE
items applied: backend callback URLs have no hardcoded defaults (BACKEND_BASE
is required) and the exports domain comes from EXPORTS_DOMAIN everywhere.
"""

import json
import os
import select
import threading
import time
import urllib.request

import requests
import websocket

DEBUG = os.environ.get("DEBUG", "false").lower() == "true"
LOG_WORKFLOW = os.environ.get("LOG_WORKFLOW", "false").lower() == "true"
HEARTBEAT_INTERVAL = int(os.environ.get("GEN_HEARTBEAT_INTERVAL", 3))

COMFY_HOST = os.environ.get("COMFY_HOST", "127.0.0.1:8188")
COMFY_API_AVAILABLE_INTERVAL_MS = 50
COMFY_API_AVAILABLE_MAX_RETRIES = 500
COMFY_POLLING_INTERVAL_MS = int(os.environ.get("COMFY_POLLING_INTERVAL_MS", 250))
COMFY_POLLING_MAX_RETRIES = int(os.environ.get("COMFY_POLLING_MAX_RETRIES", 115200))
REFRESH_WORKER = os.environ.get("REFRESH_WORKER", "false").lower() == "true"
ENABLE_WEBSOCKET_PROGRESS = os.environ.get("ENABLE_WEBSOCKET_PROGRESS", "true").lower() == "true"
WS_READY_TIMEOUT = int(os.environ.get("WS_READY_TIMEOUT", 15))
SUSPECT_DONE_WINDOW = int(os.environ.get("SUSPECT_DONE_WINDOW", 120))
LOG_THROTTLE_SECONDS = int(os.environ.get("LOG_THROTTLE_SECONDS", 10))


class Logger:
    def __init__(self, debug=False):
        self.debug_enabled = debug
        self._once = set()
        self._last = {}

    def info(self, *args):
        print(*args)

    def debug(self, *args):
        if self.debug_enabled:
            print(*args)

    def once(self, key, *args):
        if key not in self._once:
            self._once.add(key)
            print(*args)

    def throttled(self, key, interval_s, *args):
        now = time.time()
        if now - self._last.get(key, 0) >= interval_s:
            self._last[key] = now
            print(*args)


logger = Logger(DEBUG)


VALID_METHODS = ("forge", "evolve", "trace", "hunyuan")


def validate_input(job_input):
    """Validate the section-3 params payload. Returns (validated, error).

    Shared by rp_handler.py (RunPod mode) and app_server.py (local mode)."""
    if job_input is None:
        return None, "Please provide input"
    if isinstance(job_input, str):
        try:
            job_input = json.loads(job_input)
        except json.JSONDecodeError:
            return None, "Invalid JSON format in input"

    # "client_id" accepted as a compatibility alias at this entry boundary only.
    generation_id = job_input.get("generation_id") or job_input.get("client_id")
    if not generation_id:
        return None, "Missing 'generation_id' parameter"

    params = job_input.get("params")
    if not isinstance(params, dict):
        return None, "Missing 'params' object"
    method = params.get("method")
    if method not in VALID_METHODS:
        return None, f"params.method must be one of {VALID_METHODS}"
    prompt = params.get("prompt")
    if not isinstance(prompt, str) or prompt.strip() == "":
        return None, "params.prompt is required and must be a non-empty string"
    if not isinstance(params.get("features", {}), dict):
        return None, "params.features must be an object"
    if not isinstance(params.get("files", {}), dict):
        return None, "params.files must be an object"
    params.setdefault("features", {})
    params.setdefault("files", {})

    # Frontend sends {"type": "preview"|"full", ...} as a top-level sibling of
    # params. Pass it through so the runner can cap preview frames per method.
    run_type = job_input.get("type", "full")
    if run_type not in ("preview", "full"):
        run_type = "full"

    return {
        "generation_id": generation_id,
        "user_id": job_input.get("user_id", "unknown"),
        "params": params,
        "type": run_type,
    }, None


class WebSocketProgressRelay:
    """Relay progress updates from the worker to the backend WebSocketManager."""

    def __init__(self, generation_id):
        self.generation_id = generation_id
        self.podId = os.environ.get("RUNPOD_POD_ID") or os.environ.get("HOSTNAME") or "unknown-pod"
        backend_base = os.environ.get("BACKEND_BASE", "").rstrip("/")
        if not backend_base:
            logger.info("WARNING: BACKEND_BASE not set - backend callbacks disabled")
        self.websocket_relay_url = os.environ.get(
            "WEBSOCKET_RELAY_URL", f"{backend_base}/api/runpod/progress" if backend_base else "")
        self.video_ready_url = os.environ.get(
            "VIDEO_READY_URL", f"{backend_base}/api/runpod/videoReady" if backend_base else "")
        self.terminal_logs_url = os.environ.get(
            "TERMINAL_LOGS_URL", f"{backend_base}/api/runpod/terminal-logs" if backend_base else "")
        self.callback_secret = os.environ.get("RUNPOD_CALLBACK_SECRET", "")
        if not self.callback_secret:
            logger.info("WARNING: RUNPOD_CALLBACK_SECRET not set - backend callbacks will be rejected")
        logger.debug(f"WebSocketProgressRelay initialized with generation_id: {generation_id}, podId: {self.podId}")

    def _post(self, url, payload):
        if not url:
            return False
        try:
            response = requests.post(
                url, json=payload,
                headers={"Content-Type": "application/json",
                         "X-Callback-Secret": self.callback_secret},
                timeout=5)
            if response.status_code != 200:
                logger.info(f"Error posting to {url}: {response.status_code} {response.text}")
                return False
            return True
        except Exception as e:
            logger.info(f"Failed to post to {url}: {e}")
            return False

    def send_progress(self, event_type, progress_data):
        ok = self._post(self.websocket_relay_url, {
            "generation_id": self.generation_id,
            "eventType": event_type,
            "progressData": progress_data,
        })
        if ok:
            logger.debug(f"Progress update sent: {event_type}")
        return ok

    def notify_video_ready(self, video_url):
        ok = self._post(self.video_ready_url, {
            "generation_id": self.generation_id,
            "videoUrl": video_url,
        })
        if ok:
            logger.info(f"Video ready notification sent: {video_url}")
        return ok

    def send_terminal_logs(self, log_content, user_id=None):
        # Backend rejects empty terminalOutput with 400 "Missing required
        # fields"; an empty tail chunk at job end is normal, not an error.
        if not log_content or not log_content.strip():
            return False
        ok = self._post(self.terminal_logs_url, {
            "generation_id": self.generation_id,
            "userId": user_id or self.generation_id,
            "terminalOutput": log_content,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        })
        if ok:
            logger.debug(f"Terminal logs sent successfully ({len(log_content)} bytes)")
        return ok


class StageRelay:
    """Wrap a relay so every relayed event carries stage metadata."""

    def __init__(self, relay, stage_name, stage_index, stage_total):
        self._relay = relay
        self.podId = relay.podId
        self.stage = {"stageName": stage_name, "stageIndex": stage_index,
                      "stageTotal": stage_total}

    def send_progress(self, event_type, progress_data):
        data = dict(progress_data or {})
        data.update(self.stage)
        return self._relay.send_progress(event_type, data)

    def notify_video_ready(self, video_url):
        return self._relay.notify_video_ready(video_url)

    def send_terminal_logs(self, log_content, user_id=None):
        return self._relay.send_terminal_logs(log_content, user_id)


class ProgressTracker:
    """Track and log progress from the ComfyUI websocket."""

    def __init__(self, relay=None):
        self.progress_log = []
        self.ws = None
        self.completed_prompts = set()
        self.prompt_errors = {}
        self.queue_empty_time = None
        self.last_activity_time = time.time()
        self._last_reconnect_attempt = 0
        self.ping_interval = None
        self._ping_started = False
        self.relay = relay

    def connect(self):
        ws_url = f"ws://{COMFY_HOST}/ws"
        self.ws = websocket.WebSocket()
        try:
            self.ws.connect(ws_url)
            logger.once("ws_connected", f"Connected to websocket at {ws_url}")
            self.start_ping_interval()
            return True
        except Exception as e:
            print(f"Failed to connect to websocket: {e}")
            return False

    def start_ping_interval(self):
        if self.ping_interval or self._ping_started:
            return
        self._ping_started = True

        def send_ping():
            if self.ws and hasattr(self.ws, "connected") and self.ws.connected:
                try:
                    self.ws.send(json.dumps({"type": "ping"}))
                    self.log_progress("Ping sent")
                    self.ping_interval = threading.Timer(30.0, send_ping)
                    self.ping_interval.daemon = True
                    self.ping_interval.start()
                except Exception as e:
                    self.log_progress(f"Error sending ping: {e}", level="ERROR")

        send_ping()

    def log_progress(self, message, level="INFO"):
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        self.progress_log.append({"timestamp": timestamp, "level": level, "message": message})
        if DEBUG or level == "ERROR":
            print(f"Progress: {timestamp} - [{level}] {message}")

    def is_workflow_complete(self, prompt_id):
        if prompt_id in self.completed_prompts:
            self.log_progress(f"Workflow complete: prompt {prompt_id} marked as completed")
            return True
        # Queue-empty is only a diagnostic signal now; it must not mark a prompt
        # complete by itself. Real completion comes from prompt-specific
        # websocket events (executing null-node / executed) recorded in
        # completed_prompts by monitor_progress.
        return False

    def failed_prompt(self, prompt_id):
        """True if an execution_error websocket event named this prompt_id."""
        return prompt_id in self.prompt_errors

    def reset_for_stage(self, relay=None):
        """Reuse the same WS connection across pipeline stages."""
        self.queue_empty_time = None
        self.last_activity_time = time.time()
        if relay is not None:
            self.relay = relay

    def monitor_progress(self):
        if not self.ws:
            return
        try:
            message = self.ws.recv()
            # Any received frame (text, binary preview, ping) proves the
            # ComfyUI websocket is alive. Update the stall timer before parsing
            # so a slow-but-alive job streaming binary preview frames is not
            # killed as "stalled". Previously binary/undecodable frames returned
            # early without resetting the timer.
            self.last_activity_time = time.time()
            logger.debug(f"WS RAW: {message}")
            try:
                if isinstance(message, bytes):
                    try:
                        message_str = message.decode("utf-8")
                    except UnicodeDecodeError:
                        logger.info(f"Received malformed binary WebSocket message, skipping: {len(message)} bytes")
                        return
                else:
                    message_str = message
                data = json.loads(message_str)
            except (json.JSONDecodeError, TypeError, UnicodeDecodeError) as e:
                logger.info(f"Failed to parse WebSocket message: {e}")
                return

            if "type" in data:
                event_type = data["type"]
                self.log_progress(f"WS EVENT: {event_type} - {json.dumps(data)}")

                if event_type == "ping":
                    self.ws.send(json.dumps({"type": "pong"}))
                    self.log_progress("Ping received, pong sent")

                elif event_type == "pong":
                    self.log_progress("Pong received")

                elif event_type == "execution_start":
                    self.log_progress("Execution started")
                    if self.relay:
                        self.relay.send_progress("execution_start", {"status": "started"})

                elif event_type == "execution_cached":
                    self.log_progress("Using cached execution")

                elif event_type == "executing":
                    if "data" in data:
                        if data["data"].get("node"):
                            node_id = data["data"]["node"]
                            self.log_progress(f"Node started executing: {node_id}")
                            if self.relay:
                                self.relay.send_progress("executing", {
                                    "node": node_id, "status": "executing"})
                        elif data["data"].get("node") is None and "prompt_id" in data["data"]:
                            prompt_id = data["data"]["prompt_id"]
                            self.log_progress(f"Workflow complete (null node): {prompt_id}")
                            self.completed_prompts.add(prompt_id)
                            if self.relay:
                                self.relay.send_progress("executed", {
                                    "prompt_id": prompt_id, "status": "completed"})

                elif event_type == "progress":
                    if "data" in data and "value" in data["data"] and "max" in data["data"]:
                        value = data["data"]["value"]
                        max_value = data["data"]["max"]
                        node = data["data"].get("node", "unknown")
                        progress_pct = (value / max_value) * 100
                        self.progress_count = getattr(self, "progress_count", 0) + 1
                        if not getattr(self, "first_progress_time", None):
                            self.first_progress_time = time.time()
                            logger.once("first_progress", f"[WS] first_progress node={node} {progress_pct:.1f}%")
                        self.log_progress(f"Progress: {progress_pct:.1f}%")
                        if self.relay:
                            self.relay.send_progress("progress", {
                                "node": node, "value": value, "max": max_value,
                                "progress": progress_pct})

                elif event_type == "executed":
                    if "data" in data and "prompt_id" in data["data"]:
                        prompt_id = data["data"]["prompt_id"]
                        self.log_progress(f"Execution completed for prompt: {prompt_id}")
                        self.completed_prompts.add(prompt_id)
                        if self.relay:
                            self.relay.send_progress("executed", {
                                "prompt_id": prompt_id, "status": "completed"})

                elif event_type == "execution_interrupted":
                    self.log_progress("Execution interrupted")
                    if self.relay:
                        self.relay.send_progress("error", {
                            "error": "Execution interrupted", "status": "error"})

                elif event_type == "execution_error":
                    error_data = data.get("data", {})
                    self.log_progress(f"Execution error: {json.dumps(error_data)}", level="ERROR")
                    err_prompt_id = error_data.get("prompt_id")
                    if err_prompt_id:
                        self.prompt_errors[err_prompt_id] = error_data
                    if self.relay:
                        self.relay.send_progress("error", {
                            "type": "execution_error",
                            "message": "An error occurred during generation.",
                            "details": error_data})

                elif event_type == "status":
                    if "data" in data and "status" in data["data"] and "exec_info" in data["data"]["status"]:
                        queue_remaining = data["data"]["status"]["exec_info"].get("queue_remaining", -1)
                        self.log_progress(f"Queue status: {queue_remaining} remaining")
                        if queue_remaining == 0:
                            if not self.queue_empty_time:
                                self.log_progress("Queue empty detected, starting completion timer")
                                self.queue_empty_time = time.time()
                                if self.relay:
                                    self.relay.send_progress("status", {
                                        "status": {"exec_info": {"queue_remaining": 0}}})
                                logger.once("queue_empty", "[QUEUE] empty_detected")
                        else:
                            self.queue_empty_time = None
                            if self.relay and queue_remaining > 0:
                                self.relay.send_progress("status", {
                                    "status": {"exec_info": {"queue_remaining": queue_remaining}}})

        except Exception as e:
            logger.info(f"Error monitoring progress: {e}")

    def stop(self):
        try:
            if self.ping_interval:
                try:
                    self.ping_interval.cancel()
                except Exception:
                    pass
                self.ping_interval = None
            self._ping_started = False
            if self.ws and hasattr(self.ws, "connected") and self.ws.connected:
                try:
                    self.ws.close()
                except Exception:
                    pass
            self.ws = None
        except Exception as e:
            self.log_progress(f"Error during stop(): {e}", level="ERROR")

    def process_all_messages(self):
        if not self.ws or not hasattr(self.ws, "connected") or not self.ws.connected:
            current_time = time.time()
            if current_time - self._last_reconnect_attempt > 5:
                self._last_reconnect_attempt = current_time
                self.log_progress("Websocket disconnected, attempting to reconnect")
                if not self.connect():
                    return
            else:
                return

        while self.ws and hasattr(self.ws, "connected") and self.ws.connected:
            if not select.select([self.ws.sock], [], [], 0)[0]:
                break
            self.monitor_progress()


def check_server(url, retries=500, delay=50):
    """Check if a server is reachable via HTTP GET request."""
    print("\n=== Checking ComfyUI API ===")
    print(f"URL: {url}")
    for i in range(retries):
        try:
            response = requests.get(url)
            if response.status_code == 200:
                print("ComfyUI API is reachable")
                return True
        except requests.RequestException:
            pass
        time.sleep(delay / 1000)
        if (i + 1) % 20 == 0:
            print(f"Still waiting for API... (attempt {i + 1})")
    print(f"Failed to connect to server at {url} after {retries} attempts.")
    return False


def queue_workflow(workflow):
    """Queue a workflow to be processed by ComfyUI."""
    logger.info("Sending Workflow to ComfyUI")
    url = f"http://{COMFY_HOST}/prompt"
    logger.info(f"URL: {url}")
    if LOG_WORKFLOW:
        print("\nWorkflow being sent:")
        print(json.dumps(workflow, indent=2))
    data = json.dumps({"prompt": workflow}).encode("utf-8")
    try:
        req = urllib.request.Request(url, data=data)
        response = urllib.request.urlopen(req)
        return json.loads(response.read())
    except Exception as e:
        print(f"\nError sending workflow: {e}")
        raise


def get_history(prompt_id):
    """Retrieve the history of a given prompt using its ID."""
    with urllib.request.urlopen(f"http://{COMFY_HOST}/history/{prompt_id}") as response:
        return json.loads(response.read())


def get_queue():
    """Retrieve the current ComfyUI queue state (running + pending)."""
    with urllib.request.urlopen(f"http://{COMFY_HOST}/queue") as response:
        return json.loads(response.read())


def head_ok(url):
    """HEAD check helper."""
    try:
        r = requests.head(url, timeout=5)
        return r.status_code == 200
    except Exception:
        return False
