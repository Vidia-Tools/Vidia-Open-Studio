"""
Cloud upload and backend notification for the Vidia custom ComfyUI node.
Handles S3/R2 upload to Cloudflare and video-ready callback to the backend.
"""

import os
import subprocess
import requests

import folder_paths
from .utils import ffmpeg_path
from .config import (
    S3_CONFIG, S3_PUBLIC_URL_PREFIX, VIDIA_BACKEND_URL,
    RUNPOD_CALLBACK_SECRET, HAS_BOTO3,
)


class _UploadProgressTracker:
    """Tracks byte-level upload progress and logs at 10% intervals."""

    def __init__(self, total_size, logger):
        self.total_size = total_size
        self.bytes_uploaded = 0
        self.last_update = 0
        self.logger = logger

    def __call__(self, bytes_amount):
        self.bytes_uploaded += bytes_amount
        progress = int((self.bytes_uploaded / self.total_size) * 100)
        if progress >= self.last_update + 10 or progress == 100:
            self.last_update = progress
            self.logger.info(f"Uploaded {self.bytes_uploaded} of {self.total_size} bytes ({progress}%)")


def upload_to_cloudflare_s3(format_str, file_path, filename_prefix, logger, state):
    """Upload video to Cloudflare R2 storage using boto3, after stripping metadata.

    Args:
        format_str: The format string (e.g. "video/h264-mp4").
        file_path: Path to the video file on disk.
        filename_prefix: The generation ID used as the S3 key prefix.
        logger: VideoProcessingLogger instance.
        state: VideoProcessingState instance.

    Returns:
        dict with 'success' bool and either 'url'/'key' or 'error'.
    """
    if not HAS_BOTO3:
        logger.error("boto3 not available, cannot upload to S3.")
        return {"success": False, "error": "boto3 is not installed."}

    if not os.path.exists(file_path):
        error = f"Video file not found: {file_path}"
        logger.error(error)
        return {"success": False, "error": error}

    required_keys = ['endpoint_url', 'aws_access_key_id', 'aws_secret_access_key', 'bucket_name']
    if not all(S3_CONFIG.get(key) for key in required_keys):
        error = "S3 configuration incomplete. Check your .env file."
        logger.error(error)
        return {"success": False, "error": error}

    if not S3_PUBLIC_URL_PREFIX:
        error = "S3_PUBLIC_URL_PREFIX not configured. Cannot generate public URL."
        logger.error(error)
        return {"success": False, "error": error}

    _, file_extension = os.path.splitext(file_path)
    temp_dir = folder_paths.get_temp_directory()
    cleaned_video_path = os.path.join(temp_dir, f"{filename_prefix}_cleaned{file_extension}")

    try:
        # Step 1: Strip metadata using ffmpeg
        logger.info(f"Stripping metadata from {file_path}")
        strip_cmd = [
            ffmpeg_path, "-y",
            "-i", file_path,
            "-c", "copy",
            "-map_metadata", "-1",
            cleaned_video_path,
        ]

        result = subprocess.run(strip_cmd, capture_output=True, text=True)
        if result.returncode != 0:
            logger.error(f"Failed to strip metadata. FFmpeg stderr: {result.stderr}")
            return {"success": False, "error": "Metadata stripping failed. Upload aborted."}

        logger.info(f"Metadata stripped successfully: {cleaned_video_path}")

        # Step 2: Upload the cleaned video
        import boto3
        from botocore.client import Config as BotoConfig
        s3_client = boto3.client(
            's3',
            endpoint_url=S3_CONFIG['endpoint_url'],
            aws_access_key_id=S3_CONFIG['aws_access_key_id'],
            aws_secret_access_key=S3_CONFIG['aws_secret_access_key'],
            region_name=S3_CONFIG.get('region_name', 'auto'),
            config=BotoConfig(signature_version='s3v4'),
        )

        s3_key = f"{filename_prefix}{file_extension}"
        file_size = os.path.getsize(cleaned_video_path)
        progress_callback = _UploadProgressTracker(file_size, logger)

        logger.info(f"Starting upload to {S3_CONFIG['endpoint_url']} bucket {S3_CONFIG['bucket_name']}")

        content_type = 'video/mp4' if format_str.startswith('video/') else 'image/' + format_str.split('/')[1]
        s3_client.upload_file(
            cleaned_video_path,
            S3_CONFIG['bucket_name'],
            s3_key,
            Callback=progress_callback,
            ExtraArgs={'ContentType': content_type},
        )

        public_url = f"{S3_PUBLIC_URL_PREFIX.rstrip('/')}/{s3_key}"

        state.upload_attempted = True
        state.upload_successful = True
        logger.info(f"Upload successful: {public_url}")

        # Step 3: Notify backend
        _notify_backend(filename_prefix, public_url, logger)

        return {"success": True, "url": public_url, "key": s3_key}

    except Exception as e:
        error_msg = str(e)
        logger.error(f"Upload process failed: {error_msg}")
        state.upload_attempted = True
        return {"success": False, "error": error_msg}

    finally:
        if os.path.exists(cleaned_video_path):
            try:
                os.remove(cleaned_video_path)
                logger.info(f"Removed temporary cleaned file: {cleaned_video_path}")
            except OSError as e:
                logger.error(f"Error removing temporary file {cleaned_video_path}: {e}")


def _notify_backend(generation_id, video_url, logger):
    """Send video-ready notification to the backend."""
    if not VIDIA_BACKEND_URL:
        logger.warn("VIDIA_BACKEND_URL not set. Skipping backend notification.")
        return

    video_ready_url = f"{VIDIA_BACKEND_URL.rstrip('/')}/api/runpod/videoReady"
    logger.info(f"Notifying backend at: {video_ready_url}")

    try:
        response = requests.post(
            video_ready_url,
            json={'generation_id': generation_id, 'videoUrl': video_url},
            headers={
                'Content-Type': 'application/json',
                'X-Callback-Secret': RUNPOD_CALLBACK_SECRET,
            },
            timeout=10,
        )

        if response.status_code == 200:
            logger.info("Successfully notified backend about video completion")
        else:
            logger.error(f"Backend notification failed: {response.status_code} {response.text}")

    except Exception as e:
        logger.error(f"Failed to notify backend: {str(e)}")
