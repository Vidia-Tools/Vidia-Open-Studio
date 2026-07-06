#!/usr/bin/env python
"""RunPod serverless entrypoint: validates the params payload and hands the
generation to the pipeline runner (src/pipeline/runner.py)."""

import json
import os
import threading
import time

import requests
import runpod

from comfy_support import (
    COMFY_API_AVAILABLE_INTERVAL_MS, COMFY_API_AVAILABLE_MAX_RETRIES,
    COMFY_HOST, ENABLE_WEBSOCKET_PROGRESS, HEARTBEAT_INTERVAL, REFRESH_WORKER,
    WS_READY_TIMEOUT, ProgressTracker, WebSocketProgressRelay, check_server,
    logger, validate_input,
)
from pipeline import runner


COMFY_LOG_PATH = os.environ.get("COMFY_LOG_PATH", "/tmp/comfy.log")
_NODE_LOG_NEEDLES = (
    "Notifying backend",
    "Successfully notified backend",
    "Backend notification failed",
    "Failed to notify backend",
    "[VidiaNode]",
)


def _expected_export_url(generation_id):
    """Build the expected public export URL for a generation, or None if
    S3_PUBLIC_URL_PREFIX is unset (fallback disabled)."""
    prefix = os.environ.get("S3_PUBLIC_URL_PREFIX", "").rstrip("/")
    if not prefix:
        return None
    return f"{prefix}/{generation_id}.mp4"


def _fallback_notify_video_ready(generation_id, relay):
    """Handler-side fallback: HEAD the expected export URL and POST videoReady
    to the backend if the file is reachable. Logs to stdout so RunPod logs show
    the result. Safe alongside the node's own callback (backend dedupes)."""
    video_url = _expected_export_url(generation_id)
    if video_url is None:
        print("[FALLBACK] S3_PUBLIC_URL_PREFIX unset, skipping fallback videoReady")
        return
    try:
        head = requests.head(video_url, timeout=10)
        if head.status_code != 200:
            print(f"[FALLBACK] HEAD {video_url} -> {head.status_code}, skipping")
            return
    except Exception as e:
        print(f"[FALLBACK] HEAD {video_url} failed: {e}, skipping")
        return
    url = relay.video_ready_url
    secret = relay.callback_secret
    if not url or not secret:
        print("[FALLBACK] backend URL or callback secret missing, skipping")
        return
    try:
        resp = requests.post(
            url,
            json={"generation_id": generation_id, "videoUrl": video_url},
            headers={"Content-Type": "application/json",
                     "X-Callback-Secret": secret},
            timeout=10)
        print(f"[FALLBACK] POST {url} -> {resp.status_code} {resp.text[:500]}")
    except Exception as e:
        print(f"[FALLBACK] POST {url} failed: {e}")


def _surface_node_callback_logs():
    """Print VidiaNode callback log lines from the comfy.log tail to stdout so
    RunPod logs show what the node's videoReady callback actually did."""
    try:
        if not os.path.exists(COMFY_LOG_PATH):
            print("[NODELOG] comfy.log not found, no node callback logs to surface")
            return
        with open(COMFY_LOG_PATH, "r") as f:
            lines = f.readlines()[-200:]
        matched = [ln.rstrip() for ln in lines
                   if any(n in ln for n in _NODE_LOG_NEEDLES)]
        if matched:
            print("[NODELOG] VidiaNode callback log lines from comfy.log tail:")
            for ln in matched:
                print(f"  {ln}")
        else:
            print("[NODELOG] no VidiaNode callback lines found in comfy.log tail")
    except Exception as e:
        print(f"[NODELOG] error surfacing node logs: {e}")


def handler(job):
    """The main function that handles a job."""
    generation_id = None
    try:
        logger.info("Processing Request")
        validated, error_message = validate_input(job.get("input"))
        if error_message:
            print(f"\nValidation error: {error_message}")
            raw = job.get("input")
            if isinstance(raw, dict):
                generation_id = raw.get("generation_id") or raw.get("client_id")
            return {"error": error_message, "generation_id": generation_id, "stage": None}

        generation_id = validated["generation_id"]
        user_id = validated["user_id"]
        params = validated["params"]

        # RunPod appends worker suffixes like "-u1" to the generation_id
        if generation_id and "-u" in generation_id:
            parts = generation_id.split("-u")
            if len(parts) > 1 and parts[1].isdigit():
                generation_id = parts[0]
        logger.once("job_start", f"[JOB] start generation_id={generation_id} user_id={user_id}")

        check_server(
            f"http://{COMFY_HOST}",
            COMFY_API_AVAILABLE_MAX_RETRIES,
            COMFY_API_AVAILABLE_INTERVAL_MS,
        )

        relay = WebSocketProgressRelay(generation_id)

        progress = None
        if ENABLE_WEBSOCKET_PROGRESS:
            progress = ProgressTracker(relay)
            deadline = time.time() + WS_READY_TIMEOUT
            while time.time() < deadline:
                if progress.connect():
                    break
                time.sleep(1)
            else:
                print(f"Warning: WebSocket not ready within {WS_READY_TIMEOUT}s; proceeding without WS gating")
        else:
            print("Websocket progress tracking is disabled")

        stop_hb = threading.Event()

        def _hb_loop():
            while not stop_hb.wait(HEARTBEAT_INTERVAL):
                try:
                    relay.send_progress("heartbeat", {"ts": int(time.time() * 1000),
                                                      "podId": relay.podId})
                except Exception:
                    pass

        threading.Thread(target=_hb_loop, daemon=True).start()

        start_time = time.time()
        try:
            result = runner.run_pipeline(generation_id, user_id, params, relay, progress,
                                         run_type=validated.get("type", "full"))
            summary = {"generation_id": generation_id, "status": "success",
                       "durations": {"total_s": int(time.time() - start_time)},
                       "stages": result.get("stages")}
            print("[SUMMARY]", json.dumps(summary, separators=(",", ":")))
            _fallback_notify_video_ready(generation_id, relay)
            _surface_node_callback_logs()
            return {"output": {"message": result, "status": "success",
                               "refresh_worker": REFRESH_WORKER}}
        except runner.PipelineError as e:
            summary = {"generation_id": generation_id, "status": "error",
                       "durations": {"total_s": int(time.time() - start_time)},
                       "error": str(e), "stage": e.stage}
            print("[SUMMARY]", json.dumps(summary, separators=(",", ":")))
            relay.send_progress("error", {"error": str(e),
                                          "generation_id": generation_id,
                                          "stage": e.stage})
            return {"error": str(e), "generation_id": generation_id, "stage": e.stage}
        finally:
            stop_hb.set()
            if progress:
                try:
                    progress.stop()
                except Exception:
                    pass

    except Exception as e:
        print(f"\nUnexpected error in handler: {e}")
        return {"error": f"Unexpected error: {e}", "generation_id": generation_id,
                "stage": None}


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
