"""
viTTS Python SDK - Simple client for viTTS API

Usage:
    from vitts_client import ViTTSClient
    
    client = ViTTSClient(api_key="vitts_your_api_key_here")
    
    # Text-to-speech with system voice
    audio = client.synthesize("Xin chào thế giới", voice_id="male")
    
    # Save to file
    with open("output.wav", "wb") as f:
        f.write(audio)
"""

import requests
from typing import Optional, List, Dict, Any
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Reference:
    """User reference audio info."""
    id: int
    name: str
    text: str
    duration: float
    language: str
    created_at: Optional[str] = None


@dataclass
class TrainedVoice:
    """Trained voice info."""
    id: int
    name: str
    engine: str
    status: str
    language: Optional[str] = None


class ViTTSClient:
    """
    viTTS API Client
    
    Supports both system voices and custom trained voices.
    """
    
    def __init__(
        self, 
        api_key: str, 
        base_url: str = "https://vitts.hoclieu.id.vn"
    ):
        """
        Initialize viTTS client.
        
        Args:
            api_key: Your viTTS API key (starts with 'vitts_')
            base_url: API base URL (default: https://vitts.hoclieu.id.vn)
        """
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.headers = {"X-API-Key": api_key}
    
    def _request(
        self, 
        method: str, 
        endpoint: str, 
        **kwargs
    ) -> requests.Response:
        """Make API request with error handling."""
        url = f"{self.base_url}/api/v1{endpoint}"
        
        # Add auth header
        headers = kwargs.pop("headers", {})
        headers.update(self.headers)
        
        response = requests.request(method, url, headers=headers, **kwargs)
        
        if response.status_code == 401:
            raise ValueError("Invalid API key")
        elif response.status_code == 404:
            raise ValueError(f"Resource not found: {endpoint}")
        elif response.status_code >= 400:
            try:
                detail = response.json().get("detail", response.text)
            except:
                detail = response.text
            raise ValueError(f"API error ({response.status_code}): {detail}")
        
        return response
    
    # ==================
    # TTS Endpoints
    # ==================
    
    def synthesize(
        self,
        text: str,
        voice_id: str = "male",
        speed: float = 1.0,
        nfe_step: int = 32,
        cfg_strength: float = 2.0,
        multilingual_mode: Optional[str] = None,
    ) -> bytes:
        """
        Synthesize text to speech.
        
        Args:
            text: Text to synthesize
            voice_id: Voice ID - "male", "female", or "trained_<id>"
            speed: Speech speed (0.5 - 2.0)
            nfe_step: NFE steps (8-64, higher = better quality)
            cfg_strength: CFG strength (1.0-3.0)
            multilingual_mode: "auto", "syllable", or "english"
        
        Returns:
            WAV audio bytes
        
        Example:
            audio = client.synthesize("Hello world", voice_id="female")
            with open("output.wav", "wb") as f:
                f.write(audio)
        """
        data = {
            "text": text,
            "voice_id": voice_id,
            "speed": speed,
            "nfe_step": nfe_step,
            "cfg_strength": cfg_strength,
        }
        
        if multilingual_mode:
            data["multilingual_mode"] = multilingual_mode
        
        response = self._request("POST", "/tts/synthesize", json=data)
        return response.content
    
    def synthesize_with_ref(
        self,
        text: str,
        ref_id: int,
        speed: float = 1.0,
        nfe_step: int = 32,
        cfg_strength: float = 2.0,
        multilingual_mode: Optional[str] = None,
    ) -> bytes:
        """
        Synthesize text using a saved reference audio.
        
        Args:
            text: Text to synthesize
            ref_id: Reference ID (from list_refs())
            speed: Speech speed
            nfe_step: NFE steps
            cfg_strength: CFG strength
            multilingual_mode: Multilingual mode
        
        Returns:
            WAV audio bytes
        
        Example:
            refs = client.list_refs()
            if refs:
                audio = client.synthesize_with_ref("Hello", ref_id=refs[0].id)
        """
        data = {
            "text": text,
            "ref_id": ref_id,
            "speed": speed,
            "nfe_step": nfe_step,
            "cfg_strength": cfg_strength,
        }
        
        if multilingual_mode:
            data["multilingual_mode"] = multilingual_mode
        
        response = self._request("POST", "/tts/synthesize-with-saved-ref", data=data)
        return response.content
    
    def list_voices(self) -> List[Dict[str, Any]]:
        """
        List available system voices.
        
        Returns:
            List of voice info dicts
        
        Example:
            voices = client.list_voices()
            for v in voices:
                print(f"{v['id']}: {v['name']}")
        """
        response = self._request("GET", "/tts/voices")
        return response.json()
    
    def list_models(self) -> List[Dict[str, Any]]:
        """
        List available TTS model checkpoints.
        
        Returns:
            List of model info dicts
        """
        response = self._request("GET", "/tts/models")
        return response.json()
    
    # ==================
    # References Endpoints
    # ==================
    
    def list_refs(self, language: Optional[str] = None) -> List[Reference]:
        """
        List your saved reference audio files.
        
        Args:
            language: Filter by language ("vi" or "en")
        
        Returns:
            List of Reference objects
        
        Example:
            refs = client.list_refs(language="en")
            for ref in refs:
                print(f"{ref.id}: {ref.name} ({ref.duration:.1f}s)")
        """
        params = {}
        if language:
            params["language"] = language
        
        response = self._request("GET", "/refs", params=params)
        return [Reference(**r) for r in response.json()]
    
    def get_ref(self, ref_id: int) -> Reference:
        """Get a specific reference by ID."""
        response = self._request("GET", f"/refs/{ref_id}")
        return Reference(**response.json())
    
    def get_ref_audio(self, ref_id: int) -> bytes:
        """
        Download reference audio file.
        
        Args:
            ref_id: Reference ID
        
        Returns:
            WAV audio bytes
        """
        response = self._request("GET", f"/refs/{ref_id}/audio")
        return response.content
    
    def delete_ref(self, ref_id: int) -> bool:
        """Delete a reference audio."""
        self._request("DELETE", f"/refs/{ref_id}")
        return True
    
    # ==================
    # Trained Voices
    # ==================
    
    def list_trained_voices(self) -> List[TrainedVoice]:
        """
        List your trained voices.
        
        Returns:
            List of TrainedVoice objects
        
        Example:
            voices = client.list_trained_voices()
            for v in voices:
                print(f"trained_{v.id}: {v.name}")
        """
        response = self._request("GET", "/users/voices")
        return [
            TrainedVoice(
                id=v["id"],
                name=v["name"],
                engine=v.get("engine", "f5tts"),
                status=v.get("status", "active"),
                language=v.get("language"),
            )
            for v in response.json()
        ]
    
    def synthesize_with_trained_voice(
        self,
        text: str,
        voice_id: int,
        speed: float = 1.0,
        nfe_step: int = 32,
        multilingual_mode: Optional[str] = None,
    ) -> bytes:
        """
        Synthesize using a trained voice.
        
        Args:
            voice_id: Trained voice ID (from list_trained_voices())
            text: Text to synthesize
            speed: Speech speed
            nfe_step: NFE steps
            multilingual_mode: Multilingual mode
        
        Returns:
            WAV audio bytes
        
        Example:
            voices = client.list_trained_voices()
            if voices:
                audio = client.synthesize_with_trained_voice(
                    text="Hello",
                    voice_id=voices[0].id
                )
        """
        return self.synthesize(
            text=text,
            voice_id=f"trained_{voice_id}",
            speed=speed,
            nfe_step=nfe_step,
            multilingual_mode=multilingual_mode,
        )
    
    # ==================
    # Utility Methods
    # ==================
    
    def save_audio(self, audio_bytes: bytes, filepath: str) -> str:
        """
        Save audio bytes to file.
        
        Args:
            audio_bytes: WAV audio bytes
            filepath: Output file path
        
        Returns:
            Absolute path to saved file
        """
        path = Path(filepath)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(audio_bytes)
        return str(path.absolute())


# ==================
# Quick Usage Example
# ==================

if __name__ == "__main__":
    # Example usage
    API_KEY = "vitts_your_api_key_here"
    
    client = ViTTSClient(api_key=API_KEY)
    
    # List available options
    print("=== System Voices ===")
    for voice in client.list_voices():
        print(f"  {voice['id']}: {voice['name']}")
    
    print("\n=== Your References ===")
    try:
        for ref in client.list_refs():
            print(f"  ID {ref.id}: {ref.name} ({ref.language}, {ref.duration:.1f}s)")
    except Exception as e:
        print(f"  Error: {e}")
    
    print("\n=== Your Trained Voices ===")
    try:
        for voice in client.list_trained_voices():
            print(f"  trained_{voice.id}: {voice.name} ({voice.engine})")
    except Exception as e:
        print(f"  Error: {e}")
    
    # Synthesize example
    print("\n=== Synthesizing... ===")
    try:
        audio = client.synthesize("Xin chào thế giới", voice_id="male")
        client.save_audio(audio, "output.wav")
        print(f"  Saved to output.wav ({len(audio)} bytes)")
    except Exception as e:
        print(f"  Error: {e}")
