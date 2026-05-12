"""
Imagen Renderer — Generate image using AI then render as video with Ken Burns.
Supports: CLIProxy image models, ImageGen (Flux), Gemini Imagen.
Falls back to placeholder if API is unavailable.
"""
import os
import base64
import logging
import time
from typing import Dict, Any, Optional
from config import TEMP_DIR
from .static_renderer import render_static

logger = logging.getLogger(__name__)


def render_imagen(
    scene: Dict[str, Any],
    duration: float = 10.0,
    resolution: str = "1080p",
    format: str = "horizontal",
    output_path: Optional[str] = None,
    job_config: "JobConfig" = None,
) -> str:
    """
    Generate image via AI API, then render to video with Ken Burns.
    Uses CLIProxy > ImageGen (Flux) > Gemini as priority order.

    Args:
        scene: Scene dict with image_prompt
        duration: Video duration in seconds
        resolution: Target resolution
        format: horizontal or vertical
        output_path: Output file path
        job_config: JobConfig with API keys for image generation

    Returns:
        Path to rendered MP4 clip
    """
    image_prompt = scene.get("image_prompt", "")

    if image_prompt and job_config:
        try:
            image_path = _generate_image(image_prompt, job_config, resolution, format)
            scene_with_image = {**scene, "image_path": image_path}
            return render_static(scene_with_image, duration, resolution, format, output_path)
        except Exception as e:
            logger.warning(f"Image generation failed, using fallback: {e}")

    # Fallback: render as static with placeholder
    logger.info("Using placeholder for imagen scene")
    return render_static(scene, duration, resolution, format, output_path)


def _generate_image(prompt: str, job_config: "JobConfig", resolution: str, format: str) -> str:
    """Generate an image using the best available API provider."""
    from config import get_resolution, JobConfig

    image_api = job_config.effective_image_api
    provider = image_api.get("provider", "")

    # ── Try CLIProxy (OpenAI-compatible) ──
    if provider == "cliproxy" and image_api.get("url") and image_api.get("model"):
        return _generate_via_openai_api(
            prompt=prompt,
            url=image_api["url"],
            api_key=image_api.get("api_key", ""),
            model=image_api["model"],
            format=format,
        )

    # ── Try ImageGen / Flux (OpenAI Images API compatible) ──
    if provider == "imagegen" and image_api.get("url"):
        return _generate_via_openai_api(
            prompt=prompt,
            url=image_api["url"],
            api_key=image_api.get("api_key", ""),
            model=image_api.get("model", "flux-image"),
            format=format,
            steps=image_api.get("steps", 20),
        )

    # ── Fallback: Gemini SDK ──
    api_key = image_api.get("api_key", "") or job_config.gemini_api_key
    if api_key:
        return _generate_via_gemini(prompt, api_key, format)

    raise RuntimeError("No image generation API configured")


def _generate_via_openai_api(
    prompt: str, url: str, api_key: str, model: str,
    format: str = "horizontal", steps: int = 20,
) -> str:
    """
    Generate image via OpenAI Images API compatible endpoint.
    Works with CLIProxy and ImageGen/Flux.
    """
    import requests

    size = "1792x1024" if format == "horizontal" else "1024x1792"

    payload = {
        "model": model,
        "prompt": prompt,
        "n": 1,
        "size": size,
    }
    # Add steps for ImageGen/Flux (not standard OpenAI param)
    if steps and steps != 20:
        payload["steps"] = steps

    response = requests.post(
        f"{url.rstrip('/')}/v1/images/generations",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=120,
    )
    response.raise_for_status()
    data = response.json()

    image_data = data.get("data", [{}])[0]
    image_path = os.path.join(TEMP_DIR, f"imagen_{int(time.time()*1000)}.png")

    if "b64_json" in image_data:
        # Base64 encoded image
        img_bytes = base64.b64decode(image_data["b64_json"])
        with open(image_path, "wb") as f:
            f.write(img_bytes)
    elif "url" in image_data:
        # URL to download — handle localhost rewrite
        img_url = image_data["url"]
        if "localhost" in img_url and url:
            # Rewrite localhost URL to actual API host
            from urllib.parse import urlparse
            parsed_api = urlparse(url)
            parsed_img = urlparse(img_url)
            img_url = f"{parsed_api.scheme}://{parsed_api.netloc}{parsed_img.path}"

        img_response = requests.get(img_url, timeout=30)
        img_response.raise_for_status()
        with open(image_path, "wb") as f:
            f.write(img_response.content)
    else:
        raise RuntimeError("No image data in API response")

    logger.info(f"Image generated via OpenAI API: {image_path}")
    return image_path


def _generate_via_gemini(prompt: str, api_key: str, format: str) -> str:
    """Generate image via Gemini SDK using generateContent with IMAGE modality."""
    try:
        from google import genai

        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model="gemini-2.5-flash-image",
            contents=prompt,
            config=genai.types.GenerateContentConfig(
                response_modalities=["IMAGE", "TEXT"],
            ),
        )

        # Extract image from response
        for part in response.candidates[0].content.parts:
            if hasattr(part, "inline_data") and part.inline_data:
                image_path = os.path.join(TEMP_DIR, f"imagen_{int(time.time()*1000)}.png")
                with open(image_path, "wb") as f:
                    f.write(part.inline_data.data)
                logger.info(f"Image generated via Gemini SDK: {image_path}")
                return image_path

    except ImportError:
        logger.warning("google-genai not available, trying legacy SDK")
        # Try legacy SDK as last resort
        try:
            import google.generativeai as genai_legacy
            genai_legacy.configure(api_key=api_key)
            imagen = genai_legacy.ImageGenerationModel("imagen-3.0-generate-002")
            result = imagen.generate_images(
                prompt=prompt,
                number_of_images=1,
                aspect_ratio="16:9" if format == "horizontal" else "9:16",
            )
            if result.images:
                image_path = os.path.join(TEMP_DIR, f"imagen_{int(time.time()*1000)}.png")
                result.images[0].save(image_path)
                return image_path
        except Exception as e:
            logger.error(f"Legacy Gemini SDK also failed: {e}")

    except Exception as e:
        logger.error(f"Gemini image generation error: {e}")

    raise RuntimeError("Gemini image generation failed")
