"""Pipeline runner: the per-generation stage loop.

Downloads input files once, then executes the active stages from
manifest.json in order, feeding each stage's output file into the next
stage's [in_prev] slot. Per-stage completion is persisted to disk so a
failed run can resume from the last completed stage.
"""

import json
import os
import random
import time

from comfy_support import (
    COMFY_POLLING_INTERVAL_MS, COMFY_POLLING_MAX_RETRIES,
    LOG_THROTTLE_SECONDS, StageRelay, logger, get_history, queue_workflow,
)
from pipeline import loader

import requests

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
# Manifest file entries are relative to the repo root ("workflows/x.json");
# default resolves pipeline/ -> src/ -> worker/ -> repo root.
WORKFLOWS_BASE = os.environ.get(
    "WORKFLOWS_BASE",
    os.path.dirname(os.path.dirname(os.path.dirname(PIPELINE_DIR))))
WORK_DIR = os.environ.get("VIDIA_WORK_DIR", "/tmp/vidia")
COMFY_OUTPUT_DIR = os.environ.get("COMFY_OUTPUT_DIR", "/ComfyUI/output")
COMFY_LOG_PATH = os.environ.get("COMFY_LOG_PATH", "/tmp/comfy.log")
INACTIVITY_TIMEOUT = int(os.environ.get("COMFY_INACTIVITY_TIMEOUT", 900))
# Hard cap on how long a text-output stage (e.g. prompt_prep) may wait for its
# declared text output files. A stage that fails fast inside ComfyUI without
# emitting an execution_error websocket event would otherwise hang the worker
# forever on "Waiting for text outputs". See _run_stage.
TEXT_STAGE_TIMEOUT = int(os.environ.get("VIDIA_TEXT_STAGE_TIMEOUT", 300))
# "runpod" (R2 upload output stage) or "local" (stock save to ComfyUI output dir)
VIDIA_MODE = os.environ.get("VIDIA_MODE", "runpod")
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "").strip()
OPENROUTER_PLACEHOLDERS = {"", "OPENROUTER_API_KEY", "dummy-key", "change-me"}

# Preview frame caps per method (Prod parity: lifecycle.js frame_load_cap values).
# Full generation leaves the load node untouched (cap = 0).
PREVIEW_FRAME_CAPS = {"evolve": 16, "trace": 8, "forge": 120, "hunyuan": 120}


class PipelineError(Exception):
    def __init__(self, message, stage=None):
        super().__init__(message)
        self.stage = stage


def _config_dir():
    """VIDIA_CONFIG_DIR overrides the baked-in manifest/workflow locations."""
    cfg = os.environ.get("VIDIA_CONFIG_DIR")
    if cfg and os.path.isdir(cfg):
        logger.throttled("config_source", 60, f"[CONFIG] using VIDIA_CONFIG_DIR={cfg}")
        return cfg
    logger.throttled("config_source", 60,
                     f"[CONFIG] using baked-in defaults (manifest={PIPELINE_DIR}, "
                     f"workflows={WORKFLOWS_BASE})")
    return None


def load_manifest():
    base = _config_dir() or PIPELINE_DIR
    with open(os.path.join(base, "manifest.json")) as f:
        return json.load(f)


def active_stages(manifest, params):
    """Resolve the ordered list of (name, workflow_path, final) to run."""
    workflows_base = _config_dir() or WORKFLOWS_BASE
    features = params.get("features", {})
    stages = []
    for stage in manifest["stages"]:
        # Build Mode can disable a stage without removing it from the array.
        if stage.get("enabled") is False:
            continue
        if "select" in stage:
            method = params.get(stage["select"])
            file = stage["files"].get(method)
            if file is None:
                raise PipelineError(f"Unknown {stage['select']}: {method}")
        else:
            if stage.get("feature") and not features.get(stage["feature"]):
                continue
            file = stage["file"]
            if VIDIA_MODE == "local" and stage.get("local_file"):
                file = stage["local_file"]
        stages.append({
            "name": stage["name"],
            "path": os.path.join(workflows_base, file),
            "final": stage.get("final", False),
        })
    return stages


def download_files(files, dest_dir):
    """Download params.files.* once; return slot -> local path."""
    os.makedirs(dest_dir, exist_ok=True)
    paths = {}
    for slot, url in (files or {}).items():
        if not url:
            continue
        ext = os.path.splitext(url.split("?")[0])[1] or ".bin"
        local = os.path.join(dest_dir, f"{slot}{ext}")
        if not os.path.exists(local):
            logger.info(f"Downloading {slot}: {url}")
            r = requests.get(url, stream=True, timeout=120)
            r.raise_for_status()
            with open(local, "wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
        paths[slot] = local
    return paths


def _load_state(state_path):
    try:
        with open(state_path) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {"completed": {}}


def _save_state(state_path, state):
    os.makedirs(os.path.dirname(state_path), exist_ok=True)
    with open(state_path, "w") as f:
        json.dump(state, f)


def _apply_runtime_defaults(params):
    """Fill worker-only defaults that are not exposed as frontend controls."""
    provided_key = str(params.get("openrouter_api_key", "")).strip()
    env_key = OPENROUTER_API_KEY if OPENROUTER_API_KEY not in OPENROUTER_PLACEHOLDERS else ""

    if provided_key in OPENROUTER_PLACEHOLDERS:
        if env_key:
            params["openrouter_api_key"] = env_key
            provided_key = env_key
        else:
            params.pop("openrouter_api_key", None)
            provided_key = ""

    if not provided_key:
        params["use_cloud_llm"] = False
    elif "use_cloud_llm" not in params:
        params["use_cloud_llm"] = True

    params.setdefault("lora_keywords", "")

    # Prod parity: detailer denoise of 0 is clamped to a near-zero floor so the
    # SEGSDetailer still applies a minimal pass rather than skipping entirely.
    if params.get("detailer_denoise") == 0:
        params["detailer_denoise"] = 0.0001


def _output_file_from_history(history, prompt_id, output_node):
    """Resolve the saved file path from a completed prompt's history outputs."""
    outputs = history.get(prompt_id, {}).get("outputs", {})
    node_out = outputs.get(output_node) or (
        outputs[sorted(outputs.keys())[-1]] if outputs else {})
    for key in ("gifs", "images", "video", "files"):
        entries = node_out.get(key)
        if entries:
            entry = entries[0]
            if isinstance(entry, str):
                return entry
            sub = entry.get("subfolder", "")
            return os.path.join(COMFY_OUTPUT_DIR, sub, entry["filename"])
    return None


def _text_outputs_ready(text_outputs):
    """Return (ready, missing_paths) for declared text output files.

    A text-output stage (e.g. prompt_prep) succeeds when every file the loader
    declared in info["text_outputs"] exists and is readable. We do not require
    non-empty content because a legitimately empty enhancement result is still a
    valid stage output; requiring content could stall the pipeline.
    """
    missing = []
    for path in (text_outputs or {}).values():
        if not os.path.exists(path) or not os.access(path, os.R_OK):
            missing.append(path)
    return (not missing, missing)


def _extract_history_error(history, prompt_id):
    """Return a human-readable error string from a ComfyUI history entry, or None.

    ComfyUI /history/{prompt_id} records failures as status.status_str == 'error'
    with status.messages containing ['execution_error', {node_id, node_type,
    exception_message, ...}] entries. An older path used a top-level 'error' key.
    """
    entry = history.get(prompt_id)
    if not entry:
        return None
    if entry.get("error"):
        return f"history error: {entry['error']}"
    status = entry.get("status", {})
    if status.get("status_str") == "error":
        parts = ["status_str=error"]
        for m in status.get("messages", []):
            if isinstance(m, list) and m and m[0] == "execution_error":
                d = m[1] if len(m) > 1 else {}
                parts.append(
                    f"node_id={d.get('node_id')} node_type={d.get('node_type')} "
                    f"exception={d.get('exception_message')}")
        return "; ".join(parts)
    return None


def _history_status_summary(history, prompt_id):
    """One-line summary of the last seen history status, for timeout diagnostics."""
    entry = history.get(prompt_id)
    if not entry:
        return "no history entry"
    status = entry.get("status", {})
    return (f"status_str={status.get('status_str', 'unknown')} "
            f"completed={status.get('completed')}")


def _append_log_tail(message):
    """Append the last ~50 lines of the ComfyUI log to an error message if available.

    ComfyUI stdout/stderr is redirected to /tmp/comfy.log in serverless mode
    (start.sh) and COMFY_LOG_PATH defaults to that path. Including the tail in a
    raised PipelineError makes a silent stage failure diagnosable without SSH.
    """
    try:
        if os.path.exists(COMFY_LOG_PATH):
            with open(COMFY_LOG_PATH, "r") as f:
                lines = f.readlines()
            tail = "".join(lines[-50:])
            if tail.strip():
                return (f"{message}\n--- ComfyUI log tail "
                        f"({COMFY_LOG_PATH}) ---\n{tail}")
    except Exception:
        pass
    return message


def _neutralize_cloud_branch(graph):
    """Make eager ImpactConditionalBranch evaluation harmless when cond is False.

    Impact Pack's ImpactConditionalBranch is documented as lazy, but if the
    installed version evaluates both branches eagerly the unselected (tt_value)
    subtree still executes. For the prompt_prep cloud-LLM branch this means
    AV_LLMChat (node 21) runs with a placeholder OPENROUTER_API_KEY and errors
    immediately, surfacing as a silent stage failure. When cond was injected False
    we point tt_value at the same source as ff_value so both branches resolve to
    the selected (local) path and the unselected subtree becomes a no-op duplicate.

    Scope chosen: GENERIC. Any ImpactConditionalBranch whose cond widget is False
    after param injection gets tt_value = ff_value. No hardcoded node ids; the
    loader's {use_cloud_llm} (and sibling cond-toggle) title tags drive injection,
    and this function only acts on the resulting cond value.
    """
    for node in graph.values():
        if node.get("class_type") != "ImpactConditionalBranch":
            continue
        inputs = node.get("inputs", {})
        if inputs.get("cond") is False:
            inputs["tt_value"] = inputs.get("ff_value")
    return graph


def _run_stage(graph, info, progress, stage_relay, log_state):
    """Queue one stage graph and wait for completion. Returns prompt_id history.

    Stage-aware completion:
      * text-output stages succeed when all declared info["text_outputs"] files
        exist and are readable (Comfy history outputs are not required).
      * normal [out] stages succeed on prompt-specific websocket completion
        (executing null-node / executed for this prompt_id) and require the
        declared output node's entry in Comfy history.
    Queue-empty alone never marks a prompt complete.
    """
    text_outputs = info.get("text_outputs") or {}
    is_text_stage = bool(text_outputs)

    queued = queue_workflow(graph)
    prompt_id = queued["prompt_id"]
    logger.info(f"Queued stage workflow with ID {prompt_id}")
    if progress:
        progress.reset_for_stage(stage_relay)

    retries = 0
    start_time = time.time()
    last_history_poll = 0.0
    last_history_status = "no history yet"
    while retries < COMFY_POLLING_MAX_RETRIES:
        if progress:
            progress.process_all_messages()

        # Forward ComfyUI terminal logs every 5 seconds
        now = time.time()
        if now - log_state["last_check"] > 5:
            try:
                if os.path.exists(COMFY_LOG_PATH):
                    with open(COMFY_LOG_PATH, "r") as f:
                        f.seek(log_state["position"])
                        new_content = f.read()
                        log_state["position"] = f.tell()
                        if new_content.strip():
                            stage_relay.send_terminal_logs(new_content, log_state["user_id"])
            except Exception as e:
                print(f"Error forwarding terminal logs: {e}")
            log_state["last_check"] = now

        if progress and (time.time() - progress.last_activity_time > INACTIVITY_TIMEOUT):
            msg = f"Generation stalled. No activity for over {INACTIVITY_TIMEOUT // 60} minutes."
            progress.log_progress(msg, level="ERROR")
            stage_relay.send_progress("error", {"type": "timeout_error", "message": msg})
            raise PipelineError(msg)

        # Explicit websocket execution_error for this prompt -> fail fast.
        if progress and progress.failed_prompt(prompt_id):
            err = progress.prompt_errors.get(prompt_id, {})
            msg = f"Execution error for prompt {prompt_id}: {json.dumps(err)}"
            progress.log_progress(msg, level="ERROR")
            raise PipelineError(msg)

        if is_text_stage:
            ready, missing = _text_outputs_ready(text_outputs)
            if ready:
                logger.info(f"Text outputs ready for prompt {prompt_id}: "
                            f"{list(text_outputs)}")
                try:
                    history = get_history(prompt_id)
                except Exception:
                    history = {}
                if prompt_id in history and history[prompt_id].get("error"):
                    raise PipelineError(f"Execution error: {history[prompt_id]['error']}")
                return prompt_id, history
            # Poll /history for an explicit ComfyUI error every ~5s, regardless
            # of whether the websocket is connected. A stage can fail fast (e.g.
            # a missing model or an eager-evaluated false branch) without ever
            # emitting an execution_error WS event, so the file-existence wait
            # alone would hang forever. This surfaces the failing node
            # id/type/exception so the worker fails fast instead of hanging.
            now = time.time()
            if now - last_history_poll >= 5:
                last_history_poll = now
                try:
                    history = get_history(prompt_id)
                    last_history_status = _history_status_summary(history, prompt_id)
                    err = _extract_history_error(history, prompt_id)
                    if err:
                        raise PipelineError(_append_log_tail(
                            f"ComfyUI stage error for prompt {prompt_id}: {err}"))
                except PipelineError:
                    raise
                except Exception:
                    pass
            # Overall text-stage timeout: never wait longer than this for text
            # outputs that may never be produced.
            if time.time() - start_time > TEXT_STAGE_TIMEOUT:
                raise PipelineError(_append_log_tail(
                    f"text outputs never produced after {TEXT_STAGE_TIMEOUT}s; "
                    f"last history status: {last_history_status}"))
            logger.throttled("text_wait", LOG_THROTTLE_SECONDS,
                             f"Waiting for text outputs, missing: {missing}")
        else:
            if progress and progress.is_workflow_complete(prompt_id):
                try:
                    history = get_history(prompt_id)
                except Exception:
                    time.sleep(1)
                    retries += 1
                    continue
                if prompt_id in history and history[prompt_id].get("error"):
                    raise PipelineError(f"Execution error: {history[prompt_id]['error']}")
                if prompt_id in history and history[prompt_id].get("outputs"):
                    return prompt_id, history
                logger.throttled("complete_no_outputs", LOG_THROTTLE_SECONDS,
                                 f"Prompt {prompt_id} marked complete but history has no outputs")
                time.sleep(1)
                retries += 1
                continue

            # No-progress path (WS disabled): poll history directly.
            if not progress:
                try:
                    history = get_history(prompt_id)
                    if prompt_id not in history:
                        logger.throttled("history_missing", LOG_THROTTLE_SECONDS,
                                         f"History missing prompt_id {prompt_id}")
                    elif history[prompt_id].get("error"):
                        raise PipelineError(f"Execution error: {history[prompt_id]['error']}")
                    elif history[prompt_id].get("outputs"):
                        return prompt_id, history
                except PipelineError:
                    raise
                except Exception:
                    pass

        time.sleep(COMFY_POLLING_INTERVAL_MS / 1000)
        retries += 1
        logger.throttled("wait", LOG_THROTTLE_SECONDS,
                         f"Still waiting... (attempt {retries}) elapsed={int(time.time() - start_time)}s")

    raise PipelineError("Max retries reached while waiting for stage completion")


def run_pipeline(generation_id, user_id, params, relay, progress, run_type="full"):
    """Execute all active stages for one generation. Returns result dict."""
    _apply_runtime_defaults(params)
    manifest = load_manifest()
    stages = active_stages(manifest, params)
    total = len(stages)
    gen_dir = os.path.join(WORK_DIR, generation_id)
    state_path = os.path.join(gen_dir, "state.json")
    text_dir = os.path.join(gen_dir, "text")
    os.makedirs(text_dir, exist_ok=True)

    # Resolve the seed ONCE per run; every stage's {seed} tag gets the same value.
    seed = params.get("seed")
    if seed is None or seed == -1:
        seed = random.randint(0, 2**63 - 1)
        logger.info(f"[SEED] resolved random seed {seed} for generation_id={generation_id}")
    params["seed"] = seed

    file_paths = download_files(params.get("files"), os.path.join(gen_dir, "inputs"))
    state = _load_state(state_path)
    # The original source video is the initial "previous output": prompt_prep is
    # text-only (no video), so the first video stage's [in_prev] must resolve to
    # the user's uploaded source video (files.in_video).
    prev_output = file_paths.get("in_video")

    # Preview frame cap (Prod parity): cap the initial source video load only.
    # frame_cap is passed to load_stage solely while prev_output is still the
    # original source video; once a video stage runs, prev_output becomes the
    # re-encoded intermediate and the cap no longer applies. Full runs = 0.
    frame_cap = 0
    if run_type == "preview":
        frame_cap = PREVIEW_FRAME_CAPS.get(params.get("method"), 0)
        if frame_cap:
            logger.info(f"[PREVIEW] frame_cap={frame_cap} for method={params.get('method')}")

    log_state = {"position": 0, "last_check": time.time(), "user_id": user_id}
    if os.path.exists(COMFY_LOG_PATH):
        with open(COMFY_LOG_PATH, "r") as f:
            f.seek(0, os.SEEK_END)
            log_state["position"] = f.tell()

    name = None
    try:
        for index, stage in enumerate(stages):
            name = stage["name"]
            done = state["completed"].get(name)
            if done is not None:
                logger.info(f"[STAGE {index + 1}/{total}] {name} already complete, resuming past it")
                prev_output = done.get("output") or prev_output
                for key, value in (done.get("params") or {}).items():
                    params[key] = value
                continue

            logger.info(f"[STAGE {index + 1}/{total}] {name}: {stage['path']}")
            # Cap only the initial source video load: pass frame_cap while the
            # pending previous output is still the original uploaded source.
            stage_frame_cap = (frame_cap if frame_cap and prev_output == file_paths.get("in_video")
                               else None)
            graph, info = loader.load_stage(
                stage["path"], name, generation_id, params, file_paths,
                prev_output=prev_output, text_output_dir=text_dir,
                final=stage["final"], frame_cap=stage_frame_cap)
            _neutralize_cloud_branch(graph)

            stage_relay = StageRelay(relay, name, index + 1, total)
            stage_relay.send_progress("stage_start", {"status": "started"})
            prompt_id, history = _run_stage(graph, info, progress, stage_relay, log_state)

            stage_record = {"prompt_id": prompt_id, "params": {}}

            if info["text_outputs"]:
                # Text stage: feed saved prompt files into params for downstream {param} injection
                for pname, path in info["text_outputs"].items():
                    try:
                        with open(path) as f:
                            params[pname] = f.read().strip()
                        stage_record["params"][pname] = params[pname]
                        logger.info(f"  [out:{pname}] -> {len(params[pname])} chars")
                    except OSError as e:
                        logger.info(f"  WARNING: could not read [out:{pname}] at {path}: {e}")
                stage_record["output"] = None
            else:
                output_file = _output_file_from_history(history, prompt_id, info["output_node"])
                if output_file is None and not stage["final"]:
                    raise PipelineError(f"Stage {name}: no output file found in history")
                stage_record["output"] = output_file
                if output_file:
                    prev_output = output_file
                logger.info(f"  [out] -> {output_file}")

            state["completed"][name] = stage_record
            _save_state(state_path, state)
            complete_data = {"status": "completed"}
            if index == total - 1:
                complete_data["resolved_seed"] = seed
            stage_relay.send_progress("stage_complete", complete_data)
    except PipelineError as e:
        if e.stage is None:
            e.stage = name
        raise
    except loader.StageLoadError as e:
        raise PipelineError(str(e), stage=name)

    return {"status": "success", "stages": total, "final_output": prev_output,
            "resolved_seed": seed, "state": state["completed"]}
