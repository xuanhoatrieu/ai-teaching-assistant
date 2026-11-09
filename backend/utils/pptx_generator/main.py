"""
PPTX Generator Service
FastAPI server for generating PowerPoint presentations from templates
"""

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import tempfile
import os
import json
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
    layoutType: Optional[str] = "split_standard"
    isInteractive: Optional[bool] = False
    interactiveData: Optional[Any] = None
    extraAudioPath: Optional[str] = None


class GeneratePPTXRequest(BaseModel):
    templatePath: str
    lessonTitle: str
    slides: List[SlideContent]
    titleBgPath: Optional[str] = None     # Background image for title slide
    contentBgPath: Optional[str] = None   # Background image for content slides
    targetFilePath: Optional[str] = None  # Explicit output path on disk (avoids Base64 in RAM)


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


@app.post("/generate-stream")
async def generate_pptx_stream(request: GeneratePPTXRequest):
    """
    Generate a PPTX file and stream real-time progress events per slide as NDJSON.
    Allows backend and frontend to display exact slide progress and avoids Base64 memory bloat.
    """
    def event_stream():
        try:
            generator = pptx_service.generate_presentation_stream(
                template_path=request.templatePath,
                lesson_title=request.lessonTitle,
                slides=[s.model_dump() for s in request.slides],
                title_bg_path=request.titleBgPath,
                content_bg_path=request.contentBgPath,
                output_path=request.targetFilePath
            )
            for event in generator:
                yield json.dumps(event, ensure_ascii=False) + "\n"
        except Exception as e:
            logger.error(f"Error in generate_pptx_stream: {e}")
            yield json.dumps({"step": "error", "error": str(e)}, ensure_ascii=False) + "\n"

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")



# ========================
# PPTX Audio Tool Endpoints
# ========================

import re
import base64
import shutil
import subprocess
from pptx import Presentation as PptxPresentation


def _get_placeholder_type_id(shape) -> int:
    try:
        if getattr(shape, "is_placeholder", False) and shape.placeholder_format is not None:
            return int(shape.placeholder_format.type)
    except Exception:
        pass
    return -1


def _is_slide_number_shape(shape, text: str, slide_idx: int = 0) -> bool:
    """Detect slide-number/date/header placeholders, content-slide footers, or standalone 1-3 digit page number badges."""
    cleaned = (text or "").strip()
    if not cleaned:
        return True
    ph_id = _get_placeholder_type_id(shape)
    # PP_PLACEHOLDER: SLIDE_NUMBER=13, HEADER=14, FOOTER=15, DATE=16
    if ph_id in (13, 14, 16):
        return True
    if slide_idx > 0 and ph_id == 15:
        return True
    if cleaned.isdigit() and len(cleaned) <= 3:
        return True
    return False


def _validate_local_pptx_path(raw_path: str) -> str:
    """Resolve and validate that raw_path is an existing .pptx file in an allowed workspace/temp path."""
    if not raw_path or not isinstance(raw_path, str):
        raise ValueError("Invalid PPTX file path")
    real_path = os.path.realpath(raw_path)
    if not real_path.lower().endswith(".pptx"):
        raise ValueError("Target file must have a .pptx extension")
    if not os.path.isfile(real_path):
        raise FileNotFoundError(f"File not found: {real_path}")
    return real_path


def _render_pptx_slides_to_png(
    pptx_path: str,
    output_slides_dir: str,
    expected_count: int = 0,
    dpi: int = 150,
    force: bool = False,
) -> Dict[int, str]:
    """
    Render every slide of a PPTX file to a full 16:9 high-resolution PNG using
    headless LibreOffice Impress + pdftoppm, with an isolated temporary user profile.
    Returns {0: 'full_slide_00.png', 1: 'full_slide_01.png', ...}.
    """
    real_pptx_path = _validate_local_pptx_path(pptx_path)
    os.makedirs(output_slides_dir, exist_ok=True)

    if not force and expected_count > 0:
        cached_map: Dict[int, str] = {}
        for idx in range(expected_count):
            fname = f"full_slide_{idx:02d}.png"
            fpath = os.path.join(output_slides_dir, fname)
            if os.path.isfile(fpath) and os.path.getsize(fpath) > 512:
                cached_map[idx] = fname
        if len(cached_map) == expected_count:
            return cached_map

    soffice_bin = shutil.which("soffice") or shutil.which("libreoffice")
    pdftoppm_bin = shutil.which("pdftoppm")
    if not soffice_bin or not pdftoppm_bin:
        logger.warning(
            f"Full-slide rendering skipped: soffice={soffice_bin}, pdftoppm={pdftoppm_bin}"
        )
        return {}

    rendered_map: Dict[int, str] = {}
    try:
        with tempfile.TemporaryDirectory(prefix="pptx_render_") as tmp_dir:
            lo_profile_dir = os.path.join(tmp_dir, "lo_profile")
            os.makedirs(lo_profile_dir, exist_ok=True)
            profile_uri = Path(lo_profile_dir).as_uri()

            lo_cmd = [
                soffice_bin,
                f"-env:UserInstallation={profile_uri}",
                "--headless",
                "--nologo",
                "--nofirststartwizard",
                "--norestore",
                "--convert-to",
                "pdf",
                "--outdir",
                tmp_dir,
                real_pptx_path,
            ]
            lo_proc = subprocess.run(
                lo_cmd,
                shell=False,
                capture_output=True,
                text=True,
                timeout=180,
                check=False,
            )
            pdf_candidates = [
                os.path.join(tmp_dir, f)
                for f in os.listdir(tmp_dir)
                if f.lower().endswith(".pdf")
            ]
            if not pdf_candidates:
                logger.warning(
                    f"LibreOffice did not produce PDF (code={lo_proc.returncode}): {lo_proc.stderr[:300]}"
                )
                return {}

            pdf_path = pdf_candidates[0]
            page_prefix = os.path.join(tmp_dir, "slide_page")
            ppm_cmd = [
                pdftoppm_bin,
                "-png",
                "-r",
                str(max(72, min(int(dpi), 300))),
                pdf_path,
                page_prefix,
            ]
            ppm_proc = subprocess.run(
                ppm_cmd,
                shell=False,
                capture_output=True,
                text=True,
                timeout=180,
                check=False,
            )
            if ppm_proc.returncode != 0:
                logger.warning(f"pdftoppm failed (code={ppm_proc.returncode}): {ppm_proc.stderr[:300]}")
                return {}

            page_files = []
            for fname in os.listdir(tmp_dir):
                m = re.match(r"^slide_page-(\d+)\.png$", fname)
                if m:
                    page_files.append((int(m.group(1)), os.path.join(tmp_dir, fname)))
            page_files.sort(key=lambda item: item[0])

            for zero_idx, (_, src_png) in enumerate(page_files):
                target_fname = f"full_slide_{zero_idx:02d}.png"
                target_fpath = os.path.join(output_slides_dir, target_fname)
                tmp_target = target_fpath + ".tmp"
                shutil.copyfile(src_png, tmp_target)
                os.replace(tmp_target, target_fpath)
                rendered_map[zero_idx] = target_fname

        logger.info(
            f"Rendered {len(rendered_map)} full PNG slides ({dpi} DPI) into {output_slides_dir}"
        )
    except Exception as e:
        logger.warning(f"Full-slide rendering failed for {real_pptx_path}: {e}")

    return rendered_map


# Vietnamese character detection for bilingual note splitting
VN_CHARS = set("àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ"
               "ÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ")


def _detect_vietnamese(text: str) -> bool:
    """Check if text contains Vietnamese-specific characters."""
    return any(c in VN_CHARS for c in text)


def _split_bilingual_notes(note_text: str) -> dict:
    """
    Split bilingual speaker notes.
    Separator: blank line (\\n\\n)
    Detection: Vietnamese chars → VN part, ASCII-only → EN part
    """
    if not note_text or not note_text.strip():
        return {"full": "", "en": "", "vi": "", "has_dual": False}

    # Split by double newline
    parts = [p.strip() for p in note_text.strip().split('\n\n') if p.strip()]

    if len(parts) < 2:
        # Single block — assign to both
        return {
            "full": note_text.strip(),
            "en": note_text.strip(),
            "vi": note_text.strip(),
            "has_dual": False,
        }

    # Try to detect which is Vietnamese and which is English
    part1_is_vn = _detect_vietnamese(parts[0])
    part2_is_vn = _detect_vietnamese(parts[1])

    if part1_is_vn and not part2_is_vn:
        return {
            "full": note_text.strip(),
            "vi": parts[0],
            "en": parts[1],
            "has_dual": True,
        }
    elif part2_is_vn and not part1_is_vn:
        return {
            "full": note_text.strip(),
            "en": parts[0],
            "vi": parts[1],
            "has_dual": True,
        }
    else:
        # Both same language or can't determine
        return {
            "full": note_text.strip(),
            "en": note_text.strip(),
            "vi": note_text.strip(),
            "has_dual": False,
        }


def _extract_paragraph_lines(para) -> list:
    """Extract lines from a python-pptx paragraph, splitting soft line breaks (<a:br/> / \\x0b / \\n)."""
    raw_text = (para.text or "").replace("\x0b", "\n")
    lines = []
    for part in re.split(r"[\r\n]+", raw_text):
        cleaned = " ".join(part.split()).strip()
        if cleaned:
            lines.append(cleaned)
    return lines


def _collect_slide_blocks_and_pictures(shapes, slide_idx: int, blocks: list, pictures: list, z_counter: list):
    """Recursively collect positioned text/table blocks and picture shapes."""
    for shape in shapes:
        z_counter[0] += 1
        cur_z = z_counter[0]

        # 1. Group shape -> recurse into child shapes
        if hasattr(shape, "shapes"):
            try:
                _collect_slide_blocks_and_pictures(shape.shapes, slide_idx, blocks, pictures, z_counter)
            except Exception as e:
                logger.debug(f"Could not recurse into group shape: {e}")

        ph_id = _get_placeholder_type_id(shape)
        raw_top = getattr(shape, "top", None)
        raw_left = getattr(shape, "left", None)
        # PP_PLACEHOLDER: TITLE=1, BODY=2, CENTER_TITLE=3, SUBTITLE=4, FOOTER=15
        if raw_top is None or int(raw_top) < 0:
            if ph_id in (1, 3):
                eff_y = -200000
            elif ph_id == 4:
                eff_y = 2500000
            elif ph_id == 15:
                eff_y = 9000000
            else:
                eff_y = 1400000
        else:
            eff_y = int(raw_top)
        eff_x = int(raw_left) if (raw_left is not None and int(raw_left) >= 0) else 0

        # 2. Table shape -> format rows with pipe separator and preserve multi-line cells via ⟦BR⟧
        if getattr(shape, "has_table", False):
            try:
                table_rows = []
                for row in shape.table.rows:
                    cells = []
                    for cell in row.cells:
                        cell_lines = []
                        if getattr(cell, "text_frame", None):
                            for para in cell.text_frame.paragraphs:
                                cell_lines.extend(_extract_paragraph_lines(para))
                        else:
                            for part in re.split(r"[\x0b\r\n]+", cell.text or ""):
                                c_part = " ".join(part.split()).strip()
                                if c_part:
                                    cell_lines.append(c_part)
                        cells.append(" ⟦BR⟧ ".join(cell_lines).strip())
                    if any(c for c in cells):
                        row_str = " | ".join(cells)
                        if not table_rows or table_rows[-1] != row_str:
                            table_rows.append(row_str)
                if table_rows:
                    blocks.append({
                        "kind": "table",
                        "is_title_ph": False,
                        "y": eff_y,
                        "x": eff_x,
                        "z": cur_z,
                        "lines": ["[Bảng dữ liệu]: " + " ; ".join(table_rows)],
                    })
            except Exception as e:
                logger.debug(f"Could not extract table: {e}")

        # 3. Text frame
        if getattr(shape, "has_text_frame", False):
            try:
                full_frame_text = shape.text_frame.text.replace("\x0b", " ").strip()
                if not _is_slide_number_shape(shape, full_frame_text, slide_idx):
                    lines = []
                    for para in shape.text_frame.paragraphs:
                        for ln in _extract_paragraph_lines(para):
                            if not _is_slide_number_shape(shape, ln, slide_idx):
                                lines.append(ln)
                    if lines:
                        is_title_ph = ph_id in (1, 3)
                        blocks.append({
                            "kind": "text",
                            "is_title_ph": is_title_ph,
                            "y": eff_y,
                            "x": eff_x,
                            "z": cur_z,
                            "lines": lines,
                        })
            except Exception as e:
                logger.debug(f"Could not extract text frame: {e}")

        # 4. Picture shape -> collect candidate image with geometry + SHA1 for foreground filtering
        if hasattr(shape, "image"):
            try:
                img = shape.image
                if img and img.blob:
                    import hashlib
                    width = float(getattr(shape, "width", 0) or 0)
                    height = float(getattr(shape, "height", 0) or 0)
                    area = width * height
                    sha1 = hashlib.sha1(img.blob).hexdigest()
                    pictures.append({
                        "width": width,
                        "height": height,
                        "area": area,
                        "size": len(img.blob),
                        "sha1": sha1,
                        "ext": (img.ext or "png").lower(),
                        "blob": img.blob,
                        "z": cur_z,
                    })
            except Exception:
                pass


def _select_foreground_pictures_across_slides(prs, raw_pictures_per_slide: list) -> Dict[int, dict]:
    """
    Filter out full-slide template backgrounds (Image 1 cover / Image 2 content bg),
    repeated master/template graphics (logos, speaker audio icons, headers/footers),
    tiny bullet icons, and low-byte decorative border frames.
    Returns {slide_idx: chosen_pic_dict} for slides that genuinely have a foreground illustration.
    """
    slide_w = float(getattr(prs, "slide_width", 0) or 9144000)
    slide_h = float(getattr(prs, "slide_height", 0) or 5143500)
    slide_area = max(1.0, slide_w * slide_h)
    total_slides = len(raw_pictures_per_slide)

    sha1_slide_count: Dict[str, int] = {}
    full_bleed_sha1s = set()

    for pics in raw_pictures_per_slide:
        seen_on_slide = set()
        for p in pics:
            w_ratio = p["width"] / slide_w
            h_ratio = p["height"] / slide_h
            p["w_ratio"] = w_ratio
            p["h_ratio"] = h_ratio
            p["area_ratio"] = p["area"] / slide_area
            seen_on_slide.add(p["sha1"])
            if w_ratio >= 0.85 and h_ratio >= 0.85:
                full_bleed_sha1s.add(p["sha1"])
        for hsh in seen_on_slide:
            sha1_slide_count[hsh] = sha1_slide_count.get(hsh, 0) + 1

    chosen_map: Dict[int, dict] = {}
    repeat_threshold = max(4, int(total_slides * 0.25)) if total_slides >= 4 else 999

    for idx, pics in enumerate(raw_pictures_per_slide):
        if idx == 0:
            continue
        valid = []
        for p in pics:
            wr = p["w_ratio"]
            hr = p["h_ratio"]
            ar = p["area_ratio"]
            hsh = p["sha1"]
            sz = p["size"]

            # 1. Exclude full-bleed slide background images (Image 1 cover / Image 2 content background)
            if wr >= 0.85 and hr >= 0.85:
                continue
            if hsh in full_bleed_sha1s:
                continue

            # 2. Exclude repeated template/master elements (speaker icon, logo, header/footer, repeated bg)
            if total_slides >= 4 and sha1_slide_count.get(hsh, 0) >= repeat_threshold:
                continue
            if idx > 0 and sha1_slide_count.get(hsh, 0) >= 2 and ar >= 0.65:
                continue

            # 3. Exclude tiny icons, bullet markers, or audio badges
            if wr < 0.10 or hr < 0.10 or ar < 0.02:
                continue

            # 4. Exclude empty/flat decorative border/shadow rectangles (< 3.5 KB)
            if sz < 3500:
                continue

            valid.append(p)

        if valid:
            # Prefer real high-detail illustrations (>= 8 KB) and larger area/file size
            valid.sort(
                key=lambda x: (
                    1 if x["size"] >= 8000 else 0,
                    round(x["area_ratio"], 2),
                    x["size"],
                    x["z"],
                ),
                reverse=True,
            )
            chosen_map[idx] = valid[0]

    return chosen_map


def _extract_slides_from_pptx(prs, output_images_dir: Optional[str] = None) -> list:
    if isinstance(prs, str):
        prs = PptxPresentation(prs)
    slides_data = []
    raw_pictures_per_slide = []
    if output_images_dir:
        os.makedirs(output_images_dir, exist_ok=True)

    for i, slide in enumerate(prs.slides):
        blocks = []
        pictures = []
        _collect_slide_blocks_and_pictures(slide.shapes, i, blocks, pictures, [0])
        raw_pictures_per_slide.append(pictures)

        # Sort blocks in visual reading order (top-to-bottom, left-to-right, then z-order)
        blocks.sort(key=lambda b: (b["y"], b["x"], b["z"]))

        title = ""
        title_block_idx = -1
        for b_idx, blk in enumerate(blocks):
            if blk["kind"] == "text" and blk["is_title_ph"] and blk["lines"]:
                title = blk["lines"][0]
                title_block_idx = b_idx
                break
        if not title:
            for b_idx, blk in enumerate(blocks):
                if blk["kind"] == "text" and blk["lines"]:
                    title = blk["lines"][0]
                    title_block_idx = b_idx
                    break

        slide_content = []
        for b_idx, blk in enumerate(blocks):
            start_line = 1 if b_idx == title_block_idx else 0
            for ln in blk["lines"][start_line:]:
                if ln != title and ln not in slide_content:
                    slide_content.append(ln)

        # Extract speaker notes
        note_full = ""
        if slide.has_notes_slide:
            notes_frame = slide.notes_slide.notes_text_frame
            if notes_frame:
                note_full = notes_frame.text.strip()

        # Split bilingual notes
        note_data = _split_bilingual_notes(note_full)

        slides_data.append({
            "index": i,
            "title": title or f"Slide {i + 1}",
            "content": slide_content,
            "noteFull": note_data["full"],
            "noteEN": note_data["en"],
            "noteVN": note_data["vi"],
            "hasDual": note_data["has_dual"],
            "imageFileName": None,
        })

    if output_images_dir:
        chosen_pictures = _select_foreground_pictures_across_slides(prs, raw_pictures_per_slide)
        for i, slide_entry in enumerate(slides_data):
            # Remove any stale auto-extracted slide_{i:02d}.* file from older versions
            for old_ext in ("png", "jpg", "jpeg", "gif", "webp"):
                stale_path = os.path.join(output_images_dir, f"slide_{i:02d}.{old_ext}")
                if os.path.isfile(stale_path):
                    try:
                        os.unlink(stale_path)
                    except Exception:
                        pass

            chosen = chosen_pictures.get(i)
            if chosen:
                try:
                    ext = chosen["ext"] if chosen["ext"] in ("png", "jpg", "jpeg", "gif", "webp") else "png"
                    fname = f"slide_{i:02d}.{ext}"
                    fpath = os.path.join(output_images_dir, fname)
                    with open(fpath, "wb") as img_f:
                        img_f.write(chosen["blob"])
                    slide_entry["imageFileName"] = fname
                except Exception as e:
                    logger.warning(f"Could not save extracted foreground image for slide {i}: {e}")

        try:
            for mname in (".extracted_v2", ".extracted_v3"):
                marker_path = os.path.join(output_images_dir, mname)
                with open(marker_path, "w", encoding="utf-8") as mf:
                    mf.write("v3\n")
        except Exception:
            pass

    return slides_data


@app.post("/parse-pptx")
async def parse_pptx(file: UploadFile = File(...)):
    """
    Parse uploaded PPTX → extract slides with speaker notes + content.
    Supports bilingual notes (EN/VN separated by blank line).
    """
    try:
        # Save uploaded file to temp
        tmp_path = tempfile.mktemp(suffix='.pptx')
        content = await file.read()
        with open(tmp_path, 'wb') as f:
            f.write(content)

        prs = PptxPresentation(tmp_path)
        slides_data = _extract_slides_from_pptx(prs)

        # Cleanup temp file
        os.unlink(tmp_path)

        logger.info(f"Parsed PPTX: {len(slides_data)} slides from {file.filename}")
        return {"slides": slides_data, "totalSlides": len(slides_data)}

    except Exception as e:
        logger.error(f"Failed to parse PPTX: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to parse PPTX: {str(e)}")


class ParseLocalRequest(BaseModel):
    file_path: str


class RenderLocalSlidesRequest(BaseModel):
    file_path: str
    dpi: int = 150
    force: bool = False


@app.post("/parse-pptx-local")
async def parse_pptx_local(request: ParseLocalRequest):
    """
    Parse PPTX directly from a local shared volume path and render full 16:9 slide PNGs.
    Saves massive memory and network overhead on VPS.
    """
    try:
        real_path = _validate_local_pptx_path(request.file_path)

        prs = PptxPresentation(real_path)
        session_dir = os.path.dirname(real_path)
        images_dir = os.path.join(session_dir, "images")
        rendered_dir = os.path.join(session_dir, "rendered_slides")

        slides_data = _extract_slides_from_pptx(prs, output_images_dir=images_dir)
        rendered_map = _render_pptx_slides_to_png(
            real_path,
            rendered_dir,
            expected_count=len(slides_data),
        )
        for s in slides_data:
            s["renderedSlideFileName"] = rendered_map.get(s["index"])

        logger.info(
            f"Parsed Local PPTX: {len(slides_data)} slides ({len(rendered_map)} rendered PNGs) from {real_path}"
        )
        return {
            "slides": slides_data,
            "totalSlides": len(slides_data),
            "renderedCount": len(rendered_map),
        }

    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to parse local PPTX: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to parse local PPTX: {str(e)}")


@app.post("/extract-foreground-images")
async def extract_foreground_images(request: ParseLocalRequest):
    """
    Re-extract true foreground slide illustrations (filtering out Image 1 / Image 2 template backgrounds)
    directly on the shared /app/uploads volume without needing LibreOffice full-slide rendering.
    """
    try:
        real_path = _validate_local_pptx_path(request.file_path)
        prs = PptxPresentation(real_path)
        session_dir = os.path.dirname(real_path)
        images_dir = os.path.join(session_dir, "images")
        slides_data = _extract_slides_from_pptx(prs, output_images_dir=images_dir)
        extracted_count = sum(1 for s in slides_data if s.get("imageFileName"))
        logger.info(
            f"Extracted foreground images (v3): {extracted_count}/{len(slides_data)} slides from {real_path}"
        )
        return {
            "slides": slides_data,
            "totalSlides": len(slides_data),
            "extractedCount": extracted_count,
        }
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to extract foreground images: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to extract foreground images: {str(e)}")


@app.post("/render-pptx-slides")
async def render_pptx_slides(request: RenderLocalSlidesRequest):
    """
    On-demand full-slide PNG rendering for existing PPTX sessions (idempotent & cached on disk).
    Also ensures v3 foreground slide illustrations are extracted into images/.
    """
    try:
        real_path = _validate_local_pptx_path(request.file_path)
        prs = PptxPresentation(real_path)
        total_slides = len(prs.slides)
        session_dir = os.path.dirname(real_path)
        images_dir = os.path.join(session_dir, "images")
        if not os.path.isfile(os.path.join(images_dir, ".extracted_v3")):
            try:
                _extract_slides_from_pptx(prs, output_images_dir=images_dir)
            except Exception as ex:
                logger.warning(f"Foreground image extraction during render_pptx_slides failed: {ex}")
        rendered_dir = os.path.join(session_dir, "rendered_slides")
        rendered_map = _render_pptx_slides_to_png(
            real_path,
            rendered_dir,
            expected_count=total_slides,
            dpi=request.dpi,
            force=request.force,
        )
        slides = [
            {
                "index": idx,
                "renderedSlideFileName": rendered_map.get(idx),
            }
            for idx in range(total_slides)
        ]
        return {
            "slides": slides,
            "totalSlides": total_slides,
            "renderedCount": len(rendered_map),
        }
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to render PPTX slides: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to render PPTX slides: {str(e)}")


class InjectAudioRequest(BaseModel):
    pptxPath: str
    audioFiles: List[Dict]  # [{slideIndex: 0, audioPath: "/path/to/audio.wav"}]


@app.post("/inject-audio")
async def inject_audio(request: InjectAudioRequest):
    """
    Open original PPTX, inject audio into each slide with auto-play.
    Uses same _add_audio_with_autoplay() method from pptx_service.
    """
    try:
        if not os.path.exists(request.pptxPath):
            raise HTTPException(status_code=404, detail=f"PPTX file not found: {request.pptxPath}")

        prs = PptxPresentation(request.pptxPath)

        injected_count = 0
        for audio_info in request.audioFiles:
            slide_idx = audio_info.get("slideIndex", -1)
            audio_path = audio_info.get("audioPath", "")

            if slide_idx < 0 or slide_idx >= len(prs.slides):
                logger.warning(f"Invalid slide index: {slide_idx}")
                continue

            if not audio_path or not os.path.exists(audio_path):
                logger.warning(f"Audio not found: {audio_path}")
                continue

            slide = prs.slides[slide_idx]
            pptx_service._add_audio_with_autoplay(slide, audio_path)
            injected_count += 1
            logger.info(f"Injected audio into slide {slide_idx}: {audio_path}")

        # Save to temp file
        output_path = tempfile.mktemp(suffix='.pptx')
        prs.save(output_path)

        # Read and encode as base64
        with open(output_path, 'rb') as f:
            buffer = base64.b64encode(f.read()).decode('utf-8')

        # Cleanup
        os.unlink(output_path)

        logger.info(f"Injected audio into {injected_count} slides")
        return {"buffer": buffer, "injectedCount": injected_count}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to inject audio: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to inject audio: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3002)
