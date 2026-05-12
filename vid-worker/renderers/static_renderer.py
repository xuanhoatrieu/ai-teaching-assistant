"""
Static Renderer — Convert image to video with Ken Burns effect.
Uses FFmpeg zoompan filter for professional-looking pan/zoom animations.
"""
import os
import subprocess
import logging
import time
import requests
from typing import Dict, Any, Optional
from config import TEMP_DIR, FFMPEG_BIN, get_resolution

logger = logging.getLogger(__name__)

KEN_BURNS_EFFECTS = {
    "zoom_in": "z='min(zoom+0.0015,1.5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'",
    "zoom_out": "z='if(lte(zoom,1.0),1.5,max(1.001,zoom-0.0015))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'",
    "pan_right": "z='1.2':x='if(lte(on,1),0,min(iw/zoom/4,x+1))':y='ih/2-(ih/zoom/2)'",
    "pan_left": "z='1.2':x='if(lte(on,1),iw/zoom/4,max(0,x-1))':y='ih/2-(ih/zoom/2)'",
    "none": "z='1':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'",
}


def render_static(
    scene: Dict[str, Any],
    duration: float = 10.0,
    resolution: str = "1080p",
    format: str = "horizontal",
    output_path: Optional[str] = None,
) -> str:
    """
    Create a video from a static image with Ken Burns effect.

    Args:
        scene: Scene dict with image_url or image_path
        duration: Video duration in seconds
        resolution: Target resolution
        format: horizontal or vertical
        output_path: Output file path

    Returns:
        Path to rendered MP4 clip
    """
    if not output_path:
        output_path = os.path.join(TEMP_DIR, f"static_{int(time.time()*1000)}.mp4")

    res = get_resolution(resolution, format)

    # Get image path
    image_path = scene.get("image_path") or scene.get("image_url")
    if not image_path:
        logger.warning("No image, creating color background")
        image_path = _create_placeholder(
            res.width, res.height,
            title=scene.get("title", ""),
            desc=scene.get("visual_desc", ""),
        )
    elif image_path.startswith("http"):
        image_path = _download_image(image_path)

    # Ken Burns effect
    effect_name = scene.get("ken_burns", "zoom_in")
    effect = KEN_BURNS_EFFECTS.get(effect_name, KEN_BURNS_EFFECTS["zoom_in"])

    fps = 30
    total_frames = int(duration * fps)

    cmd = [
        FFMPEG_BIN, "-y",
        "-loop", "1",
        "-i", image_path,
        "-vf", f"zoompan={effect}:d={total_frames}:s={res.width}x{res.height}:fps={fps}",
        "-c:v", "libx264", "-preset", "medium", "-crf", "23",
        "-t", str(duration),
        "-pix_fmt", "yuv420p",
        output_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        logger.error(f"Static render failed: {result.stderr[-300:]}")
        raise RuntimeError(f"Static render error: {result.stderr[-200:]}")

    logger.info(f"Static render OK: {output_path} ({duration}s, {effect_name})")
    return output_path


def _download_image(url: str) -> str:
    """Download image from URL to temp file."""
    ext = url.split(".")[-1].split("?")[0][:4]
    if ext not in ("jpg", "jpeg", "png", "webp"):
        ext = "jpg"
    path = os.path.join(TEMP_DIR, f"img_{int(time.time()*1000)}.{ext}")

    response = requests.get(url, timeout=30)
    response.raise_for_status()
    with open(path, "wb") as f:
        f.write(response.content)

    logger.info(f"Downloaded image: {url} → {path}")
    return path


def _create_placeholder(width: int, height: int, title: str = "", desc: str = "") -> str:
    """Create a styled gradient placeholder image with optional title text."""
    path = os.path.join(TEMP_DIR, f"placeholder_{int(time.time()*1000)}.png")

    # Build drawtext filters for title and desc
    filters = []
    # Dark gradient background: top-left navy → bottom-right dark blue
    filters.append(f"color=c=0x0f172a:s={width}x{height}:d=1")

    cmd_input = [
        FFMPEG_BIN, "-y",
        "-f", "lavfi",
        "-i", filters[0],
    ]

    # Build video filter chain
    vf_parts = []

    # Add a subtle gradient overlay
    vf_parts.append(f"drawbox=x=0:y=0:w={width}:h={height//2}:color=0x1e3a5f@0.3:t=fill")

    # Draw title text if provided
    if title:
        safe_title = title.replace("'", "").replace(":", " -").replace("\\", "")[:60]
        vf_parts.append(
            f"drawtext=text='{safe_title}'"
            f":fontsize={int(width/25)}"
            f":fontcolor=white"
            f":x=(w-text_w)/2:y=(h-text_h)/2-{int(height/10)}"
            f":borderw=2:bordercolor=0x0f172a"
        )

    # Draw desc text below title if provided
    if desc:
        safe_desc = desc.replace("'", "").replace(":", " -").replace("\\", "")[:80]
        vf_parts.append(
            f"drawtext=text='{safe_desc}'"
            f":fontsize={int(width/40)}"
            f":fontcolor=0xbfdbfe"
            f":x=(w-text_w)/2:y=(h-text_h)/2+{int(height/10)}"
            f":borderw=1:bordercolor=0x0f172a"
        )

    if vf_parts:
        cmd_input.extend(["-vf", ",".join(vf_parts)])

    cmd_input.extend(["-frames:v", "1", path])

    subprocess.run(cmd_input, capture_output=True, timeout=10)
    return path

