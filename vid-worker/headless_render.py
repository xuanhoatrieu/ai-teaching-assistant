"""
Headless ManimGL Renderer — bypasses Pyglet shadow window hang.

The key issue: importing manimlib triggers pyglet.gl._create_shadow_window()
which HANGS on headless servers without GPU. This script patches pyglet
BEFORE manimlib is imported to prevent the shadow window from being created.

Usage:
    python headless_render.py <scene_file.py> <SceneClass> [output_dir] [resolution]
"""
import sys
import os
import importlib.util
import logging

logger = logging.getLogger("headless_render")

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# STEP 1: Patch Pyglet BEFORE any manimlib import
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def _patch_pyglet():
    """Disable pyglet's shadow window to prevent hanging on headless servers."""
    import pyglet
    # Disable shadow window creation (this is what causes the hang)
    pyglet.options['shadow_window'] = False

    # Also prevent _create_shadow_window from running if called directly
    import pyglet.gl
    pyglet.gl._create_shadow_window = lambda: None


# Apply the patch immediately
_patch_pyglet()

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# STEP 2: Now it's safe to import manimlib
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
from manimlib import *
from manimlib.config import manim_config


def render_scene(scene_file: str, scene_name: str,
                 output_dir: str = "videos", resolution: str = "1080") -> str:
    """
    Render a single ManimGL scene headlessly.

    Args:
        scene_file: Path to the .py file containing the scene class
        scene_name: Name of the Scene subclass to render
        output_dir: Directory to write output .mp4
        resolution: "480", "720", "1080", or "4k"

    Returns:
        Path to the rendered .mp4 file, or empty string on failure
    """
    os.makedirs(output_dir, exist_ok=True)

    # Resolution mapping
    res_map = {
        "480":  (854, 480),
        "720":  (1280, 720),
        "1080": (1920, 1080),
        "4k":   (3840, 2160),
    }
    w, h = res_map.get(resolution, (1920, 1080))

    # Load the scene module dynamically
    spec = importlib.util.spec_from_file_location("user_scene", os.path.abspath(scene_file))
    if spec is None:
        logger.error(f"Cannot load {scene_file}")
        return ""

    module = importlib.util.module_from_spec(spec)

    # Inject manimlib namespace so user code can use `from manimlib import *` style
    import manimlib
    for name in dir(manimlib):
        if not name.startswith('_'):
            module.__dict__[name] = getattr(manimlib, name)

    try:
        spec.loader.exec_module(module)
    except Exception as e:
        logger.error(f"Error loading scene file: {e}")
        return ""

    # Find the scene class
    scene_cls = getattr(module, scene_name, None)
    if scene_cls is None:
        logger.error(f"Scene class '{scene_name}' not found in {scene_file}")
        return ""

    # Configure scene for headless write-to-movie
    scene_config = {
        "camera_config": {
            "pixel_width": w,
            "pixel_height": h,
            "fps": 30,
        },
        "file_writer_config": {
            "write_to_movie": True,
            "output_directory": os.path.abspath(output_dir),
            "movie_file_extension": ".mp4",
            "quiet": True,
        },
        "skip_animations": False,
        "window": None,  # No window — headless
    }

    try:
        scene = scene_cls(**scene_config)
        scene.run()
    except Exception as e:
        logger.error(f"Scene render error: {e}")
        return ""

    # Find the output file
    expected_path = os.path.join(output_dir, f"{scene_name}.mp4")
    temp_path = os.path.join(output_dir, f"{scene_name}_temp.mp4")

    # If temp exists but final doesn't, rename it (backup for the library patch)
    if os.path.exists(temp_path) and not os.path.exists(expected_path):
        import shutil
        shutil.move(temp_path, expected_path)
        logger.info(f"Renamed temp file to {expected_path}")

    if os.path.exists(expected_path) and os.path.getsize(expected_path) > 100:
        logger.info(f"Render OK: {expected_path} ({os.path.getsize(expected_path)} bytes)")
        return expected_path
    else:
        logger.error(f"Output file missing or too small: {expected_path}")
        return ""


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <scene_file.py> <SceneClassName> [output_dir] [resolution]")
        sys.exit(1)

    scene_file = sys.argv[1]
    scene_name = sys.argv[2]
    output_dir = sys.argv[3] if len(sys.argv) > 3 else "videos"
    resolution = sys.argv[4] if len(sys.argv) > 4 else "1080"

    result = render_scene(scene_file, scene_name, output_dir, resolution)
    if result:
        print(f"SUCCESS: {result}")
        sys.exit(0)
    else:
        print("FAILED")
        sys.exit(1)
