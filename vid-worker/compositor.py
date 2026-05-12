"""
Video Generation Worker — FFmpeg Compositor
Handles all video composition: scene compose, concat, subtitle burn, SRT generation.
"""
import os
import subprocess
import logging
import time
from typing import List, Dict, Any, Optional
from config import FFMPEG_BIN, FFPROBE_BIN, TEMP_DIR, get_resolution

logger = logging.getLogger(__name__)


def compose_scene(
    clip_path: str,
    audio_path: str,
    resolution: str = "1080p",
    format: str = "horizontal",
    output_path: Optional[str] = None,
) -> str:
    """
    Combine a video clip with audio, scaling to target resolution.

    Args:
        clip_path: Path to the video clip
        audio_path: Path to the audio WAV
        resolution: Target resolution (480p/720p/1080p/4k)
        format: horizontal or vertical
        output_path: Output file path

    Returns:
        Path to the composed scene MP4
    """
    if not output_path:
        output_path = os.path.join(TEMP_DIR, f"scene_{int(time.time()*1000)}.mp4")

    res = get_resolution(resolution, format)

    # Get audio duration to calculate padding needed
    audio_dur = get_duration(audio_path)
    clip_dur = get_duration(clip_path)

    # Build video filter chain
    vf_parts = [
        f"scale={res.width}:{res.height}:force_original_aspect_ratio=decrease",
        f"pad={res.width}:{res.height}:(ow-iw)/2:(oh-ih)/2:black",
    ]

    # If video is shorter than audio, freeze the last frame (tpad)
    # This is the 3b1b approach: animation plays, then holds on final frame
    # while narration continues. No looping, no cutting.
    if audio_dur > 0 and clip_dur > 0 and audio_dur > clip_dur + 0.5:
        pad_duration = audio_dur - clip_dur + 0.5  # extra 0.5s buffer
        vf_parts.append(f"tpad=stop_mode=clone:stop_duration={pad_duration:.1f}")
        logger.info(f"Extending video by {pad_duration:.1f}s (freeze last frame) to match audio")

    cmd = [
        FFMPEG_BIN, "-y",
        "-i", clip_path,
        "-i", audio_path,
        "-vf", ",".join(vf_parts),
        "-c:v", "libx264", "-preset", "medium", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        "-shortest",  # Cuts to shorter of (padded video, audio)
        "-movflags", "+faststart",
        output_path,
    ]

    _run_ffmpeg(cmd, f"compose_scene → {output_path}")
    return output_path


def concat_scenes(scene_paths: List[str], output_path: Optional[str] = None) -> str:
    """
    Concatenate multiple scene MP4 files into one final video.

    Args:
        scene_paths: List of MP4 file paths in order
        output_path: Output file path

    Returns:
        Path to the concatenated MP4
    """
    if not output_path:
        output_path = os.path.join(TEMP_DIR, f"final_{int(time.time()*1000)}.mp4")

    # Create concat file list
    concat_file = os.path.join(TEMP_DIR, f"concat_{int(time.time()*1000)}.txt")
    with open(concat_file, "w") as f:
        for path in scene_paths:
            f.write(f"file '{os.path.abspath(path)}'\n")

    cmd = [
        FFMPEG_BIN, "-y",
        "-f", "concat", "-safe", "0",
        "-i", concat_file,
        "-c", "copy",
        "-movflags", "+faststart",
        output_path,
    ]

    _run_ffmpeg(cmd, f"concat {len(scene_paths)} scenes → {output_path}")

    # Cleanup concat file
    os.remove(concat_file)
    return output_path


def burn_subtitle(
    video_path: str,
    srt_path: str,
    output_path: Optional[str] = None,
) -> str:
    """Burn SRT subtitles into video (hardcoded)."""
    if not output_path:
        output_path = os.path.join(TEMP_DIR, f"subbed_{int(time.time()*1000)}.mp4")

    # Escape path for subtitles filter
    escaped_srt = srt_path.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")

    cmd = [
        FFMPEG_BIN, "-y",
        "-i", video_path,
        "-vf", f"subtitles='{escaped_srt}':force_style='FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2'",
        "-c:v", "libx264", "-preset", "medium", "-crf", "23",
        "-c:a", "copy",
        "-movflags", "+faststart",
        output_path,
    ]

    _run_ffmpeg(cmd, f"burn_subtitle → {output_path}")
    return output_path


def generate_srt(
    scenes: List[Dict[str, Any]],
    lang: str = "vi",
    output_path: Optional[str] = None,
) -> str:
    """
    Generate SRT subtitle file from scene data.

    Args:
        scenes: List of scene dicts with narration_vi/narration_en and duration
        lang: Subtitle language (vi/en/both)
        output_path: Output SRT file path

    Returns:
        Path to the SRT file
    """
    if not output_path:
        output_path = os.path.join(TEMP_DIR, f"subtitle_{lang}_{int(time.time()*1000)}.srt")

    current_time = 0.0
    srt_entries = []

    for i, scene in enumerate(scenes):
        duration = scene.get("duration", scene.get("duration_est", 30))
        start = _format_srt_time(current_time)
        end = _format_srt_time(current_time + duration)

        if lang == "both":
            text_vi = scene.get("narration_vi", "")
            text_en = scene.get("narration_en", "")
            text = f"{text_vi}\n{text_en}" if text_en else text_vi
        elif lang == "en":
            text = scene.get("narration_en", scene.get("narration_vi", ""))
        else:
            text = scene.get("narration_vi", "")

        if text.strip():
            srt_entries.append(f"{i+1}\n{start} --> {end}\n{text}\n")

        current_time += duration

    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(srt_entries))

    logger.info(f"Generated SRT ({lang}): {len(srt_entries)} entries → {output_path}")
    return output_path


def extract_thumbnail(video_path: str, at_seconds: float = 5.0, output_path: Optional[str] = None) -> str:
    """Extract a frame from video as thumbnail."""
    if not output_path:
        output_path = os.path.join(TEMP_DIR, f"thumb_{int(time.time()*1000)}.jpg")

    cmd = [
        FFMPEG_BIN, "-y",
        "-ss", str(at_seconds),
        "-i", video_path,
        "-vframes", "1",
        "-q:v", "2",
        output_path,
    ]
    _run_ffmpeg(cmd, f"thumbnail → {output_path}")
    return output_path


def get_duration(file_path: str) -> float:
    """Get media file duration in seconds."""
    try:
        result = subprocess.run(
            [FFPROBE_BIN, "-v", "quiet", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", file_path],
            capture_output=True, text=True, timeout=10
        )
        return float(result.stdout.strip())
    except Exception:
        return 0.0


def get_file_size(file_path: str) -> int:
    """Get file size in bytes."""
    return os.path.getsize(file_path) if os.path.exists(file_path) else 0


# ── Private helpers ──

def _format_srt_time(seconds: float) -> str:
    """Convert seconds to SRT timestamp format: HH:MM:SS,mmm"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _run_ffmpeg(cmd: List[str], description: str = "") -> None:
    """Run FFmpeg command with logging."""
    logger.debug(f"FFmpeg: {description}")
    logger.debug(f"CMD: {' '.join(cmd)}")

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=300,
    )

    if result.returncode != 0:
        logger.error(f"FFmpeg failed: {result.stderr[-500:]}")
        raise RuntimeError(f"FFmpeg error ({description}): {result.stderr[-200:]}")
