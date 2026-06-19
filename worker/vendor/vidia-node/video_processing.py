"""
Video frame processing for the Vidia custom ComfyUI node.
Handles frame preparation, watermark overlays, dimension alignment,
frame resampling, ffmpeg process management, and format loading.
"""

import os
import sys
import json
import subprocess
import time
import uuid
import numpy as np
import torch
import torch.nn.functional as F
from string import Template

import folder_paths
from .utils import ffmpeg_path, tensor_to_bytes, logger


# ---------------------------------------------------------------------------
# Video format helpers
# ---------------------------------------------------------------------------
# Register our custom format path with ComfyUI
folder_paths.folder_names_and_paths["VIDIA_video_formats"] = (
    [os.path.join(os.path.dirname(os.path.abspath(__file__)), "video_formats")],
    [".json"],
)


def gen_format_widgets(video_format):
    """Generate format widgets from a video format dict."""
    for k in video_format:
        if k.endswith("_pass"):
            for i in range(len(video_format[k])):
                if isinstance(video_format[k][i], list):
                    item = [video_format[k][i]]
                    yield item
                    video_format[k][i] = item[0]
        else:
            if isinstance(video_format[k], list):
                item = [video_format[k]]
                yield item
                video_format[k] = item[0]


def get_video_formats():
    """Get available video formats for the node's format dropdown."""
    formats = []
    for format_name in folder_paths.get_filename_list("VIDIA_video_formats"):
        format_name = format_name[:-5]  # strip .json
        video_format_path = folder_paths.get_full_path("VIDIA_video_formats", format_name + ".json")
        with open(video_format_path, 'r') as stream:
            video_format = json.load(stream)
        widgets = [w[0] for w in gen_format_widgets(video_format)]
        if len(widgets) > 0:
            formats.append(["video/" + format_name, widgets])
        else:
            formats.append("video/" + format_name)
    return formats


def apply_format_widgets(format_name, kwargs):
    """Apply user-provided widget values to a video format dict."""
    video_format_path = folder_paths.get_full_path("VIDIA_video_formats", format_name + ".json")
    with open(video_format_path, 'r') as stream:
        video_format = json.load(stream)
    for w in gen_format_widgets(video_format):
        if w[0][0] not in kwargs:
            if len(w[0]) > 2 and 'default' in w[0][2]:
                default = w[0][2]['default']
            else:
                if type(w[0][1]) is list:
                    default = w[0][1][0]
                else:
                    default = {"BOOLEAN": False, "INT": 0, "FLOAT": 0, "STRING": ""}[w[0][1]]
            kwargs[w[0][0]] = default
            logger.warn(f"Missing input for {w[0][0]} has been set to {default}")
        if len(w[0]) > 3:
            w[0] = Template(w[0][3]).substitute(val=kwargs[w[0][0]])
        else:
            w[0] = str(kwargs[w[0][0]])
    return video_format


# ---------------------------------------------------------------------------
# ffmpeg process (generator-based frame piping)
# ---------------------------------------------------------------------------
def ffmpeg_process(args, video_format, video_metadata, file_path, env, custom_logger=None):
    """Run an ffmpeg encode process via a generator that accepts raw frame data.

    Usage:
        proc = ffmpeg_process(args, fmt, meta, path, env)
        next(proc)               # advance to first yield
        for frame in frames:
            proc.send(frame_bytes)
        total = proc.send(None)  # finalize
    """
    log = custom_logger or logger
    res = None
    frame_data = yield
    total_frames_output = 0

    if video_format.get('save_metadata', 'False') != 'False':
        os.makedirs(folder_paths.get_temp_directory(), exist_ok=True)
        metadata = json.dumps(video_metadata)
        metadata_path = os.path.join(folder_paths.get_temp_directory(), "metadata.txt")
        metadata = metadata.replace("\\", "\\\\")
        metadata = metadata.replace(";", "\\;")
        metadata = metadata.replace("#", "\\#")
        metadata = metadata.replace("=", "\\=")
        metadata = metadata.replace("\n", "\\\n")
        metadata = "comment=" + metadata

        with open(metadata_path, "w") as f:
            f.write(";FFMETADATA1\n")
            f.write(metadata)

        m_args = args[:1] + ["-i", metadata_path] + args[1:] + ["-metadata", "creation_time=now"]
        with subprocess.Popen(m_args + [file_path], stderr=subprocess.PIPE,
                              stdin=subprocess.PIPE, env=env) as proc:
            try:
                while frame_data is not None:
                    proc.stdin.write(frame_data)
                    frame_data = yield
                    total_frames_output += 1
                proc.stdin.flush()
                proc.stdin.close()
                res = proc.stderr.read()
            except BrokenPipeError:
                err = proc.stderr.read()
                log.error(f"FFMPEG BROKEN PIPE (metadata pass). STDERR: {err.decode('utf-8', errors='ignore')}")
                if os.path.exists(file_path):
                    raise Exception("ffmpeg subprocess error:\n" + err.decode('utf-8'))
                print(err.decode('utf-8'), end="", file=sys.stderr)
                log.warn("Error occurred when saving with metadata")

    if res != b'':
        with subprocess.Popen(args + [file_path], stderr=subprocess.PIPE,
                              stdin=subprocess.PIPE, env=env) as proc:
            try:
                while frame_data is not None:
                    proc.stdin.write(frame_data)
                    frame_data = yield
                    total_frames_output += 1
                proc.stdin.flush()
                proc.stdin.close()
                res = proc.stderr.read()
            except BrokenPipeError:
                res = proc.stderr.read()
                log.error(f"FFMPEG BROKEN PIPE (main pass). STDERR: {res.decode('utf-8', errors='ignore')}")
                raise Exception("ffmpeg subprocess error:\n" + res.decode('utf-8'))

    if res is not None and len(res) > 0:
        log.warn(f"FFMPEG STDERR: {res.decode('utf-8', errors='ignore')}")

    yield total_frames_output


# ---------------------------------------------------------------------------
# Frame resampling
# ---------------------------------------------------------------------------
def resample_frames_ffmpeg(frames, source_fps, target_fps, log):
    """Resample frames from source_fps to target_fps using ffmpeg."""
    if not frames or source_fps <= 0 or target_fps <= 0 or source_fps == target_fps:
        return frames

    log.info(f"Resampling frames from {source_fps} to {target_fps} using ffmpeg.")

    temp_dir = folder_paths.get_temp_directory()
    uid = uuid.uuid4().hex[:8]
    temp_input_path = os.path.join(temp_dir, f"temp_resample_in_{uid}.mkv")

    h, w, c = frames[0].shape
    pix_fmt_in = 'rgba' if c == 4 else 'rgb24'

    encode_cmd = [
        ffmpeg_path, '-y', '-f', 'rawvideo',
        '-s', f'{w}x{h}', '-pix_fmt', pix_fmt_in, '-r', str(source_fps),
        '-i', '-', '-an', '-vcodec', 'ffv1', temp_input_path
    ]

    input_bytes = b''.join([tensor_to_bytes(frame).tobytes() for frame in frames])
    proc_encode = subprocess.Popen(encode_cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    _, stderr = proc_encode.communicate(input=input_bytes)

    if proc_encode.returncode != 0:
        log.error(f"ffmpeg encode failed: {stderr.decode('utf-8', errors='ignore')}")
        if os.path.exists(temp_input_path):
            os.unlink(temp_input_path)
        raise Exception("ffmpeg frame resampling (encode step) failed.")

    pix_fmt_out = 'rgb24'
    decode_cmd = [
        ffmpeg_path, '-i', temp_input_path, '-vf', f'fps={target_fps}',
        '-f', 'rawvideo', '-pix_fmt', pix_fmt_out, '-'
    ]

    proc_decode = subprocess.Popen(decode_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    output_frames = []
    while True:
        frame_bytes = proc_decode.stdout.read(w * h * 3)
        if not frame_bytes:
            break
        frame = np.frombuffer(frame_bytes, dtype=np.uint8).reshape((h, w, 3))
        output_frames.append(torch.from_numpy(frame).float() / 255.0)

    _, stderr = proc_decode.communicate()
    if proc_decode.returncode != 0:
        log.error(f"ffmpeg decode failed: {stderr.decode('utf-8', errors='ignore')}")

    if os.path.exists(temp_input_path):
        os.unlink(temp_input_path)

    log.info(f"Resampling complete. Original: {len(frames)} frames, Resampled: {len(output_frames)} frames.")
    return output_frames


# ---------------------------------------------------------------------------
# Watermark processing
# ---------------------------------------------------------------------------
def process_watermark_frames(watermark_frames, main_shape):
    """Process watermark frames to match main video dimensions (for append watermark)."""
    if isinstance(watermark_frames, torch.Tensor):
        if watermark_frames.ndim == 4:
            watermark_frames = [watermark_frames[i] for i in range(watermark_frames.size(0))]
        elif watermark_frames.ndim == 3:
            watermark_frames = [watermark_frames]
        else:
            print(f"[process_watermark_frames] ERROR: Unexpected tensor dimension: {watermark_frames.ndim}")
            return []

    if not watermark_frames:
        return []

    h, w = main_shape[:2]
    wm_h, wm_w = watermark_frames[0].shape[0], watermark_frames[0].shape[1]
    black_bg = torch.zeros((h, w, main_shape[2]), dtype=torch.float32)

    if h >= wm_h and w >= wm_w:
        x_offset = (w - wm_w) // 2
        y_offset = (h - wm_h) // 2
        for i, frame in enumerate(watermark_frames):
            new_bg = black_bg.clone()
            new_bg[y_offset:y_offset + wm_h, x_offset:x_offset + wm_w] = frame
            watermark_frames[i] = new_bg
    else:
        scale_h = h / wm_h
        scale_w = w / wm_w
        scale = min(scale_h, scale_w)
        new_h = int(wm_h * scale)
        new_w = int(wm_w * scale)
        new_size = (new_h, new_w)

        watermark_tensor = torch.stack(watermark_frames)
        resized = F.interpolate(watermark_tensor.permute(0, 3, 1, 2), size=new_size)
        resized_frames = list(resized.permute(0, 2, 3, 1))

        x_offset = (w - new_w) // 2
        y_offset = (h - new_h) // 2
        for i, frame in enumerate(resized_frames):
            new_bg = black_bg.clone()
            new_bg[y_offset:y_offset + new_h, x_offset:x_offset + new_w] = frame
            watermark_frames[i] = new_bg

    return watermark_frames


def process_corner_watermark(watermark_frames, mask_frames, main_shape, opacity=0.4, logger=None):
    """Process corner watermark with mask for transparency."""
    import logging as _logging
    log = logger or _logging.getLogger("VidiaNode")

    if isinstance(watermark_frames, torch.Tensor) and watermark_frames.ndim == 4:
        watermark_frames = [frame for frame in watermark_frames]
    elif isinstance(watermark_frames, torch.Tensor) and watermark_frames.ndim == 3:
        watermark_frames = [watermark_frames]

    if isinstance(mask_frames, torch.Tensor) and mask_frames.ndim == 3:
        mask_frames = [mask for mask in mask_frames]
    elif isinstance(mask_frames, torch.Tensor) and mask_frames.ndim == 2:
        mask_frames = [mask_frames]

    if not watermark_frames or watermark_frames[0].numel() == 0 or watermark_frames[0].shape[0] == 0 or watermark_frames[0].shape[1] == 0:
        log.warn("Corner watermark input is empty. Skipping.")
        return [], [], (0, 0)

    if not mask_frames or mask_frames[0].numel() == 0 or mask_frames[0].shape[0] == 0 or mask_frames[0].shape[1] == 0:
        log.warn("Corner watermark mask is empty. Skipping.")
        return [], [], (0, 0)

    h, w = main_shape[:2]
    watermark_h, watermark_w = watermark_frames[0].shape[:2]

    if watermark_h == 0 or watermark_w == 0:
        log.warn(f"Corner watermark has zero dimensions ({watermark_h}x{watermark_w}). Skipping.")
        return [], [], (0, 0)

    target_width = int(w * 0.2)
    if target_width == 0:
        log.warn(f"Main video width too small ({w}) for corner watermark. Skipping.")
        return [], [], (0, 0)

    scale = target_width / watermark_w
    new_h = int(watermark_h * scale)
    new_w = target_width

    if new_h == 0 or new_w == 0:
        log.warn(f"Calculated corner watermark size invalid ({new_h}x{new_w}). Skipping.")
        return [], [], (0, 0)

    new_size = (new_h, new_w)
    x_offset = w - new_size[1] - 20
    y_offset = h - new_size[0] - 20

    try:
        watermark_tensor = torch.stack(watermark_frames)
        mask_tensor = torch.stack(mask_frames)

        resized_watermark = F.interpolate(watermark_tensor.permute(0, 3, 1, 2), size=new_size)
        resized_mask = F.interpolate(mask_tensor.unsqueeze(1), size=new_size).squeeze(1)

        processed_watermark = list(resized_watermark.permute(0, 2, 3, 1))
        processed_mask = list(resized_mask)

        return processed_watermark, processed_mask, (x_offset, y_offset)
    except Exception as e:
        log.error(f"Error processing corner watermark: {e}")
        return [], [], (0, 0)


# ---------------------------------------------------------------------------
# Path management
# ---------------------------------------------------------------------------
class VideoPathManager:
    """Manages all file paths for video processing to prevent overwrites."""

    def __init__(self, filename_prefix, output_dir, save_output=True):
        self.filename_prefix = filename_prefix

        if not filename_prefix or filename_prefix.strip() == "":
            self.filename_prefix = f"vidia_{uuid.uuid4().hex[:8]}"
            print(f"[VideoPathManager] WARNING: Empty filename_prefix, using: {self.filename_prefix}")

        self.output_dir = output_dir if save_output else folder_paths.get_temp_directory()
        self.full_output_folder, _, _, self.subfolder, _ = folder_paths.get_save_image_path(
            self.filename_prefix, self.output_dir
        )
        self.output_files = []

    def get_first_frame_path(self):
        return os.path.join(self.full_output_folder, f"{self.filename_prefix}_00001.png")

    def get_animation_path(self, format_ext):
        return os.path.join(self.full_output_folder, f"{self.filename_prefix}.{format_ext}")

    def get_video_path(self, extension):
        return os.path.join(self.full_output_folder, f"{self.filename_prefix}.{extension}")

    def get_temp_video_path(self, extension):
        uid = uuid.uuid4().hex[:8]
        return os.path.join(folder_paths.get_temp_directory(), f"temp_{self.filename_prefix}_{uid}.{extension}")

    def add_output_file(self, path):
        self.output_files.append(path)
        return path

    def get_output_files(self):
        return self.output_files


# ---------------------------------------------------------------------------
# Processing state tracker
# ---------------------------------------------------------------------------
class VideoProcessingState:
    """Tracks the state of video processing."""

    def __init__(self):
        self.total_frames = 0
        self.processed_frames = 0
        self.has_corner_watermark = False
        self.has_append_watermark = False
        self.has_audio = False
        self.audio_processed = False
        self.saved_first_frame = False
        self.video_created = False
        self.upload_attempted = False
        self.upload_successful = False
        self.errors = []

    def add_error(self, error_msg):
        self.errors.append(error_msg)

    def has_errors(self):
        return len(self.errors) > 0
