#!/usr/bin/env python3
"""Non-GPU unit tests for fail-fast error surfacing and cloud-branch neutralization.

Covers ST-DBG-1:
  * a text-output stage raises PipelineError promptly when the progress tracker
    has an execution_error for the queued prompt (instead of hanging on
    "Waiting for text outputs")
  * a text-output stage raises PipelineError when /history reports
    status.status_str == 'error' with an execution_error message (surfaces the
    failing node id/type/exception)
  * a text-output stage raises PipelineError after TEXT_STAGE_TIMEOUT instead of
    waiting forever
  * _neutralize_cloud_branch rewires tt_value=ff_value for any
    ImpactConditionalBranch whose cond is False, and leaves cond=True branches
    unchanged

Run: python3 worker/scripts/test_error_surfacing.py
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


def test_text_stage_raises_on_tracker_execution_error():
    with tempfile.TemporaryDirectory() as d:
        missing = os.path.join(d, "never_written.txt")
        info = {"text_outputs": {"prompt": missing}, "output_node": None,
                "inputs": {}, "params_resolved": [], "params_unresolved": []}
        runner.queue_workflow = lambda graph: {"prompt_id": "p-err2"}
        runner.get_history = lambda pid: {}
        progress = ProgressTracker(None)
        progress.prompt_errors["p-err2"] = {"exception_message": "model missing"}
        try:
            runner._run_stage({}, info, progress, _FakeRelay(), _log_state())
            raise AssertionError("text stage should raise on execution_error")
        except runner.PipelineError as e:
            assert "p-err2" in str(e)
    print("OK: text stage raises PipelineError on tracker execution_error")


def test_text_stage_raises_on_history_error_status():
    with tempfile.TemporaryDirectory() as d:
        missing = os.path.join(d, "never_written.txt")
        info = {"text_outputs": {"prompt": missing}, "output_node": None,
                "inputs": {}, "params_resolved": [], "params_unresolved": []}
        runner.queue_workflow = lambda graph: {"prompt_id": "p-herr"}
        runner.get_history = lambda pid: {
            "p-herr": {"status": {"status_str": "error", "completed": False,
                                 "messages": [["execution_error",
                                               {"node_id": "21",
                                                "node_type": "AV_LLMChat",
                                                "exception_message": "bad key"}]]}}}
        # No progress (WS off) so the /history poll path is exercised directly.
        try:
            runner._run_stage({}, info, None, _FakeRelay(), _log_state())
            raise AssertionError("text stage should raise on history error status")
        except runner.PipelineError as e:
            s = str(e)
            assert "AV_LLMChat" in s or "bad key" in s or "status_str=error" in s
    print("OK: text stage raises PipelineError on /history error status")


def test_text_stage_timeout():
    with tempfile.TemporaryDirectory() as d:
        missing = os.path.join(d, "never_written.txt")
        info = {"text_outputs": {"prompt": missing}, "output_node": None,
                "inputs": {}, "params_resolved": [], "params_unresolved": []}
        runner.queue_workflow = lambda graph: {"prompt_id": "p-to"}
        runner.get_history = lambda pid: {}
        old_to = runner.TEXT_STAGE_TIMEOUT
        runner.TEXT_STAGE_TIMEOUT = 1
        try:
            runner._run_stage({}, info, None, _FakeRelay(), _log_state())
            raise AssertionError("text stage should time out")
        except runner.PipelineError as e:
            assert "never produced" in str(e)
        finally:
            runner.TEXT_STAGE_TIMEOUT = old_to
    print("OK: text stage raises PipelineError on timeout")


def test_neutralize_cloud_branch_cond_false():
    graph = {
        "19": {"class_type": "ImpactConditionalBranch",
               "inputs": {"cond": False,
                          "tt_value": ["21", 0],
                          "ff_value": ["16", 0]},
               "_meta": {"title": "Advanced cloud model Toggle {use_cloud_llm}"}},
        "16": {"class_type": "ImpactConditionalBranch",
               "inputs": {"cond": True,
                          "tt_value": ["18", 0],
                          "ff_value": ["18", 1]},
               "_meta": {"title": "Prompt Enhance Toggle {prompt_enhance_enabled}"}},
    }
    runner._neutralize_cloud_branch(graph)
    # cond False -> tt_value rewired to ff_value
    assert graph["19"]["inputs"]["tt_value"] == ["16", 0]
    # cond True -> unchanged
    assert graph["16"]["inputs"]["tt_value"] == ["18", 0]
    assert graph["16"]["inputs"]["ff_value"] == ["18", 1]
    print("OK: _neutralize_cloud_branch rewires cond=False, leaves cond=True")


def test_normal_stage_raises_on_history_error_status():
    """Normal [out] stage (no text_outputs) must fail fast on a /history
    status_str=error entry instead of hanging on completion-waiting."""
    info = {"text_outputs": {}, "output_node": "9",
            "inputs": {}, "params_resolved": [], "params_unresolved": []}
    runner.queue_workflow = lambda graph: {"prompt_id": "p-nherr"}
    runner.get_history = lambda pid: {
        "p-nherr": {"status": {"status_str": "error", "completed": False,
                               "messages": [["execution_error",
                                             {"node_id": "106",
                                              "node_type": "CheckpointLoaderSimple",
                                              "exception_message": "model not found"}]]}}}
    # No progress (WS off): the 5s /history poll in the normal branch fires
    # immediately (last_history_poll starts at 0) and surfaces the error.
    try:
        runner._run_stage({}, info, None, _FakeRelay(), _log_state())
        raise AssertionError("normal stage should raise on history error status")
    except runner.PipelineError as e:
        s = str(e)
        assert "CheckpointLoaderSimple" in s or "model not found" in s or "status_str=error" in s
    print("OK: normal stage raises PipelineError on /history error status")


def test_stall_error_includes_comfy_log_tail():
    """The stall-watchdog error must include the ComfyUI log tail so the
    SUMMARY string shows what ComfyUI was actually doing."""
    with tempfile.TemporaryDirectory() as d:
        log_path = os.path.join(d, "comfy.log")
        with open(log_path, "w") as f:
            f.write("line A\nline B\nSTALL_MARKER_LINE\n")
        old_log = runner.COMFY_LOG_PATH
        old_to = runner.INACTIVITY_TIMEOUT
        runner.COMFY_LOG_PATH = log_path
        runner.INACTIVITY_TIMEOUT = 1
        runner.queue_workflow = lambda graph: {"prompt_id": "p-stall"}
        runner.get_queue = lambda: {"queue_running": [], "queue_pending": []}
        runner.get_history = lambda pid: {}
        progress = ProgressTracker(None)
        progress.last_activity_time = 0  # force immediate stall trigger
        try:
            runner._run_stage({}, {"text_outputs": {}, "output_node": "9",
                                   "inputs": {}, "params_resolved": [],
                                   "params_unresolved": []},
                              progress, _FakeRelay(), _log_state())
            raise AssertionError("stall watchdog should have fired")
        except runner.PipelineError as e:
            s = str(e)
            assert "stalled" in s
            assert "STALL_MARKER_LINE" in s
        finally:
            runner.COMFY_LOG_PATH = old_log
            runner.INACTIVITY_TIMEOUT = old_to
    print("OK: stall watchdog error includes ComfyUI log tail")


class _FakeWS:
    def __init__(self, msg):
        self._msg = msg

    def recv(self):
        return self._msg


def test_ws_binary_message_counts_as_activity():
    """A binary WS frame (preview data) must reset the stall timer so a
    slow-but-alive job is not killed as 'stalled'."""
    tracker = ProgressTracker(None)
    tracker.ws = _FakeWS(b"\x89\x00\x01\x02binary-preview-frame")
    tracker.last_activity_time = 0
    tracker.monitor_progress()
    assert tracker.last_activity_time > 0, "binary WS message did not reset stall timer"
    print("OK: binary WS message resets stall timer")


def test_expected_export_url_construction_and_skip():
    """_expected_export_url builds the URL from S3_PUBLIC_URL_PREFIX + gen id,
    and returns None (skip) when the prefix is unset."""
    import types
    sys.modules.setdefault("runpod", types.ModuleType("runpod"))
    sys.modules["runpod"].serverless = types.SimpleNamespace(start=lambda c: None)
    from rp_handler import _expected_export_url

    old = os.environ.pop("S3_PUBLIC_URL_PREFIX", None)
    try:
        assert _expected_export_url("gen-123") is None, \
            "must return None when S3_PUBLIC_URL_PREFIX unset"
    finally:
        if old is not None:
            os.environ["S3_PUBLIC_URL_PREFIX"] = old

    os.environ["S3_PUBLIC_URL_PREFIX"] = "https://exports.vidia.tools"
    try:
        url = _expected_export_url("gen-456")
        assert url == "https://exports.vidia.tools/gen-456.mp4", f"got {url}"
    finally:
        os.environ.pop("S3_PUBLIC_URL_PREFIX", None)

    os.environ["S3_PUBLIC_URL_PREFIX"] = "https://exports.vidia.tools/"
    try:
        url = _expected_export_url("gen-789")
        assert url == "https://exports.vidia.tools/gen-789.mp4", \
            f"trailing slash must be stripped, got {url}"
    finally:
        os.environ.pop("S3_PUBLIC_URL_PREFIX", None)
    print("OK: _expected_export_url constructs URL, strips trailing slash, skips when unset")


def test_fallback_skips_when_prefix_unset():
    """_fallback_notify_video_ready must not attempt any network call when
    S3_PUBLIC_URL_PREFIX is unset."""
    import types
    sys.modules.setdefault("runpod", types.ModuleType("runpod"))
    sys.modules["runpod"].serverless = types.SimpleNamespace(start=lambda c: None)
    import rp_handler
    from rp_handler import _fallback_notify_video_ready

    class _Relay:
        video_ready_url = "https://backend.test/api/runpod/videoReady"
        callback_secret = "secret"

    called = {"head": False, "post": False}
    rp_handler.requests.head = lambda *a, **k: called.__setitem__("head", True) or \
        types.SimpleNamespace(status_code=200)
    rp_handler.requests.post = lambda *a, **k: called.__setitem__("post", True) or \
        types.SimpleNamespace(status_code=200, text="ok")
    old = os.environ.pop("S3_PUBLIC_URL_PREFIX", None)
    try:
        _fallback_notify_video_ready("gen-skip", _Relay())
        assert called["head"] is False, "must not HEAD when prefix unset"
        assert called["post"] is False, "must not POST when prefix unset"
    finally:
        import requests as _real_requests
        rp_handler.requests = _real_requests
        if old is not None:
            os.environ["S3_PUBLIC_URL_PREFIX"] = old
    print("OK: _fallback_notify_video_ready skips all network when prefix unset")


def main():
    test_text_stage_raises_on_tracker_execution_error()
    test_text_stage_raises_on_history_error_status()
    test_text_stage_timeout()
    test_neutralize_cloud_branch_cond_false()
    test_normal_stage_raises_on_history_error_status()
    test_stall_error_includes_comfy_log_tail()
    test_ws_binary_message_counts_as_activity()
    test_expected_export_url_construction_and_skip()
    test_fallback_skips_when_prefix_unset()
    print("\nAll error-surfacing unit tests passed.")


if __name__ == "__main__":
    main()
