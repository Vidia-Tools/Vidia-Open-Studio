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


def main():
    test_text_stage_raises_on_tracker_execution_error()
    test_text_stage_raises_on_history_error_status()
    test_text_stage_timeout()
    test_neutralize_cloud_branch_cond_false()
    print("\nAll error-surfacing unit tests passed.")


if __name__ == "__main__":
    main()
