"""
Video Generation Worker — Configuration
Environment variables, constants, and resolution mapping.

API keys come from the NestJS backend job payload (single source of truth).
Env vars are only used as fallback for local development.
"""
import os
from dataclasses import dataclass, field
from typing import Dict, Tuple, Optional

# ── Force software OpenGL rendering (ManimCE needs this on headless servers) ──
os.environ.setdefault("LIBGL_ALWAYS_SOFTWARE", "1")

# ── Redis (worker's own connection — the only config vid-worker needs) ──
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
REDIS_JOB_QUEUE = "video-gen:jobs"
REDIS_PROGRESS_PREFIX = "video-gen:progress:"
REDIS_DONE_PREFIX = "video-gen:done:"

# ── Paths ──
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMP_DIR = os.path.join(BASE_DIR, "tmp")
MANIM_DIR = os.getenv("MANIM_DIR", "/home/moodle/vid_create/manim")
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")
IDE_TEMPLATES_DIR = os.path.join(BASE_DIR, "ide_templates")

# ── FFmpeg ──
FFMPEG_BIN = os.getenv("FFMPEG_BIN", "ffmpeg")
FFPROBE_BIN = os.getenv("FFPROBE_BIN", "ffprobe")

# ── Manim ──
XVFB_RUN = "xvfb-run -s '-screen 0 {width}x{height}x24'"
MANIMGL_CMD = "manimgl {file} {scene} -w {quality_flag}"

# ── Resolution Map ──
@dataclass
class ResolutionConfig:
    width: int
    height: int
    manim_flag: str
    label: str

RESOLUTIONS: Dict[str, ResolutionConfig] = {
    "480p": ResolutionConfig(854, 480, "-l", "Low"),
    "720p": ResolutionConfig(1280, 720, "-m", "Medium"),
    "1080p": ResolutionConfig(1920, 1080, "--hd", "HD"),
    "4k": ResolutionConfig(3840, 2160, "--uhd", "UHD"),
}

# Vertical variants (swap w/h)
RESOLUTIONS_VERTICAL: Dict[str, ResolutionConfig] = {
    k: ResolutionConfig(v.height, v.width, v.manim_flag, v.label)
    for k, v in RESOLUTIONS.items()
}

def get_resolution(resolution: str, format: str = "horizontal") -> ResolutionConfig:
    """Get resolution config based on format."""
    table = RESOLUTIONS if format == "horizontal" else RESOLUTIONS_VERTICAL
    return table.get(resolution, RESOLUTIONS["1080p"])

# ── Narration Speed ──
SPEED_OPTIONS = [0.8, 1.0, 1.2, 1.5]

# ── Retry & Limits ──
MAX_SCENE_RETRY = 1
MAX_TTS_RETRY = 3
RENDER_TIMEOUT_SEC = 600  # Increased to 10 minutes for complex ManimGL 3D scenes
MAX_SCENE_DURATION_SEC = 120

# ── Ensure temp dir exists ──
os.makedirs(TEMP_DIR, exist_ok=True)


# ═══════════════════════════════════════════════════════════════
# JobConfig: API keys from NestJS backend job payload
# ═══════════════════════════════════════════════════════════════

@dataclass
class JobConfig:
    """
    Parsed API configuration from the NestJS backend job payload.
    The backend is the single source of truth for API keys — worker
    just reads what it receives. Env vars are only fallbacks for dev.
    """
    # Gemini
    gemini_api_key: str = ""

    # CLIProxy (priority 1 — OpenAI-compatible proxy)
    cliproxy_enabled: bool = False
    cliproxy_url: str = ""
    cliproxy_api_key: str = ""
    cliproxy_text_model: str = ""
    cliproxy_image_model: str = ""
    cliproxy_tts_model: str = ""

    # ImageGen (Flux.1-dev / ComfyUI — OpenAI Images API compatible)
    imagegen_enabled: bool = False
    imagegen_url: str = ""
    imagegen_api_key: str = ""
    imagegen_model: str = ""
    imagegen_steps: int = 20

    # viTTS
    vitts_base_url: str = "http://117.0.36.6:8888"
    vitts_api_key: str = ""
    vitts_voice: str = ""  # User's saved TTS voice, e.g., 'vitts:ref:UUID'

    # MinIO
    minio_endpoint: str = "localhost"
    minio_port: int = 9000
    minio_access_key: str = ""
    minio_secret_key: str = ""
    minio_bucket: str = "ai-teaching"
    minio_secure: bool = False

    @classmethod
    def from_job_payload(cls, job: dict) -> "JobConfig":
        """
        Extract API config from the NestJS backend job payload.
        Falls back to env vars for local dev convenience.
        """
        api_keys = job.get("apiKeys", {})

        cliproxy = api_keys.get("cliproxy", {})
        imagegen = api_keys.get("imageGen", {})
        vitts = api_keys.get("vitts", {})
        minio = api_keys.get("minio", {})

        return cls(
            # Gemini
            gemini_api_key=api_keys.get("gemini", "") or os.getenv("GEMINI_API_KEY", ""),

            # CLIProxy
            cliproxy_enabled=cliproxy.get("enabled", False),
            cliproxy_url=cliproxy.get("url", "") or os.getenv("CLIPROXY_URL", ""),
            cliproxy_api_key=cliproxy.get("apiKey", "") or os.getenv("CLIPROXY_API_KEY", ""),
            cliproxy_text_model=cliproxy.get("defaultTextModel", ""),
            cliproxy_image_model=cliproxy.get("defaultImageModel", ""),
            cliproxy_tts_model=cliproxy.get("defaultTTSModel", ""),

            # ImageGen
            imagegen_enabled=imagegen.get("enabled", False),
            imagegen_url=imagegen.get("url", "") or os.getenv("IMAGE_GEN_URL", ""),
            imagegen_api_key=imagegen.get("apiKey", "") or os.getenv("IMAGE_GEN_API_KEY", ""),
            imagegen_model=imagegen.get("defaultModel", "flux-image"),
            imagegen_steps=imagegen.get("steps", 20),

            # viTTS
            vitts_base_url=vitts.get("baseUrl", "") or os.getenv("VITTS_BASE_URL", "http://117.0.36.6:8888"),
            vitts_api_key=vitts.get("apiKey", "") or os.getenv("VITTS_API_KEY", ""),
            vitts_voice=vitts.get("voice", ""),

            # MinIO
            minio_endpoint=minio.get("endpoint", "") or os.getenv("MINIO_ENDPOINT", "localhost"),
            minio_port=minio.get("port", 9000) or int(os.getenv("MINIO_PORT", "9000")),
            minio_access_key=minio.get("accessKey", "") or os.getenv("MINIO_ACCESS_KEY", ""),
            minio_secret_key=minio.get("secretKey", "") or os.getenv("MINIO_SECRET_KEY", ""),
            minio_bucket=minio.get("bucket", "") or os.getenv("MINIO_BUCKET", "ai-teaching"),
            minio_secure=os.getenv("MINIO_SECURE", "false").lower() == "true",
        )

    @property
    def effective_text_api(self) -> dict:
        """Get the best available text generation API config (CLIProxy > Gemini)."""
        if self.cliproxy_enabled and self.cliproxy_url:
            return {
                "provider": "cliproxy",
                "url": self.cliproxy_url,
                "api_key": self.cliproxy_api_key,
                "model": self.cliproxy_text_model,
            }
        return {
            "provider": "gemini",
            "api_key": self.gemini_api_key,
        }

    @property
    def effective_image_api(self) -> dict:
        """Get the best available image generation API config."""
        if self.cliproxy_enabled and self.cliproxy_image_model:
            return {
                "provider": "cliproxy",
                "url": self.cliproxy_url,
                "api_key": self.cliproxy_api_key,
                "model": self.cliproxy_image_model,
            }
        if self.imagegen_enabled and self.imagegen_url:
            return {
                "provider": "imagegen",
                "url": self.imagegen_url,
                "api_key": self.imagegen_api_key,
                "model": self.imagegen_model,
                "steps": self.imagegen_steps,
            }
        return {
            "provider": "gemini",
            "api_key": self.gemini_api_key,
        }

