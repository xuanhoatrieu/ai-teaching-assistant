"""
Playwright Renderer — Record code typing in a headless browser IDE.
Creates professional-looking code demo videos without needing a real IDE.
"""
import os
import asyncio
import subprocess
import logging
import time
from typing import Dict, Any, List, Optional
from config import TEMP_DIR, IDE_TEMPLATES_DIR, get_resolution

logger = logging.getLogger(__name__)


def render_playwright(
    scene: Dict[str, Any],
    resolution: str = "1080p",
    format: str = "horizontal",
    output_path: Optional[str] = None,
) -> str:
    """
    Record code typing via Playwright headless browser.

    Args:
        scene: Scene dict with code_lines[] and code_language
        resolution: Target resolution
        format: horizontal or vertical
        output_path: Output file path

    Returns:
        Path to rendered MP4 clip
    """
    if not output_path:
        output_path = os.path.join(TEMP_DIR, f"playwright_{int(time.time()*1000)}.mp4")

    code_lines = scene.get("code_lines", [])
    code_language = scene.get("code_language", "python")
    ide_template = scene.get("ide_template", "python_ide")

    if not code_lines:
        logger.warning("No code_lines, creating placeholder")
        code_lines = [f"# {scene.get('title', 'Demo')}"]

    res = get_resolution(resolution, format)

    # Run async recording
    webm_path = os.path.join(TEMP_DIR, f"pw_{int(time.time()*1000)}.webm")

    asyncio.run(_record_code(
        code_lines=code_lines,
        language=code_language,
        ide_template=ide_template,
        width=res.width,
        height=res.height,
        output_path=webm_path,
    ))

    # Convert WebM → MP4
    _convert_webm_to_mp4(webm_path, output_path)

    # Cleanup WebM
    if os.path.exists(webm_path):
        os.remove(webm_path)

    logger.info(f"Playwright render OK: {output_path}")
    return output_path


async def _record_code(
    code_lines: List[str],
    language: str,
    ide_template: str,
    width: int,
    height: int,
    output_path: str,
) -> None:
    """Async function to record code typing in browser."""
    from playwright.async_api import async_playwright

    ide_html = _get_ide_html(ide_template, language)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            record_video_dir=TEMP_DIR,
            record_video_size={"width": width, "height": height},
            viewport={"width": width, "height": height},
        )

        page = await context.new_page()

        # Write IDE HTML to temp file and open it
        html_path = os.path.join(TEMP_DIR, f"ide_{int(time.time()*1000)}.html")
        with open(html_path, "w", encoding="utf-8") as f:
            f.write(ide_html)

        await page.goto(f"file://{html_path}")
        await page.wait_for_selector("#editor")
        await page.click("#editor")
        await page.wait_for_timeout(500)

        # Type code with realistic delays
        for i, line in enumerate(code_lines):
            await page.keyboard.type(line, delay=60)
            await page.keyboard.press("Enter")

            # Handle auto-indent: if next line has less indent, press Backspace
            if i < len(code_lines) - 1:
                current_indent = len(line) - len(line.lstrip())
                next_indent = len(code_lines[i+1]) - len(code_lines[i+1].lstrip())
                if next_indent < current_indent:
                    for _ in range((current_indent - next_indent) // 4):
                        await page.keyboard.press("Backspace")

            await page.wait_for_timeout(200)

        # Hold final frame for 2 seconds
        await page.wait_for_timeout(2000)

        # Save video
        video_path = await page.video.path()
        await context.close()
        await browser.close()

        # Move video to desired path
        if os.path.exists(video_path):
            os.rename(video_path, output_path)

        # Cleanup HTML
        if os.path.exists(html_path):
            os.remove(html_path)


def _get_ide_html(template_name: str, language: str) -> str:
    """Get IDE HTML template content."""
    # Check for custom template first
    custom_path = os.path.join(IDE_TEMPLATES_DIR, f"{template_name}.html")
    if os.path.exists(custom_path):
        with open(custom_path, "r") as f:
            return f.read()

    # Default: Ace Editor with Monokai theme
    ace_mode = {
        "python": "python",
        "javascript": "javascript",
        "typescript": "typescript",
        "sql": "sql",
        "java": "java",
        "c": "c_cpp",
        "cpp": "c_cpp",
        "html": "html",
        "css": "css",
    }.get(language, "text")

    return f'''<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ margin: 0; background-color: #272822; }}
        #editor {{
            position: absolute;
            top: 0; right: 0; bottom: 0; left: 0;
            font-size: 28px;
        }}
    </style>
</head>
<body>
    <div id="editor"></div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.7/ace.js"></script>
    <script>
        var editor = ace.edit("editor");
        editor.setTheme("ace/theme/monokai");
        editor.session.setMode("ace/mode/{ace_mode}");
        editor.setShowPrintMargin(false);
        editor.setFontSize(28);
    </script>
</body>
</html>'''


def _convert_webm_to_mp4(webm_path: str, mp4_path: str) -> None:
    """Convert WebM to MP4 using FFmpeg."""
    cmd = [
        "ffmpeg", "-y",
        "-i", webm_path,
        "-c:v", "libx264", "-preset", "medium", "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        mp4_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        raise RuntimeError(f"WebM→MP4 conversion failed: {result.stderr[-200:]}")
