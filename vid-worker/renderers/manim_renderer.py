"""
Manim Renderer — Render ManimGL (3b1b) scenes headless.
Uses xvfb + manimgl for software-rendered OpenGL output (works without GPU).
"""
import os
import subprocess
import shutil
import logging
import time
import sys
from typing import Dict, Any, Optional
from config import TEMP_DIR, RENDER_TIMEOUT_SEC, get_resolution

logger = logging.getLogger(__name__)

# ManimGL quality flags (different from ManimCE)
QUALITY_FLAGS = {
    "480p": "-l",       # low quality
    "720p": "-m",       # medium quality
    "1080p": "--hd",    # HD 1080p
    "4k": "--uhd",      # UHD 4k
}

# Path to the ManimGL venv — resolve from workspace root
# This file is at vid-worker/renderers/manim_renderer.py
# Repo root is 2 levels up from renderers/
_RENDERERS_DIR = os.path.dirname(os.path.abspath(__file__))
_VID_WORKER_DIR = os.path.dirname(_RENDERERS_DIR)
_REPO_ROOT = os.path.dirname(_VID_WORKER_DIR)
MANIMGL_VENV = os.path.join(_REPO_ROOT, "3b1b-workspace", "manimgl-venv")
MANIMGL_BIN = os.path.join(MANIMGL_VENV, "bin", "manimgl")


def render_manim(
    scene: Dict[str, Any],
    resolution: str = "1080p",
    format: str = "horizontal",
    output_path: Optional[str] = None,
) -> str:
    """
    Render a Manim scene to MP4 using ManimGL (3b1b version).

    Args:
        scene: Scene dict with manim_code/manim_template/manim_params
        resolution: Target resolution
        format: horizontal or vertical
        output_path: Output file path

    Returns:
        Path to rendered MP4 clip
    """
    if not output_path:
        output_path = os.path.join(TEMP_DIR, f"manim_{int(time.time()*1000)}.mp4")

    # Determine Manim code source
    manim_code = scene.get("manim_code")
    if not manim_code:
        template = scene.get("manim_template")
        params = scene.get("manim_params", {})
        if template:
            manim_code = _load_template(template, params, scene)
        else:
            manim_code = _generate_text_scene(scene)

    # Write code to temp file
    scene_name = "VideoScene"
    temp_py = os.path.join(TEMP_DIR, f"manim_scene_{int(time.time()*1000)}.py")
    with open(temp_py, "w", encoding="utf-8") as f:
        f.write(manim_code)

    # Extract scene class name
    for line in manim_code.split("\n"):
        stripped = line.strip()
        if stripped.startswith("class ") and "Scene" in stripped and "(" in stripped:
            scene_name = stripped.split("(")[0].replace("class ", "").strip()
            break

    quality_flag = QUALITY_FLAGS.get(resolution, "--hd")
    res_config = get_resolution(resolution)

    # Build ManimGL render command with xvfb
    # xvfb-run creates a virtual X display for OpenGL rendering
    cmd = [
        "xvfb-run", "-a",
        "-s", f"-screen 0 {res_config.width}x{res_config.height}x24",
        MANIMGL_BIN,
        temp_py,
        scene_name,
        "-w",  # write to file
        quality_flag,
    ]

    logger.info(f"Rendering ManimGL: {scene_name} @ {resolution}")

    try:
        env = os.environ.copy()
        env["LIBGL_ALWAYS_SOFTWARE"] = "1"

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=TEMP_DIR,
            env=env,
        )

        if result.returncode != 0:
            error_log = result.stderr[-500:]
            logger.error(f"ManimGL render failed: {error_log}")
            # Save the failing code for debugging
            debug_path = os.path.join(TEMP_DIR, f"failed_scene_{scene_name}.py")
            with open(debug_path, "w", encoding="utf-8") as f:
                f.write(manim_code)
            logger.error(f"Saved failing code to {debug_path}")
            raise RuntimeError(f"ManimGL render error: {result.stderr[-200:]}")

        # Find output video file — ManimGL outputs to videos/<SceneName>.mp4
        rendered = _find_rendered_video(TEMP_DIR, scene_name)
        if rendered:
            shutil.move(rendered, output_path)
            logger.info(f"ManimGL render OK: {output_path}")
            return output_path
        else:
            raise FileNotFoundError(f"ManimGL output not found for {scene_name}")

    except Exception as e:
        logger.error(f"ManimGL render exception: {str(e)}")
        raise
    finally:
        if os.path.exists(temp_py):
            os.remove(temp_py)


def _find_rendered_video(search_dir: str, scene_name: str) -> Optional[str]:
    """Find the rendered video file in ManimGL's output directories."""
    # ManimGL outputs to: videos/<SceneName>.mp4 (in cwd or home)
    search_dirs = [
        os.path.join(search_dir, "videos"),
        os.path.join(os.path.expanduser("~"), "ai-teaching-assistant", "3b1b-workspace", "videos"),
        os.path.join(search_dir, "media", "videos"),
    ]

    for base_dir in search_dirs:
        if not os.path.exists(base_dir):
            continue
        # Direct match first
        direct = os.path.join(base_dir, f"{scene_name}.mp4")
        if os.path.exists(direct) and os.path.getsize(direct) > 100:
            return direct
        # Walk search
        for root, dirs, files in os.walk(base_dir):
            for f in sorted(files, reverse=True):  # newest first
                if f.endswith(".mp4") and scene_name in f and "_temp" not in f:
                    full_path = os.path.join(root, f)
                    if os.path.getsize(full_path) > 100:
                        return full_path

    return None


def _load_template(template_name: str, params: Dict, scene: Dict) -> str:
    """Load a Manim template and fill in parameters."""
    from config import TEMPLATES_DIR
    template_path = os.path.join(TEMPLATES_DIR, f"{template_name}.py")

    if os.path.exists(template_path):
        with open(template_path, "r") as f:
            code = f.read()
        for key, value in params.items():
            code = code.replace(f"{{{{ {key} }}}}", str(value))
            code = code.replace(f"{{{key}}}", str(value))
        return code

    logger.warning(f"Template '{template_name}' not found, using text fallback")
    return _generate_text_scene(scene)


def _generate_text_scene(scene: Dict) -> str:
    """Generate a simple text-display ManimGL scene as fallback."""
    title = scene.get("title", "Scene").replace('"', '\\"').replace("'", "")
    desc = scene.get("visual_desc", "").replace('"', '\\"').replace("'", "")[:100]

    return f'''from manimlib import *

class VideoScene(Scene):
    def construct(self):
        title = Text("{title}", font_size=48, color=YELLOW)
        title.to_edge(UP, buff=1.5)

        self.play(Write(title), run_time=1.5)

        if "{desc}":
            desc = Text("{desc}", font_size=28, color=WHITE)
            desc.next_to(title, DOWN, buff=0.8)
            self.play(FadeIn(desc, shift=UP*0.3), run_time=1)

        self.wait(3)
'''
