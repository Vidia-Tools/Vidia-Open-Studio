#!/usr/bin/env python
"""RunPod serverless entrypoint: validates the params payload and hands the
generation to the pipeline runner (src/pipeline/runner.py)."""

import json
import threading
import time

import runpod

from comfy_support import (
    COMFY_API_AVAILABLE_INTERVAL_MS, COMFY_API_AVAILABLE_MAX_RETRIES,
    COMFY_HOST, ENABLE_WEBSOCKET_PROGRESS, HEARTBEAT_INTERVAL, REFRESH_WORKER,
    WS_READY_TIMEOUT, ProgressTracker, WebSocketProgressRelay, check_server,
    logger, validate_input,
)
from pipeline import runner


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
