#!/usr/bin/env python3
"""Non-GPU unit test for the modular stage-completion logic in runner.py.

Covers the bug where prompt_prep (a text-output stage) stalled after queue
empty: ProgressTracker.is_workflow_complete used to treat queue-empty for 3s as
success, and _run_stage required Comfy history outputs for every stage. Now:

  * queue-empty alone never marks a prompt complete
  * text-output stages succeed when their declared info["text_outputs"] files
    exist and are readable (history outputs not required)
  * normal [out] stages still require prompt-specific completion + history
  * websocket execution_error for the tracked prompt raises PipelineError

Run: python3 worker/scripts/test_stage_completion.py
No GPU, no ComfyUI, no network required.
"""

import os
import sys
import tempfile

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src")
sys.path.insert(0, SRC)

os.environ.setdefault("ENABLE_WEBSOCKET_PROGRESS", "false")
os.environ.setdefault("VIDIA_MODE", "local")
os.environ.setdefault("COMFY_POLLING_INTERVAL_MS", "10")
os.environ.setdefault("COMFY_POLLING_MAX_RETRIES", "200")

from comfy_support import ProgressTracker  # noqa: E402
from pipeline import runner  # noqa: E402


class _FakeRelay:
    podId = "test"

    def send_progress(self, *a, **k):
        return True

    def send_terminal_logs(self, *a, **k):
        return True

    def notify_video_ready(self, *a, **k):
        return True


def _log_state():
    return {"position": 0, "last_check": 0, "user_id": "u"}


def test_queue_empty_does_not_complete():
    p = ProgressTracker(None)
    p.queue_empty_time = 0  # arbitrarily old
    assert p.is_workflow_complete("any") is False, \
        "queue-empty alone must not mark a prompt complete"
    assert p.is_workflow_complete("any") is False, \
        "repeated queue-empty must still not complete"
    print("OK: queue-empty alone does not mark complete")


def test_text_outputs_ready_helper():
    with tempfile.TemporaryDirectory() as d:
        present = os.path.join(d, "present.txt")
        missing = os.path.join(d, "missing.txt")
        open(present, "w").write("data")
        ready, miss = runner._text_outputs_ready({"a": present, "b": missing})
        assert ready is False
        assert missing in miss
        ready2, miss2 = runner._text_outputs_ready({"a": present})
        assert ready2 is True and miss2 == []
    print("OK: _text_outputs_ready reports missing files")


def test_text_stage_completes_on_file_not_history():
    with tempfile.TemporaryDirectory() as d:
        text_file = os.path.join(d, "gen_prompt_prep_prompt.txt")
        open(text_file, "w").write("enhanced prompt body")
        info = {"text_outputs": {"prompt": text_file}, "output_node": None,
                "inputs": {}, "params_resolved": [], "params_unresolved": []}

        runner.queue_workflow = lambda graph: {"prompt_id": "p-text"}
        runner.get_history = lambda pid: {}  # no outputs, no error

        pid, history = runner._run_stage({}, info, None, _FakeRelay(), _log_state())
        assert pid == "p-text"
        assert history == {}
    print("OK: text stage completes on file existence, not history outputs")


def test_normal_stage_requires_prompt_specific_completion():
    info = {"text_outputs": {}, "output_node": "1", "inputs": {},
            "params_resolved": [], "params_unresolved": []}
    runner.queue_workflow = lambda graph: {"prompt_id": "p-out"}
    runner.get_history = lambda pid: {
        "p-out": {"outputs": {"1": {"gifs": [{"filename": "x.mp4"}]}}}}

    progress = ProgressTracker(None)
    # Without a prompt-specific completion signal, _run_stage must NOT return
    # just because the history already has outputs (it waits for the WS event).
    # Use a tiny retry budget so it fails fast instead of hanging.
    runner.COMFY_POLLING_MAX_RETRIES = 3
    try:
        runner._run_stage({}, info, progress, _FakeRelay(), _log_state())
        raise AssertionError("should not complete without prompt-specific signal")
    except runner.PipelineError as e:
        assert "Max retries" in str(e)
    finally:
        runner.COMFY_POLLING_MAX_RETRIES = 200

    # Now mark the prompt complete via the real signal (null-node/executed).
    progress.completed_prompts.add("p-out")
    pid, history = runner._run_stage({}, info, progress, _FakeRelay(), _log_state())
    assert pid == "p-out"
    assert "p-out" in history
    print("OK: normal stage completes only on prompt-specific signal + history")


def test_execution_error_raises():
    info = {"text_outputs": {}, "output_node": "1", "inputs": {},
            "params_resolved": [], "params_unresolved": []}
    runner.queue_workflow = lambda graph: {"prompt_id": "p-err"}
    runner.get_history = lambda pid: {}
    progress = ProgressTracker(None)
    progress.prompt_errors["p-err"] = {"exception_message": "boom"}
    try:
        runner._run_stage({}, info, progress, _FakeRelay(), _log_state())
        raise AssertionError("execution_error should raise PipelineError")
    except runner.PipelineError as e:
        assert "p-err" in str(e)
    print("OK: websocket execution_error raises PipelineError")


def test_runtime_defaults_disable_cloud_llm_without_key():
    params = {"prompt": "hello"}
    old_key = runner.OPENROUTER_API_KEY
    try:
        runner.OPENROUTER_API_KEY = ""
        runner._apply_runtime_defaults(params)
        assert params["use_cloud_llm"] is False
        assert params["lora_keywords"] == ""
        assert "openrouter_api_key" not in params

        params_with_key = {"prompt": "hello"}
        runner.OPENROUTER_API_KEY = "real-key"
        runner._apply_runtime_defaults(params_with_key)
        assert params_with_key["openrouter_api_key"] == "real-key"
        assert params_with_key["use_cloud_llm"] is True

        explicit = {"prompt": "hello", "use_cloud_llm": True, "openrouter_api_key": "OPENROUTER_API_KEY"}
        runner.OPENROUTER_API_KEY = ""
        runner._apply_runtime_defaults(explicit)
        assert explicit["use_cloud_llm"] is False
        assert "openrouter_api_key" not in explicit
    finally:
        runner.OPENROUTER_API_KEY = old_key
    print("OK: runtime defaults disable cloud LLM unless a real key is available")


def test_normal_stage_completes_on_history_success_without_ws():
    """Smoking gun: ComfyUI completes (status success + outputs) but the
    prompt-specific WS completion event (null-node/executed) is never emitted
    for this graph. The 5s /history poll must mark the prompt complete on the
    tracker so the existing output-collection path runs instead of hanging
    until the stall watchdog fires."""
    info = {"text_outputs": {}, "output_node": "1", "inputs": {},
            "params_resolved": [], "params_unresolved": []}
    runner.queue_workflow = lambda graph: {"prompt_id": "p-ok"}
    runner.get_history = lambda pid: {
        "p-ok": {
            "status": {"status_str": "success", "completed": True},
            "outputs": {"1": {"gifs": [{"filename": "x.mp4"}]}},
        }
    }
    progress = ProgressTracker(None)
    # No WS completion signal: completed_prompts stays empty until the history
    # poll marks it complete.
    assert "p-ok" not in progress.completed_prompts
    pid, history = runner._run_stage({}, info, progress, _FakeRelay(), _log_state())
    assert pid == "p-ok"
    assert "p-ok" in history
    assert "p-ok" in progress.completed_prompts, \
        "history success+outputs must mark the prompt complete on the tracker"
    print("OK: normal stage completes on history success without WS event")


def test_node_errors_fail_fast():
    """ComfyUI /prompt validation errors must fail the stage immediately with
    the real node error (e.g. the hunyuan 'sgm_uniform' scheduler rejection)
    instead of running to completion and reporting 'no output file found'."""
    info = {"text_outputs": {}, "output_node": "1", "inputs": {},
            "params_resolved": [], "params_unresolved": []}
    runner.queue_workflow = lambda graph: {
        "prompt_id": "p-x",
        "node_errors": {"1059": {"class_type": "HyVideoSampler", "errors": [
            {"message": "Value not in list",
             "details": "scheduler: 'sgm_uniform' not in [...]"}]}},
    }
    try:
        runner._run_stage({}, info, None, _FakeRelay(), _log_state())
        raise AssertionError("node_errors should raise PipelineError")
    except runner.PipelineError as e:
        assert "HyVideoSampler" in str(e) and "sgm_uniform" in str(e)
    print("OK: queue-time node_errors fail fast with the real cause")


def main():
    test_queue_empty_does_not_complete()
    test_text_outputs_ready_helper()
    test_text_stage_completes_on_file_not_history()
    test_normal_stage_requires_prompt_specific_completion()
    test_normal_stage_completes_on_history_success_without_ws()
    test_execution_error_raises()
    test_node_errors_fail_fast()
    test_runtime_defaults_disable_cloud_llm_without_key()
    print("\nAll stage-completion unit tests passed.")


if __name__ == "__main__":
    main()
