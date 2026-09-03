"""
Video Generation Worker — TTS Client
Wrapper for viTTS API to synthesize speech.
Supports Vietnamese and English, speed control, voice selection.
API config comes from JobConfig (passed by NestJS backend).
"""
import os
import io
import time
import logging
import requests
from typing import Tuple, Optional
from config import MAX_TTS_RETRY, TEMP_DIR

logger = logging.getLogger(__name__)


class TTSClient:
    """Client for viTTS text-to-speech API."""

    def __init__(self, base_url: str = "", api_key: str = ""):
        self.base_url = base_url.rstrip("/") if base_url else ""
        self.api_key = api_key
        self.session = requests.Session()
        if self.api_key:
            self.session.headers["X-API-Key"] = self.api_key

    def synthesize(
        self,
        text: str,
        lang: str = "vi",
        speed: float = 1.0,
        voice: str = "female",
        output_path: Optional[str] = None,
    ) -> Tuple[str, float]:
        """
        Synthesize text to speech.

        Args:
            text: Text to synthesize
            lang: Language (vi/en)
            speed: Speech speed (0.8-1.5)
            voice: Voice type (male/female)
            output_path: Where to save WAV file (auto-generated if None)

        Returns:
            Tuple of (wav_file_path, duration_seconds)
        """
        if not text.strip():
            logger.warning("Empty text, skipping TTS")
            return self._create_silence(2.0, output_path)

        speed = max(0.5, min(2.0, speed))

        payload = {
            "text": text,
            "language": lang,
            "speed": speed,
            "voice": voice,
            "format": "wav",
        }

        for attempt in range(MAX_TTS_RETRY):
            try:
                # If using ViTTS
                if "vitts" in self.base_url or "192.168" in self.base_url:
                    mode = "auto"
                    ref_id = ""
                    instruct = "female, clear"

                    if voice.startswith("vitts:ref:"):
                        mode = "clone"
                        ref_id = voice.replace("vitts:ref:", "")
                    elif voice == "vitts:design":
                        mode = "design"
                    elif voice.startswith("vitts:"):
                        # Just in case they pass vitts:male or vitts:female
                        mode = "auto"

                    response = None
                    if mode == "clone" and ref_id:
                        vitts_payload = {
                            "text": text,
                            "ref_id": ref_id,
                            "speed": speed,
                            "num_step": 32,
                            "normalize": "false"
                        }
                        response = self.session.post(
                            f"{self.base_url}/api/v1/omnivoice/generate-clone-ref",
                            data=vitts_payload,
                            timeout=60,
                        )
                    elif mode == "design":
                        vitts_payload = {
                            "text": text,
                            "instruct": instruct,
                            "speed": speed,
                            "num_step": 32,
                            "normalize": False
                        }
                        response = self.session.post(
                            f"{self.base_url}/api/v1/omnivoice/generate-design",
                            json=vitts_payload,
                            timeout=60,
                        )
                    else:
                        vitts_payload = {
                            "text": text,
                            "speed": speed,
                            "num_step": 32,
                            "normalize": False
                        }
                        response = self.session.post(
                            f"{self.base_url}/api/v1/omnivoice/generate-auto",
                            json=vitts_payload,
                            timeout=60,
                        )
                    
                    response.raise_for_status()
                    job_id = response.json().get("job_id")
                    if not job_id:
                        raise ValueError("No job_id returned from ViTTS OmniVoice")

                    # Poll for completion
                    audio_url = None
                    start_time = time.time()
                    while time.time() - start_time < 180:
                        time.sleep(2)
                        status_resp = self.session.get(f"{self.base_url}/api/v1/omnivoice/jobs/{job_id}", timeout=10)
                        status_resp.raise_for_status()
                        job_data = status_resp.json()
                        status = job_data.get("status")

                        if status in ["completed", "done"]:
                            audio_url = job_data.get("audio_url")
                            break
                        if status in ["failed", "error"]:
                            raise ValueError(f"ViTTS job failed: {job_data.get('error')}")

                    if not audio_url:
                        raise TimeoutError("ViTTS OmniVoice job timed out")

                    # Download audio
                    full_url = audio_url if audio_url.startswith("http") else f"{self.base_url}{audio_url}"
                    audio_resp = self.session.get(full_url, timeout=60)
                    audio_resp.raise_for_status()
                    audio_content = audio_resp.content

                else:
                    # Legacy or other TTS provider
                    response = self.session.post(
                        f"{self.base_url}/api/tts",
                        json=payload,
                        timeout=60,
                    )
                    response.raise_for_status()
                    
                    content_type = response.headers.get("content-type", "")
                    if "application/json" in content_type.lower():
                        raise ValueError(f"TTS API returned JSON instead of audio: {response.text}")
                    audio_content = response.content

                if not output_path:
                    output_path = os.path.join(
                        TEMP_DIR, f"tts_{int(time.time()*1000)}.wav"
                    )

                with open(output_path, "wb") as f:
                    f.write(audio_content)

                duration = self._get_wav_duration(output_path)
                logger.info(f"TTS OK: {len(text)} chars → {duration:.1f}s @ {speed}x")
                return output_path, duration

            except requests.RequestException as e:
                logger.warning(f"TTS attempt {attempt+1}/{MAX_TTS_RETRY} failed: {e}")
                if attempt < MAX_TTS_RETRY - 1:
                    time.sleep(2 ** attempt)
            except Exception as e:
                logger.warning(f"TTS attempt {attempt+1}/{MAX_TTS_RETRY} error: {e}")
                if attempt < MAX_TTS_RETRY - 1:
                    time.sleep(2 ** attempt)

        logger.error(f"TTS failed after {MAX_TTS_RETRY} attempts, using silence")
        return self._create_silence(max(5.0, len(text) * 0.08), output_path)

    def _get_wav_duration(self, path: str) -> float:
        """Get WAV file duration using ffprobe."""
        import subprocess
        try:
            result = subprocess.run(
                ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", path],
                capture_output=True, text=True, timeout=10
            )
            return float(result.stdout.strip())
        except Exception:
            # Fallback: estimate from file size (16-bit, 22050Hz, mono)
            size = os.path.getsize(path)
            return size / (22050 * 2)

    def _create_silence(self, duration: float, output_path: Optional[str] = None) -> Tuple[str, float]:
        """Create a silent WAV file as fallback."""
        import subprocess
        if not output_path:
            output_path = os.path.join(TEMP_DIR, f"silence_{int(time.time()*1000)}.wav")
        subprocess.run(
            ["ffmpeg", "-y", "-f", "lavfi", "-i",
             f"anullsrc=r=22050:cl=mono", "-t", str(duration),
             output_path],
            capture_output=True, timeout=30
        )
        return output_path, duration
