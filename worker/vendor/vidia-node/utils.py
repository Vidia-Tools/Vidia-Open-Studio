"""
Core utilities for the Vidia custom ComfyUI node.
Provides ffmpeg path detection, tensor conversion, and logging.
"""

import os
import sys
import logging
import requests
import torch

from .config import VIDIA_API_ENDPOINT

# ---------------------------------------------------------------------------
# ffmpeg path detection
# ---------------------------------------------------------------------------
ffmpeg_path = "ffmpeg"
_paths_to_try = [
    "ffmpeg",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "ffmpeg", "ffmpeg"),
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "ffmpeg", "bin", "ffmpeg"),
]

for _path in _paths_to_try:
    try:
        if sys.platform == "win32":
            _path += ".exe"
        if os.path.isfile(_path) or os.system(f"which {_path} > /dev/null 2>&1") == 0:
            ffmpeg_path = _path
            break
    except Exception as e:
        print(f"[VidiaNode] Error checking ffmpeg path {_path}: {e}")

if ffmpeg_path == "ffmpeg" and sys.platform == "win32" and not os.system("where ffmpeg > nul 2>&1") == 0:
    ffmpeg_path = None
elif ffmpeg_path == "ffmpeg" and sys.platform != "win32" and os.system("which ffmpeg > /dev/null 2>&1") != 0:
    ffmpeg_path = None

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logger = logging.getLogger("VidiaNode")
logger.setLevel(logging.INFO)
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(name)s - %(levelname)s - %(message)s"))
    logger.addHandler(_handler)


# ---------------------------------------------------------------------------
# Tensor utilities
# ---------------------------------------------------------------------------
def tensor_to_bytes(frame, bits=8):
    """Convert a tensor frame to a numpy byte array.

    Args:
        frame: Tensor of shape [H, W, C] with values in [0, 1].
        bits: 8 for uint8 output, 16 for int16 output.

    Returns:
        numpy ndarray of the frame pixel data.
    """
    if frame.shape[2] == 4:
        # RGBA -- drop alpha, return RGB uint8
        return (frame[:, :, :3] * 255).round().to(torch.uint8).cpu().numpy()

    if bits == 16:
        return (frame * 65535).round().to(torch.int16).cpu().numpy()
    else:
        return (frame * 255).round().to(torch.uint8).cpu().numpy()


# ---------------------------------------------------------------------------
# Video Processing Logger (sends logs to remote server with timeout)
# ---------------------------------------------------------------------------
class VideoProcessingLogger:
    """Enhanced logging for video processing with optional remote log shipping."""

    def __init__(self, node_name):
        self.node_name = node_name
        self.logs = []
        self.send_logs_to_server = True

    def debug(self, msg):
        log_msg = f"[{self.node_name}] DEBUG: {msg}"
        print(log_msg)
        self._ship_log(log_msg, "DEBUG")
        self.logs.append(log_msg)

    def info(self, msg):
        log_msg = f"[{self.node_name}] INFO: {msg}"
        print(log_msg)
        self._ship_log(log_msg, "INFO")
        self.logs.append(log_msg)

    def warn(self, msg):
        log_msg = f"[{self.node_name}] WARNING: {msg}"
        print(log_msg)
        self._ship_log(log_msg, "WARNING")
        self.logs.append(log_msg)

    def error(self, msg):
        log_msg = f"[{self.node_name}] ERROR: {msg}"
        print(log_msg, file=sys.stderr)
        self._ship_log(log_msg, "ERROR")
        self.logs.append(log_msg)

    def get_logs(self):
        return "\n".join(self.logs)

    def _ship_log(self, msg, log_type="INFO"):
        """Send log to remote endpoint with a short timeout to avoid blocking."""
        if not self.send_logs_to_server or not VIDIA_API_ENDPOINT:
            return
        try:
            requests.post(
                f"{VIDIA_API_ENDPOINT.rstrip('/')}/logging/log",
                json={"log": {"message": msg, "context": "VIDIA_NODE_PROCESSING", "type": log_type}},
                timeout=3,
            )
        except Exception:
            # Silently ignore -- logging failures must never block video processing
            pass
