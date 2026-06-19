"""
VidiaVideoSaver -- the main ComfyUI custom node class for Vidia.
Orchestrates video creation, audio processing, and cloud upload.
"""

import os
import json
import datetime
import torch
from PIL import Image, ExifTags
from PIL.PngImagePlugin import PngInfo

import folder_paths
from .config import HAS_BOTO3
from .utils import ffmpeg_path, tensor_to_bytes, VideoProcessingLogger
from .video_processing import (
    get_video_formats,
    apply_format_widgets,
    ffmpeg_process,
    resample_frames_ffmpeg,
    process_watermark_frames,
    process_corner_watermark,
    VideoPathManager,
    VideoProcessingState,
)
from .audio_processing import process_audio, mux_audio_into_video
from .upload import upload_to_cloudflare_s3


class VidiaVideoSaver:
    """Comprehensive video processing and saving node for ComfyUI.

    Takes generated frames from ComfyUI workflows and processes them into a
    complete video file with audio, then uploads to cloud storage.

    Pipeline:
      1. Preprocess and validate input frames
      2. Generate metadata from prompt information
      3. Save the first frame with metadata
      4. Process frames (watermarks, dimension alignment)
      5. Create video file via ffmpeg using format JSON settings
      6. Process and concatenate audio to match video segments
      7. Upload to Cloudflare R2
      8. Notify backend of completion
    """

    DESCRIPTION = "Saves video frames to a file with optional watermarks and audio, uploads to Cloudflare R2, and notifies the backend."

    @classmethod
    def INPUT_TYPES(cls):
        ffmpeg_formats = get_video_formats()
        return {
            "required": {
                "images": ("IMAGE",),
                "frame_rate": ("FLOAT", {"default": 8, "min": 1, "step": 1}),
                "filename_prefix": ("STRING", {"default": "Vidia"}),
                "format": (["image/gif", "image/webp"] + ffmpeg_formats,),
                "save_output": ("BOOLEAN", {"default": True}),
            },
            "optional": {
                "audio": ("AUDIO", {"lazy": True}),
                "append_watermark": ("IMAGE",),
                "watermark_audio": ("AUDIO", {"lazy": True}),
                "corner_watermark": ("IMAGE",),
                "corner_watermark_mask": ("MASK",),
                "corner_opacity": ("FLOAT", {"default": 0.4, "min": 0.0, "max": 1.0, "step": 0.1}),
                "append_watermark_source_fps": ("FLOAT", {"default": 0, "min": 0, "max": 120, "step": 1}),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    RETURN_TYPES = ("VIDIA_FILENAMES",)
    RETURN_NAMES = ("Filenames",)
    OUTPUT_NODE = True
    CATEGORY = "Vidia"
    FUNCTION = "save_video"

    def __init__(self):
        self.logger = VideoProcessingLogger("VidiaVideoSaver")

    def check_lazy_status(self, images, audio=None, watermark_audio=None, **kwargs):
        """Tell the executor which lazy inputs are still needed."""
        needed = []
        if audio is None:
            needed.append('audio')
        if watermark_audio is None:
            needed.append('watermark_audio')
        if needed:
            self.logger.info(f"Waiting for lazy inputs: {', '.join(needed)}")
        return needed

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------
    def save_video(
        self,
        images,
        frame_rate: int,
        filename_prefix="Vidia",
        format="video/h264-mp4",
        save_output=True,
        prompt=None,
        extra_pnginfo=None,
        audio=None,
        append_watermark=None,
        watermark_audio=None,
        corner_watermark=None,
        corner_watermark_mask=None,
        corner_opacity=0.4,
        append_watermark_source_fps=0,
        **kwargs,
    ):
        # Initialize helpers
        self.path_manager = VideoPathManager(
            filename_prefix,
            folder_paths.get_output_directory() if save_output else folder_paths.get_temp_directory(),
            save_output,
        )
        self.state = VideoProcessingState()

        self.logger.info(f"Starting video processing with {len(images) if isinstance(images, list) else images.size(0)} frames")

        # Input validation
        images = self._preprocess_inputs(images)
        if images is None:
            return {"ui": {"error": "No input frames"}, "result": ((save_output, []),)}

        # Create metadata
        video_metadata = self._prepare_metadata(prompt, extra_pnginfo)

        # Save first frame
        self._save_first_frame(images[0], video_metadata)

        # Parse format type
        format_type, format_ext = format.split("/")
        self.logger.info(f"Using format: {format_type}/{format_ext}")

        if format_type == "image":
            self._process_image_format(images, format_ext, frame_rate)
        else:
            # Video format via ffmpeg
            if ffmpeg_path is None:
                raise ProcessLookupError("ffmpeg is required for video outputs and could not be found.")

            video_format = apply_format_widgets(format_ext, kwargs)
            user_frames_count = len(images)
            self.state.processed_frames = user_frames_count

            # Prepare frames (watermarks, dimension alignment, resampling)
            processed_frames = self._prepare_frames(
                images, video_format, corner_watermark,
                corner_watermark_mask, corner_opacity, append_watermark,
                frame_rate, append_watermark_source_fps,
            )

            watermark_frames_count = len(processed_frames) - user_frames_count if self.state.has_append_watermark else 0
            self.logger.info(f"Frame counts - User: {user_frames_count}, Append Watermark: {watermark_frames_count}, Total: {len(processed_frames)}")

            # Create video file (now properly uses main_pass from format JSON)
            success = self._create_video_file(processed_frames, video_format, video_metadata, frame_rate)

            if success:
                # Process audio
                audio_result = process_audio(
                    audio, watermark_audio, video_format, frame_rate,
                    user_frames_count=user_frames_count,
                    watermark_frames_count=watermark_frames_count,
                    logger=self.logger,
                )
                # audio_result is either False, True, or (combined_audio_path, temp_files)
                if isinstance(audio_result, tuple):
                    combined_audio_path, temp_files = audio_result
                    video_path = self.path_manager.get_output_files()[-1]
                    temp_video_path = self.path_manager.get_temp_video_path(video_format.get("extension", "mp4"))
                    mux_success = mux_audio_into_video(video_path, combined_audio_path, temp_video_path, self.logger)
                    if mux_success:
                        self.state.audio_processed = True
                    # Cleanup temp files
                    for tf in temp_files:
                        if os.path.exists(tf):
                            try:
                                os.unlink(tf)
                            except OSError:
                                pass

                # Upload to Cloudflare
                try:
                    if HAS_BOTO3:
                        upload_result = upload_to_cloudflare_s3(
                            format, self.path_manager.get_output_files()[-1],
                            filename_prefix, self.logger, self.state,
                        )
                    else:
                        self.logger.error("boto3 is not installed, cannot upload to S3.")
                        return {
                            "ui": {"error": "boto3 is not installed. Video saved locally."},
                            "result": ((save_output, self.path_manager.get_output_files()),),
                        }

                    if upload_result.get("success", False):
                        return {
                            "ui": {"response": upload_result},
                            "result": ((save_output, self.path_manager.get_output_files()),),
                        }
                    else:
                        error_msg = upload_result.get('error', 'Unknown error')
                        if isinstance(error_msg, list):
                            error_msg = ''.join(error_msg)
                        return {
                            "ui": {"error": f"Upload failed but video saved locally: {error_msg}"},
                            "result": ((save_output, self.path_manager.get_output_files()),),
                        }

                except Exception as e:
                    self.logger.error(f"Upload failed: {str(e)}")
                    return {
                        "ui": {"error": f"Upload failed but video saved locally: {str(e)}"},
                        "result": ((save_output, self.path_manager.get_output_files()),),
                    }

        return {
            "ui": {"success": "Video processing completed"},
            "result": ((save_output, self.path_manager.get_output_files()),),
        }

    # ------------------------------------------------------------------
    # Private methods
    # ------------------------------------------------------------------
    def _preprocess_inputs(self, images):
        """Validate and preprocess input images. Returns None if empty."""
        if isinstance(images, dict):
            images = images['samples']
        if isinstance(images, torch.Tensor) and images.size(0) == 0:
            return None
        return images

    def _prepare_metadata(self, prompt, extra_pnginfo):
        video_metadata = {}
        if prompt is not None:
            video_metadata["prompt"] = json.dumps(prompt)
        if extra_pnginfo is not None:
            for x in extra_pnginfo:
                video_metadata[x] = extra_pnginfo[x]
        video_metadata["CreationTime"] = datetime.datetime.now().isoformat(" ")[:19]
        return video_metadata

    def _save_first_frame(self, first_frame, video_metadata):
        metadata = PngInfo()
        for key, value in video_metadata.items():
            if isinstance(value, str):
                metadata.add_text(key, value)
            else:
                metadata.add_text(key, json.dumps(value))

        first_image_path = self.path_manager.get_first_frame_path()
        self.logger.info(f"Saving first frame to {first_image_path}")

        try:
            Image.fromarray(tensor_to_bytes(first_frame)).save(
                first_image_path, pnginfo=metadata, compress_level=4,
            )
            self.path_manager.add_output_file(first_image_path)
            self.state.saved_first_frame = True
        except Exception as e:
            self.logger.error(f"Failed to save first frame: {str(e)}")
            self.state.add_error(f"First frame save failed: {str(e)}")

    def _process_image_format(self, images, format_ext, frame_rate):
        image_kwargs = {}
        if format_ext == "gif":
            image_kwargs['disposal'] = 2
        if format_ext == "webp":
            exif = Image.Exif()
            exif[ExifTags.IFD.Exif] = {36867: datetime.datetime.now().isoformat(" ")[:19]}
            image_kwargs['exif'] = exif

        file_path = self.path_manager.get_animation_path(format_ext)
        self.logger.info(f"Saving animation to {file_path}")

        try:
            frames = map(lambda x: Image.fromarray(tensor_to_bytes(x)), images)
            next_frame = next(frames)
            next_frame.save(
                file_path, format=format_ext.upper(), save_all=True,
                append_images=frames, duration=round(1000 / frame_rate),
                loop=0, compress_level=4, **image_kwargs,
            )
            self.path_manager.add_output_file(file_path)
            self.state.video_created = True
        except Exception as e:
            self.logger.error(f"Failed to create {format_ext} animation: {str(e)}")
            self.state.add_error(f"Animation creation failed: {str(e)}")

    def _prepare_frames(self, images, video_format, corner_watermark=None,
                        corner_watermark_mask=None, corner_opacity=0.4,
                        append_watermark=None, frame_rate=None,
                        append_watermark_source_fps=0):
        """Prepare frames: dimension alignment, watermarks, resampling."""
        if isinstance(images, torch.Tensor):
            images = list(images)
        first_frame = images[0]

        # Dimension alignment
        dim_alignment = video_format.get("dim_alignment", 2)
        if (first_frame.shape[1] % dim_alignment) or (first_frame.shape[0] % dim_alignment):
            to_pad = (-first_frame.shape[1] % dim_alignment,
                      -first_frame.shape[0] % dim_alignment)
            padding = (to_pad[0] // 2, to_pad[0] - to_pad[0] // 2,
                       to_pad[1] // 2, to_pad[1] - to_pad[1] // 2)
            padfunc = torch.nn.ReplicationPad2d(padding)

            def pad(image):
                return padfunc(image.permute(2, 0, 1).to(dtype=torch.float32)).permute(1, 2, 0)

            self.logger.warn("Frames not aligned to required dimensions; padding applied")
            images = list(map(pad, images))

        # Corner watermark (only on user frames)
        if corner_watermark is not None and corner_watermark_mask is not None:
            self.logger.info("Applying corner watermark")

            if isinstance(corner_watermark, torch.Tensor) and corner_watermark.ndim == 3:
                corner_watermark = [corner_watermark] * len(images)
            if isinstance(corner_watermark_mask, torch.Tensor) and corner_watermark_mask.ndim == 2:
                corner_watermark_mask = [corner_watermark_mask] * len(images)

            processed_wm, processed_mask, (x_offset, y_offset) = process_corner_watermark(
                corner_watermark, corner_watermark_mask, first_frame.shape, corner_opacity, logger=self.logger,
            )

            if processed_wm and processed_mask:
                for i in range(len(images)):
                    try:
                        frame = images[i]
                        wm = processed_wm[i % len(processed_wm)]
                        mask = processed_mask[i % len(processed_mask)]
                        mask_3d = mask.unsqueeze(-1).repeat(1, 1, 3)
                        blended = frame.clone()

                        h, w = wm.shape[:2]
                        y_start, x_start = max(0, y_offset), max(0, x_offset)
                        y_end = min(frame.shape[0], y_offset + h)
                        x_end = min(frame.shape[1], x_offset + w)
                        h_slice, w_slice = y_end - y_start, x_end - x_start

                        if h_slice <= 0 or w_slice <= 0:
                            continue

                        wm_y_start = -y_offset if y_offset < 0 else 0
                        wm_x_start = -x_offset if x_offset < 0 else 0

                        frame_area = frame[y_start:y_end, x_start:x_end]
                        mask_area = mask_3d[wm_y_start:wm_y_start + h_slice, wm_x_start:wm_x_start + w_slice]
                        wm_area = wm[wm_y_start:wm_y_start + h_slice, wm_x_start:wm_x_start + w_slice] * corner_opacity

                        if frame_area.shape != mask_area.shape or frame_area.shape != wm_area.shape:
                            continue

                        blended[y_start:y_end, x_start:x_end] = frame_area * (1.0 - mask_area) + wm_area * mask_area
                        images[i] = blended
                    except Exception as e:
                        self.logger.error(f"Error applying watermark to frame {i}: {e}")

                self.state.has_corner_watermark = True

        # Append watermark
        watermark_frames = []
        if append_watermark is not None:
            self.logger.info("Processing append watermark")
            if isinstance(append_watermark, torch.Tensor) and append_watermark.ndim == 3:
                append_watermark = [append_watermark] * len(images)

            watermark_frames = process_watermark_frames(append_watermark, first_frame.shape)

            if append_watermark_source_fps > 0 and frame_rate > 0 and abs(append_watermark_source_fps - frame_rate) > 0.01:
                watermark_frames = resample_frames_ffmpeg(watermark_frames, append_watermark_source_fps, frame_rate, self.logger)

            self.state.has_append_watermark = True

        if watermark_frames:
            images.extend(watermark_frames)

        return images

    def _create_video_file(self, processed_frames, video_format, video_metadata, frame_rate):
        """Create the video file with ffmpeg, using main_pass settings from the format JSON."""
        format_ext = video_format.get("extension", "mp4")
        file_path = self.path_manager.get_video_path(format_ext)
        self.logger.info(f"Creating video at {file_path}")

        try:
            if isinstance(processed_frames, torch.Tensor):
                processed_frames = list(processed_frames)

            env = os.environ.copy()

            # Build input args
            pix_fmt_in = "rgb24" if processed_frames[0].shape[2] == 3 else "rgba"
            args = [
                ffmpeg_path,
                "-y",
                "-v", "error",
                "-f", "rawvideo",
                "-pix_fmt", pix_fmt_in,
                "-s", f"{processed_frames[0].shape[1]}x{processed_frames[0].shape[0]}",
                "-r", str(frame_rate),
                "-i", "-",
            ]

            # Apply main_pass settings from the format JSON (fixes the ignored-settings bug)
            main_pass = video_format.get("main_pass", [])
            if main_pass:
                args.extend(main_pass)
                self.logger.info(f"Applying format main_pass args: {main_pass}")
            else:
                # Fallback if no main_pass defined
                args.extend(["-c:v", "libx264", "-preset", "medium", "-crf", "23", "-pix_fmt", "yuv420p"])
                self.logger.warn("No main_pass in format JSON, using default h264 settings")

            self.logger.info(f"ffmpeg command: {' '.join(args)} {file_path}")

            proc = ffmpeg_process(args, video_format, video_metadata, file_path, env, self.logger)
            next(proc)

            for frame in processed_frames:
                proc.send(tensor_to_bytes(frame).tobytes())

            total_frames_output = proc.send(None)
            self.logger.info(f"Finished encoding with {total_frames_output} frames")

            if os.path.exists(file_path):
                file_size = os.path.getsize(file_path)
                if file_size < 1000:
                    self.logger.error(f"Video file is too small, likely corrupt: {file_path} ({file_size} bytes)")
                    self.state.add_error(f"Video file too small: {file_size} bytes")
                    return False
                else:
                    self.logger.info(f"Created video: {file_path} ({file_size} bytes)")
                    self.path_manager.add_output_file(file_path)
                    self.state.video_created = True
                    return True
            else:
                self.logger.error(f"Video file not created: {file_path}")
                self.state.add_error("Video file not created")
                return False

        except Exception as e:
            self.logger.error(f"Failed to create video: {str(e)}")
            self.state.add_error(f"Video creation failed: {str(e)}")
            return False


# ---------------------------------------------------------------------------
# ComfyUI node registration
# ---------------------------------------------------------------------------
NODE_CLASS_MAPPINGS = {
    "VidiaVideoSaver": VidiaVideoSaver,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "VidiaVideoSaver": "Vidia Video Saver",
}
