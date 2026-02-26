"""
PPTX Generator Service
FastAPI server for generating PowerPoint presentations from templates
"""

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict
import tempfile
import os
import logging

logger = logging.getLogger("pptx-generator")

from pptx_service import PPTXGeneratorService

# VietNormalizer for TTS text normalization (local clone)
import sys
from pathlib import Path
_VIETNORMALIZER_PATH = str(Path(__file__).parent / "vietnormalizer")
if _VIETNORMALIZER_PATH not in sys.path:
    sys.path.insert(0, _VIETNORMALIZER_PATH)

try:
    from vietnormalizer import VietnameseNormalizer
    _default_normalizer = VietnameseNormalizer()
    logger.info(f"VietNormalizer loaded from local clone: {_VIETNORMALIZER_PATH}")
except ImportError as e:
    _default_normalizer = None
    logger.warning(f"vietnormalizer failed to load: {e}")

app = FastAPI(
    title="PPTX Generator Service",
    description="Generate PowerPoint presentations from templates with content, images, and audio",
    version="1.0.0"
)

# CORS for NestJS backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize service
pptx_service = PPTXGeneratorService()


# ========================
# Text Normalization Models
# ========================

class DictEntry(BaseModel):
    original: str
    replacement: str

class NormalizeRequest(BaseModel):
    text: str
    enable_transliteration: bool = True
    custom_acronyms: Optional[List[DictEntry]] = None
    custom_words: Optional[List[DictEntry]] = None

class NormalizeResponse(BaseModel):
    normalized_text: str
    original_text: str
    changes_made: bool


class SlideContent(BaseModel):
    slideIndex: int
    title: str
    content: List[str] = []
    bullets: Optional[List[dict]] = None  # Structured bullets from AI
    imagePath: Optional[str] = None
    audioPath: Optional[str] = None
    speakerNote: Optional[str] = None
    slideType: Optional[str] = "content"


class GeneratePPTXRequest(BaseModel):
    templatePath: str
    lessonTitle: str
    slides: List[SlideContent]
    titleBgPath: Optional[str] = None     # Background image for title slide
    contentBgPath: Optional[str] = None   # Background image for content slides


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "ok",
        "service": "pptx-generator",
        "normalizer_available": _default_normalizer is not None,
    }


# In-memory dictionary cache (loaded from DB via /reload-dictionaries)
_cached_acronyms: dict = {}
_cached_words: dict = {}


class ReloadDictionariesRequest(BaseModel):
    acronyms: List[DictEntry] = []
    words: List[DictEntry] = []


@app.post("/reload-dictionaries")
async def reload_dictionaries(request: ReloadDictionariesRequest):
    """
    Reload dictionaries from DB (called by NestJS on startup or when admin changes).
    Replaces all cached dictionaries in memory.
    """
    global _cached_acronyms, _cached_words

    _cached_acronyms = {e.original.lower(): e.replacement for e in request.acronyms}
    _cached_words = {e.original.lower(): e.replacement for e in request.words}

    logger.info(f"Dictionaries reloaded: {len(_cached_acronyms)} acronyms, {len(_cached_words)} words")
    return {
        "status": "ok",
        "acronyms_count": len(_cached_acronyms),
        "words_count": len(_cached_words),
    }


@app.post("/normalize", response_model=NormalizeResponse)
async def normalize_text(request: NormalizeRequest):
    """
    Normalize Vietnamese text for TTS.
    Uses cached DB dictionaries + optional per-request user overrides.
    """
    if _default_normalizer is None:
        raise HTTPException(
            status_code=503,
            detail="vietnormalizer is not installed"
        )

    try:
        normalizer = _default_normalizer

        # Build merged dicts: cached system + per-request user overrides
        merged_acronyms = dict(_cached_acronyms)
        merged_words = dict(_cached_words)

        if request.custom_acronyms:
            for entry in request.custom_acronyms:
                merged_acronyms[entry.original.lower()] = entry.replacement

        if request.custom_words:
            for entry in request.custom_words:
                merged_words[entry.original.lower()] = entry.replacement

        # Temporarily swap dicts on normalizer
        original_acronym_map = normalizer.acronym_map
        original_non_viet_map = normalizer.non_vietnamese_map
        original_replacements = normalizer.replacements

        try:
            normalizer.acronym_map = merged_acronyms
            normalizer.non_vietnamese_map = merged_words
            normalizer.replacements = {k: v for k, v in merged_words.items()}

            normalized = normalizer.normalize(
                request.text,
                enable_transliteration=request.enable_transliteration,
            )
        finally:
            normalizer.acronym_map = original_acronym_map
            normalizer.non_vietnamese_map = original_non_viet_map
            normalizer.replacements = original_replacements

        return NormalizeResponse(
            normalized_text=normalized,
            original_text=request.text,
            changes_made=normalized != request.text,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Normalization failed: {str(e)}")


@app.get("/templates")
async def list_templates():
    """List available system templates"""
    templates = pptx_service.get_available_templates()
    return {"templates": templates}


@app.post("/generate")
async def generate_pptx(request: GeneratePPTXRequest):
    """
    Generate a PPTX file from template and content
    Returns the generated PPTX file
    """
    try:
        # Generate PPTX
        output_path = pptx_service.generate_presentation(
            template_path=request.templatePath,
            lesson_title=request.lessonTitle,
            slides=[s.model_dump() for s in request.slides],
            title_bg_path=request.titleBgPath,
            content_bg_path=request.contentBgPath
        )
        
        # Return the file
        return FileResponse(
            path=output_path,
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            filename=f"{request.lessonTitle}.pptx"
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate PPTX: {str(e)}")


@app.post("/generate-buffer")
async def generate_pptx_buffer(request: GeneratePPTXRequest):
    """
    Generate a PPTX file and return as base64 buffer
    Alternative to /generate for easier integration
    """
    import base64
    
    try:
        output_path = pptx_service.generate_presentation(
            template_path=request.templatePath,
            lesson_title=request.lessonTitle,
            slides=[s.model_dump() for s in request.slides],
            title_bg_path=request.titleBgPath,
            content_bg_path=request.contentBgPath
        )
        
        with open(output_path, 'rb') as f:
            buffer = base64.b64encode(f.read()).decode('utf-8')
        
        # Cleanup temp file
        os.unlink(output_path)
        
        return {
            "buffer": buffer,
            "filename": f"{request.lessonTitle}.pptx"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate PPTX: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3002)
