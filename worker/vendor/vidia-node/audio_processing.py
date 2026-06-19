"""
Audio processing for the Vidia custom ComfyUI node.
Handles audio extraction, duration adjustment, concatenation, and muxing.
"""

import os
import subprocess
import uuid
import wave
import numpy as np
import torch

import folder_paths
from .utils import ffmpeg_path


def process_audio(audio, watermark_audio, video_format, frame_rate,
                  user_frames_count=None, watermark_frames_count=None, logger=None):
    """Process and mux audio tracks into the video file.

    Handles user audio and watermark audio segments, adjusting their duration
    to match the corresponding video segments, then concatenates and muxes
    the result into the existing video file.

    Args:
        audio: User audio dict with 'waveform' and 'sample_rate', or None.
        watermark_audio: Watermark audio dict, or None.
        video_format: Video format settings dict.
        frame_rate: Output frame rate.
        user_frames_count: Number of user video frames.
        watermark_frames_count: Number of watermark video frames.
        logger: VideoProcessingLogger instance.

    Returns:
        True on success, False on failure.
    """
    if audio is None and watermark_audio is None and not user_frames_count:
        if logger:
            logger.info("No audio provided and cannot determine user video duration")
        return False

    format_ext = video_format.get("extension", "mp4")
    # We need the path_manager's output files, but we receive the video_path directly
    # This function is called from the node which passes the needed paths
    temp_dir = folder_paths.get_temp_directory()
    uid = uuid.uuid4().hex[:8]
    temp_files = []
    default_sample_rate = 44100

    def get_audio_details(audio_data, name):
        if audio_data is None:
            return None, 0
        try:
            waveform = audio_data["waveform"]
            if len(waveform.shape) == 3:
                waveform = waveform.squeeze(0)
            channels = 1 if len(waveform.shape) == 1 else waveform.shape[0]
            return waveform, channels
        except Exception as e:
            if logger:
                logger.error(f"Invalid {name} audio format: {e}")
            return None, 0

    def save_wav(waveform, path, sample_rate, channels):
        with wave.open(path, "w") as f:
            f.setnchannels(channels)
            f.setsampwidth(2)
            f.setframerate(sample_rate)
            if isinstance(waveform, torch.Tensor):
                waveform = waveform.cpu().numpy()
            if waveform.dtype != np.int16:
                waveform = (waveform * 32767).astype(np.int16)
            if channels > 1:
                waveform = waveform.T
            f.writeframes(waveform.tobytes())
        return path

    try:
        user_waveform, user_channels = get_audio_details(audio, "user")
        wm_waveform, wm_channels = get_audio_details(watermark_audio, "watermark")

        # Standardize to stereo if there's a mismatch
        if user_channels > 0 and wm_channels > 0 and user_channels != wm_channels:
            if logger:
                logger.info(f"Channel mismatch: User ({user_channels}) vs Watermark ({wm_channels}). Upmixing to stereo.")
            if user_channels == 1:
                user_waveform = user_waveform.repeat(2, 1)
                user_channels = 2
            if wm_channels == 1:
                wm_waveform = wm_waveform.repeat(2, 1)
                wm_channels = 2

        final_audio_files = []

        # Process User Audio
        user_video_duration = (user_frames_count or 0) / frame_rate
        if user_waveform is not None:
            raw_user_audio_path = os.path.join(temp_dir, f"user_audio_raw_{uid}.wav")
            temp_files.append(raw_user_audio_path)
            save_wav(user_waveform, raw_user_audio_path, audio["sample_rate"], user_channels)

            adjusted_user_audio_path = os.path.join(temp_dir, f"user_audio_adjusted_{uid}.wav")
            temp_files.append(adjusted_user_audio_path)

            adjust_cmd = [
                ffmpeg_path, "-y", "-i", raw_user_audio_path,
                "-af", f"apad,atrim=0:{user_video_duration}",
                "-t", str(user_video_duration),
                adjusted_user_audio_path,
            ]
            if logger:
                logger.info(f"Adjusting user audio to {user_video_duration:.2f}s")
            subprocess.run(adjust_cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            final_audio_files.append(adjusted_user_audio_path)

        elif user_video_duration > 0:
            user_audio_path = os.path.join(temp_dir, f"silent_user_{uid}.wav")
            temp_files.append(user_audio_path)
            subprocess.run(
                [ffmpeg_path, "-y", "-f", "lavfi", "-i",
                 f"anullsrc=cl=stereo:r={default_sample_rate}",
                 "-t", str(user_video_duration), user_audio_path],
                check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            )
            final_audio_files.append(user_audio_path)

        # Process Watermark Audio
        wm_video_duration = (watermark_frames_count or 0) / frame_rate
        if wm_waveform is not None:
            raw_wm_audio_path = os.path.join(temp_dir, f"wm_audio_raw_{uid}.wav")
            temp_files.append(raw_wm_audio_path)
            save_wav(wm_waveform, raw_wm_audio_path, watermark_audio["sample_rate"], wm_channels)

            adjusted_wm_audio_path = os.path.join(temp_dir, f"wm_audio_adjusted_{uid}.wav")
            temp_files.append(adjusted_wm_audio_path)

            adjust_cmd = [
                ffmpeg_path, "-y", "-i", raw_wm_audio_path,
                "-af", f"apad,atrim=0:{wm_video_duration}",
                "-t", str(wm_video_duration),
                adjusted_wm_audio_path,
            ]
            if logger:
                logger.info(f"Adjusting watermark audio to {wm_video_duration:.2f}s")
            subprocess.run(adjust_cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            final_audio_files.append(adjusted_wm_audio_path)

        elif wm_video_duration > 0:
            wm_audio_path = os.path.join(temp_dir, f"silent_wm_{uid}.wav")
            temp_files.append(wm_audio_path)
            subprocess.run(
                [ffmpeg_path, "-y", "-f", "lavfi", "-i",
                 f"anullsrc=cl=stereo:r={default_sample_rate}",
                 "-t", str(wm_video_duration), wm_audio_path],
                check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            )
            final_audio_files.append(wm_audio_path)

        if not final_audio_files:
            if logger:
                logger.info("No audio to process.")
            return True

        # Concatenate all processed audio files
        concat_list_path = os.path.join(temp_dir, f"concat_list_{uid}.txt")
        temp_files.append(concat_list_path)
        with open(concat_list_path, 'w') as f:
            for audio_file in final_audio_files:
                f.write(f"file '{os.path.realpath(audio_file)}'\n")

        combined_audio_path = os.path.join(temp_dir, f"combined_audio_{uid}.aac")
        temp_files.append(combined_audio_path)

        # Get audio_pass from format JSON, fallback to defaults
        audio_pass_args = video_format.get("audio_pass", ["-c:a", "aac", "-b:a", "192k"])

        concat_cmd = [
            ffmpeg_path, "-y", "-f", "concat", "-safe", "0",
            "-i", concat_list_path,
        ] + audio_pass_args + [combined_audio_path]

        if logger:
            logger.info(f"Running ffmpeg for audio concatenation: {' '.join(concat_cmd)}")
        result = subprocess.run(concat_cmd, capture_output=True, text=True)
        if result.returncode != 0:
            if logger:
                logger.error(f"FFmpeg audio concatenation failed: {result.stderr}")
            return False

        return combined_audio_path, temp_files

    except Exception as e:
        if logger:
            logger.error(f"Audio processing failed: {e}")
            import traceback
            logger.error(traceback.format_exc())
        return False
    finally:
        # Note: temp_files cleanup is handled by the caller after muxing
        pass


def mux_audio_into_video(video_path, combined_audio_path, temp_video_path, logger=None):
    """Mux combined audio into an existing video file.

    Args:
        video_path: Path to the current video file (will be replaced).
        combined_audio_path: Path to the combined audio file.
        temp_video_path: Temporary path for the muxed video.
        logger: Optional logger.

    Returns:
        True on success, False on failure.
    """
    mux_cmd = [
        ffmpeg_path, "-y",
        "-i", video_path,
        "-i", combined_audio_path,
        "-c:v", "copy", "-c:a", "copy",
        temp_video_path,
    ]
    if logger:
        logger.info(f"Muxing video and audio: {' '.join(mux_cmd)}")

    result = subprocess.run(mux_cmd, capture_output=True, text=True)
    if result.returncode != 0:
        if logger:
            logger.error(f"FFmpeg muxing failed: {result.stderr}")
        return False

    os.replace(temp_video_path, video_path)
    if logger:
        logger.info("Successfully added concatenated audio to video")
    return True
