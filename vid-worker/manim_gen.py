"""
Manim Code Generator — AI generates custom ManimGL code for complex scenes.
Uses reference patterns from 3b1b examples + self-healing loop for reliability.
API config comes from JobConfig (passed by NestJS backend).
"""
import json
import logging
import os
import re
from typing import Dict, Any, Optional, List, Tuple

logger = logging.getLogger(__name__)

# ── Load Reference Dictionary ──
_REFERENCE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "manim_reference.json")
_REFERENCE_DATA = None

def _load_reference() -> dict:
    """Lazy-load the reference dictionary."""
    global _REFERENCE_DATA
    if _REFERENCE_DATA is None:
        try:
            with open(_REFERENCE_FILE, "r", encoding="utf-8") as f:
                _REFERENCE_DATA = json.load(f)
            logger.info(f"Loaded Manim reference: {len(_REFERENCE_DATA.get('patterns', {}))} patterns")
        except Exception as e:
            logger.warning(f"Could not load manim reference: {e}")
            _REFERENCE_DATA = {"patterns": {}}
    return _REFERENCE_DATA


def _find_relevant_patterns(visual_desc: str, code_hint: str = "", top_k: int = 5) -> List[Dict]:
    """Find the most relevant reference patterns for a scene description."""
    ref = _load_reference()
    patterns = ref.get("patterns", {})
    
    if not patterns:
        return []
    
    # Simple keyword matching
    search_text = (visual_desc + " " + code_hint).lower()
    
    scored = []
    for name, pattern in patterns.items():
        score = 0
        tags = pattern.get("tags", [])
        
        # Tag matching
        for tag in tags:
            if tag in search_text:
                score += 3
        
        # Template type matching
        template = pattern.get("template_type", "")
        if template in search_text:
            score += 5
        
        # Keyword matching in code
        code = pattern.get("code", "").lower()
        keywords = [w for w in search_text.split() if len(w) > 3]
        for kw in keywords:
            if kw in code:
                score += 1
        
        # Boost official examples
        if "official_examples" in pattern.get("source", ""):
            score += 2
        
        if score > 0:
            scored.append((score, name, pattern))
    
    scored.sort(key=lambda x: -x[0])
    return [{"name": name, "code": p["code"], "tags": p["tags"]} for _, name, p in scored[:top_k]]


# ── Main Prompt Template ──
MANIM_CODE_PROMPT = """Bạn là chuyên gia ManimGL (3b1b/manim — phiên bản GỐC của Grant Sanderson).
Tạo code ManimGL để render scene video giáo dục.

### QUY TẮC BẮT BUỘC:
- Import: `from manimlib import *` (KHÔNG phải `from manim import *`)
- Class kế thừa `Scene`, method `construct(self)`
- Đây là ManimGL (3b1b), KHÔNG PHẢI ManimCE (community edition)

### API ĐÚNG (ManimGL v1.7):
- `Text("nội dung", font_size=48)` cho chữ thường
- `Tex(r"x^2 + y^2")` cho công thức LaTeX (Tex, KHÔNG phải MathTex)
- `TexText(r"LaTeX text")` cho text LaTeX thường
- `ShowCreation(mobject)` để vẽ đường (KHÔNG PHẢI `Create`)
- `Write(text_mobject)` cho text
- `FadeIn`, `FadeOut`, `GrowFromCenter`, `Transform`, `ReplacementTransform`
- `TransformMatchingStrings`, `TransformMatchingShapes`
- `self.play(...)`, `self.wait(seconds)`
- `VGroup()` để nhóm nhiều object
- `.animate` syntax: `obj.animate.shift(RIGHT)`, `obj.animate.set_color(RED)`
- Color: `WHITE`, `YELLOW`, `RED`, `BLUE`, `GREEN`, `ORANGE`, `TEAL`, `GREY`, `GREY_A`, `GREY_B`, `BLUE_E`, `TEAL_E`
- `Axes(x_range=(-3, 10), y_range=(-1, 8))` cho đồ thị
- `axes.get_graph(lambda x: x**2, color=BLUE)` để vẽ hàm
- `axes.get_graph_label(graph, "f(x)")` cho nhãn
- `axes.c2p(x, y)` → coordinate to point
- `axes.add_coordinate_labels(font_size=20)` thêm nhãn trục
- `ValueTracker(value)` + `add_updater` cho animation động
- `Dot(color=RED)`, `Arrow()`, `Line()`, `Circle()`, `Square()`, `Rectangle()`
- `NumberPlane()`, `ComplexPlane()` cho lưới tọa độ
- `SurroundingRectangle(obj)`, `Brace(obj, direction)` cho annotation
- `obj.to_edge(UP)`, `obj.to_corner(UR)`, `obj.next_to(other, DOWN, buff=0.5)`
- `obj.set_backstroke(width=5)` để chữ nổi trên nền
- `IntegerMatrix([[1,2],[3,4]])` cho ma trận

### REFERENCE PATTERNS (code thực tế từ 3b1b/manim):
{reference_patterns}

### QUY TẮC LATEX TUYỆT ĐỐI:
- ❌ TUYỆT ĐỐI KHÔNG viết tiếng Việt có dấu (ố, ế, ứ, ả...) trong Tex/TexText
- ✅ Tiếng Việt → dùng Text("nội dung tiếng Việt")
- ✅ Công thức toán → dùng Tex(r"x^2 + y^2")
- ❌ KHÔNG: Tex(r"\\text{{Công thức}}") ← sẽ lỗi Unicode!
- ✅ ĐÚNG: Text("Cong thuc") hoặc Text("Công thức") (Text hỗ trợ Unicode, Tex thì không)
- Nếu cần text trong LaTeX, chỉ dùng ASCII: \\text{{gradient}}, \\text{{loss}}

### CÁC LỖI PHẢI TRÁNH:
- ❌ KHÔNG import `from manim import *` (đó là ManimCE)
- ❌ KHÔNG dùng `Create()` → Dùng `ShowCreation()`
- ❌ KHÔNG dùng `MathTex()` → Dùng `Tex()`
- ❌ KHÔNG dùng `axes.plot()` → Dùng `axes.get_graph()`
- ❌ KHÔNG dùng `axes.get_axis_labels()` → Dùng `axes.add_coordinate_labels()`
- ❌ KHÔNG import os, sys, subprocess, socket
- ❌ KHÔNG dùng vòng lặp animation quá 10 lần
- ❌ KHÔNG dùng updater quá phức tạp (giới hạn animation ~{duration}s)
- ❌ KHÔNG dùng biến chưa khai báo — KIỂM TRA mọi biến trước khi dùng!

### GIỮ ĐƠN GIẢN VÀ ĐẸP:
- Font_size đủ lớn (≥36) để đọc trên video
- Thời lượng scene: khoảng {duration}s (dùng self.wait() phù hợp)
- Tối đa 8-10 animation steps
- Background mặc định đen, text nên dùng WHITE hoặc YELLOW
- Nếu scene có nhiều nội dung, chia nhỏ rồi dùng FadeOut/FadeIn
- Mỗi scene chỉ 1 class kế thừa Scene

### MÔ TẢ SCENE:
Tiêu đề: {title}
Mô tả hình ảnh: {visual_desc}
Gợi ý: {code_hint}

### OUTPUT: Chỉ trả về code Python thuần, KHÔNG markdown, KHÔNG giải thích, KHÔNG ```python.
"""

# ── Self-Healing Prompt ──
SELF_HEAL_PROMPT = """Code ManimGL sau bị lỗi khi render. Hãy SỬA code.

### LỖI:
{error}

### CODE GỐC:
{original_code}

### QUY TẮC:
- Import: `from manimlib import *` (KHÔNG phải `from manim import *`)
- Dùng `ShowCreation()` thay `Create()`
- Dùng `Tex()` thay `MathTex()`
- KIỂM TRA mọi biến đã khai báo trước khi dùng
- KHÔNG dùng tiếng Việt có dấu trong Tex/TexText
- `axes.get_graph()` thay `axes.plot()`
- Mọi class phải kế thừa Scene và có method construct(self)

### REFERENCE (tham khảo nếu cần):
{reference_snippet}

### OUTPUT: Chỉ trả về code Python đã sửa, KHÔNG markdown, KHÔNG giải thích.
"""


def generate_manim_code(
    scene: Dict[str, Any],
    job_config: "JobConfig" = None,
    max_retries: int = 2,
) -> Optional[str]:
    """
    Generate custom Manim code using AI with self-healing loop.

    Flow: generate → validate (AST) → dry-run → if fail: self-heal → retry
    
    Args:
        scene: Scene dict with visual_desc, title, code_hint
        job_config: JobConfig with API keys from NestJS backend
        max_retries: Max self-healing attempts (default 2)

    Returns:
        Python code string or None if generation fails
    """
    from config import JobConfig
    if job_config is None:
        job_config = JobConfig()

    text_api = job_config.effective_text_api
    if not text_api.get("api_key"):
        logger.warning("No API key available, cannot generate Manim code")
        return None

    # 1. Find relevant reference patterns
    visual_desc = scene.get("visual_desc", "")
    code_hint = scene.get("manim_code_hint", "")
    refs = _find_relevant_patterns(visual_desc, code_hint, top_k=5)
    
    ref_text = ""
    if refs:
        ref_snippets = []
        for r in refs:
            # Truncate to first 30 lines to avoid token bloat
            code_lines = r["code"].split("\n")[:30]
            ref_snippets.append(f"# Pattern: {r['name']} (tags: {', '.join(r['tags'])})\n" + "\n".join(code_lines))
        ref_text = "\n\n".join(ref_snippets)
    else:
        ref_text = "Không có pattern phù hợp — viết từ đầu."

    prompt = MANIM_CODE_PROMPT.format(
        title=scene.get("title", "Scene"),
        visual_desc=visual_desc,
        code_hint=code_hint,
        duration=scene.get("duration_est", 30),
        reference_patterns=ref_text,
    )

    try:
        # First generation
        code = _call_ai(prompt, text_api)
        code = _clean_code(code)
        code = _fix_common_mistakes(code)

        # Self-healing loop
        for attempt in range(max_retries + 1):
            # Validate (AST)
            from manim_validator import validate_manim_code
            is_valid, error = validate_manim_code(code)
            
            if is_valid:
                # Dry-run validation (optional, quick check)
                dry_ok, dry_error = _dry_run_validate(code)
                if dry_ok:
                    logger.info(f"Manim code OK for '{scene.get('title')}' ({len(code)} chars, attempt {attempt})")
                    return code
                else:
                    error = dry_error
                    logger.warning(f"Dry-run failed (attempt {attempt}): {dry_error}")
            else:
                logger.warning(f"AST validation failed (attempt {attempt}): {error}")

            if attempt < max_retries:
                # Self-heal: send error + code back to AI
                logger.info(f"Self-healing attempt {attempt + 1}/{max_retries}...")
                code = _self_heal(code, error, refs, text_api)
                code = _clean_code(code)
                code = _fix_common_mistakes(code)
            else:
                logger.warning(f"All self-healing attempts exhausted for '{scene.get('title')}'")

        # Final fallback: if code passes AST but not dry-run, still return it
        is_valid, _ = validate_manim_code(code)
        if is_valid:
            logger.info(f"Returning code despite dry-run issues for '{scene.get('title')}'")
            return code

        return None

    except Exception as e:
        logger.error(f"Manim code generation failed: {e}")
        return None


def _self_heal(original_code: str, error: str, refs: List[Dict], text_api: dict) -> str:
    """Send error + code back to AI for fix."""
    # Pick 1-2 relevant reference snippets
    ref_text = ""
    if refs:
        ref_lines = refs[0]["code"].split("\n")[:20]
        ref_text = "\n".join(ref_lines)

    prompt = SELF_HEAL_PROMPT.format(
        error=error[:500],
        original_code=original_code,
        reference_snippet=ref_text,
    )
    
    try:
        return _call_ai(prompt, text_api)
    except Exception as e:
        logger.error(f"Self-heal AI call failed: {e}")
        return original_code  # Return original if heal fails


def _dry_run_validate(code: str, timeout: int = 15) -> Tuple[bool, str]:
    """
    Quick dry-run: try to import and instantiate the Scene class.
    Does NOT render — just checks for import/runtime errors.
    """
    import subprocess
    import tempfile
    
    # Write code to temp file with a test runner
    test_code = code + """

# ── Dry-run test (no render) ──
import sys
try:
    # Find the Scene class
    scene_cls = None
    for name, obj in list(globals().items()):
        if isinstance(obj, type) and issubclass(obj, Scene) and obj is not Scene:
            scene_cls = obj
            break
    if scene_cls:
        print(f"OK: Found {scene_cls.__name__}")
    else:
        print("ERROR: No Scene subclass found")
        sys.exit(1)
except Exception as e:
    print(f"ERROR: {e}")
    sys.exit(1)
"""
    
    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False, 
                                          dir=os.path.join(os.path.dirname(__file__), "tmp")) as f:
            f.write(test_code)
            tmp_path = f.name
        
        # Run with the manimgl venv Python
        venv_python = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), 
            "..", "3b1b-workspace", "manimgl-venv", "bin", "python3"
        )
        if not os.path.exists(venv_python):
            # Fallback: skip dry-run if venv not found
            return True, ""
        
        result = subprocess.run(
            [venv_python, tmp_path],
            capture_output=True, text=True, timeout=timeout,
            env={**os.environ, "LIBGL_ALWAYS_SOFTWARE": "1"},
        )
        
        if result.returncode == 0 and "OK:" in result.stdout:
            return True, ""
        else:
            error = result.stderr[-300:] if result.stderr else result.stdout[-300:]
            return False, error
    
    except subprocess.TimeoutExpired:
        return False, "Dry-run timeout"
    except Exception as e:
        # If dry-run setup fails, don't block — return OK
        logger.debug(f"Dry-run skipped: {e}")
        return True, ""
    finally:
        try:
            if 'tmp_path' in locals():
                os.unlink(tmp_path)
        except:
            pass


def _call_ai(prompt: str, text_api: dict) -> str:
    """Call AI provider (CLIProxy or Gemini)."""
    if text_api["provider"] == "cliproxy" and text_api.get("url"):
        return _call_cliproxy(prompt, text_api["url"], text_api["api_key"], text_api.get("model", ""))
    else:
        return _call_gemini(prompt, text_api["api_key"])


def _clean_code(code: str) -> str:
    """Clean AI output."""
    code = code.strip()
    # Remove markdown fences
    if code.startswith("```"):
        lines = code.split("\n")
        code = "\n".join(lines[1:-1]) if lines[-1].strip() == "```" else "\n".join(lines[1:])
    return code.strip()


def _fix_common_mistakes(code: str) -> str:
    """Fix common AI-generated Manim code mistakes (ensure ManimGL syntax)."""

    # 1. Fix wrong import (ManimCE → ManimGL)
    code = re.sub(r'from manim import \*', 'from manimlib import *', code)

    # 2. Fix Create → ShowCreation (ManimCE → ManimGL)
    code = re.sub(r'\bCreate\(', 'ShowCreation(', code)

    # 3. Fix MathTex → Tex (ManimCE → ManimGL)
    code = re.sub(r'\bMathTex\(', 'Tex(', code)

    # 4. Fix axes.plot → axes.get_graph (ManimCE → ManimGL)
    code = re.sub(r'\.plot\(', '.get_graph(', code)

    # 5. Fix get_axis_labels → add_coordinate_labels (ManimCE → ManimGL)
    code = re.sub(r'\.get_axis_labels\(', '.add_coordinate_labels(', code)

    # 6. Fix Dot3D → Dot
    code = re.sub(r'\bDot3D\b', 'Dot', code)

    # 7. Fix DrawBorderThenFill → ShowCreation
    code = re.sub(r'\bDrawBorderThenFill\(', 'ShowCreation(', code)
    
    # 8. Fix common wrong animation: GrowFromPoint → GrowFromCenter
    code = re.sub(r'\bGrowFromPoint\(', 'GrowFromCenter(', code)

    return code


def _call_cliproxy(prompt: str, url: str, api_key: str, model: str) -> str:
    """Call CLIProxy OpenAI-compatible chat endpoint."""
    import requests
    response = requests.post(
        f"{url.rstrip('/')}/v1/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={"model": model, "messages": [{"role": "user", "content": prompt}], "temperature": 0.3},
        timeout=120,
    )
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"]


def _call_gemini(prompt: str, api_key: str) -> str:
    """Call Gemini SDK."""
    import google.generativeai as genai
    genai.configure(api_key=api_key)
    gen_model = genai.GenerativeModel("gemini-2.5-pro")
    response = gen_model.generate_content(
        prompt,
        generation_config=genai.GenerationConfig(temperature=0.3),
    )
    return response.text
