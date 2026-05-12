"""
Video Generation Worker — Script Generator
Uses Gemini AI to convert slide outline into a concise video narration script.
The video script is DIFFERENT from the PPTX slide script (shorter, 50-80 words/scene).
"""
import json
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

# ── Gemini Prompt Template ──
VIDEO_SCRIPT_PROMPT = """Bạn là chuyên gia tạo kịch bản video giảng dạy. Từ nội dung bài giảng dưới đây,
hãy tạo kịch bản video với các scene ngắn gọn.

### QUY TẮC:
- Mỗi scene tối đa 50-80 từ narration (người xem cần theo kịp video)
- Chọn approach phù hợp cho từng scene:
  * "manim": công thức toán, đồ thị, diagram, so sánh, title card
  * "screen_record": demo code, gõ lệnh terminal, chạy chương trình
  * "imagen": cần ảnh minh họa concept trừu tượng, kiến trúc, sơ đồ phức tạp
  * "static": text-heavy, liệt kê, timeline, nội dung lý thuyết dài
- Luôn có scene đầu tiên (title card, approach="manim") và scene cuối (summary)
- Scene demo code PHẢI có field "code_lines" (array of strings) và "code_language"
- Scene imagen PHẢI có field "image_prompt" (tiếng Anh, mô tả chi tiết cho AI tạo ảnh)
- Mỗi scene có cả narration_vi và narration_en

### NỘI DUNG BÀI GIẢNG (Outline):
{outline}

### SLIDE SCRIPT (tham khảo, KHÔNG copy y nguyên):
{slide_script}

### NGÔN NGỮ CHÍNH: {lang}

### OUTPUT: Trả về JSON array (KHÔNG markdown, KHÔNG giải thích), mỗi phần tử có cấu trúc:
{{
  "index": 0,
  "title": "Tên scene ngắn gọn",
  "approach": "manim|screen_record|imagen|static",
  "duration_est": 30,
  "narration_vi": "Nội dung đọc tiếng Việt (50-80 từ)",
  "narration_en": "English narration (50-80 words)",
  "visual_desc": "Mô tả hình ảnh cần hiển thị",
  "manim_template": "title_card|formula_scene|graph_scene|code_display|null",
  "manim_params": {{}},
  "image_prompt": null,
  "image_url": null,
  "code_lines": null,
  "code_language": null,
  "ken_burns": null
}}
"""

# ── Manim-Only Prompt (when user forces approach=manim) ──
VIDEO_SCRIPT_PROMPT_MANIM = """Bạn là chuyên gia tạo kịch bản video giảng dạy phong cách 3Blue1Brown.
Từ nội dung bài giảng dưới đây, hãy tạo kịch bản video với các scene ngắn gọn.

### QUY TẮC BẮT BUỘC:
- TẤT CẢ scene phải dùng approach "manim" — KHÔNG ĐƯỢC dùng "static", "screen_record", "imagen"
- Mỗi scene tối đa 50-80 từ narration
- Title card → Manim text animation (Write, FadeIn)
- Công thức, đồ thị → Manim Axes, Tex, NumberPlane
- Demo code → Manim Text hiển thị code (KHÔNG screen_record)
- Summary → Manim VGroup bullet points animation
- Luôn có scene đầu tiên (title card) và scene cuối (summary)
- Mỗi scene có cả narration_vi và narration_en
- Mỗi scene có field "manim_code_hint" mô tả CHI TIẾT animations cần render:
  * Liệt kê rõ: text gì, font_size bao nhiêu, dùng Axes/Tex/Text nào, animation nào (Write/ShowCreation/FadeIn)
  * Ví dụ: "Title 'Gradient Descent' với Write animation, font_size=56, color=YELLOW, rồi FadeIn subtitle"

### NỘI DUNG BÀI GIẢNG (Outline):
{outline}

### SLIDE SCRIPT (tham khảo, KHÔNG copy y nguyên):
{slide_script}

### NGÔN NGỮ CHÍNH: {lang}

### OUTPUT: Trả về JSON array (KHÔNG markdown, KHÔNG giải thích), mỗi phần tử có cấu trúc:
{{
  "index": 0,
  "title": "Tên scene ngắn gọn",
  "approach": "manim",
  "duration_est": 30,
  "narration_vi": "Nội dung đọc tiếng Việt (50-80 từ)",
  "narration_en": "English narration (50-80 words)",
  "visual_desc": "Mô tả CHI TIẾT hình ảnh/animation cần render",
  "manim_template": "title_card|formula_scene|graph_scene|code_display|null",
  "manim_params": {{}},
  "manim_code_hint": "Mô tả CHI TIẾT code Manim cần viết, ví dụ: dùng Axes(-3,10), get_graph(lambda x: x**2), ShowCreation..."
}}
"""


def generate_video_script(
    outline: str,
    slide_script: str,
    lang: str = "vi",
    job_config: "JobConfig" = None,
    forced_approach: str = None,
) -> List[Dict[str, Any]]:
    """
    Generate a video script from lesson outline.
    Uses CLIProxy (if available) or Gemini SDK as AI provider.

    Args:
        outline: Detailed lesson outline text
        slide_script: Original slide script (for reference, not direct use)
        lang: Primary narration language (vi/en)
        job_config: JobConfig with API keys from NestJS backend
        forced_approach: If set, ALL scenes will use this approach

    Returns:
        List of scene dictionaries with narration, approach, and visual descriptions
    """
    from config import JobConfig
    if job_config is None:
        job_config = JobConfig()

    # Choose prompt based on forced approach
    if forced_approach == "manim":
        active_prompt = VIDEO_SCRIPT_PROMPT_MANIM
    else:
        active_prompt = VIDEO_SCRIPT_PROMPT

    prompt = active_prompt.format(
        outline=outline[:8000],  # Truncate to avoid token limits
        slide_script=slide_script[:5000],
        lang=lang,
    )

    try:
        text_api = job_config.effective_text_api

        if text_api["provider"] == "cliproxy" and text_api.get("url"):
            # ── Use CLIProxy (OpenAI-compatible) ──
            response_text = _call_cliproxy(
                prompt=prompt,
                url=text_api["url"],
                api_key=text_api["api_key"],
                model=text_api.get("model", ""),
            )
        else:
            # ── Use Gemini SDK ──
            response_text = _call_gemini(
                prompt=prompt,
                api_key=text_api.get("api_key", job_config.gemini_api_key),
            )

        scenes = json.loads(response_text)

        # Validate and normalize
        validated = []
        for i, scene in enumerate(scenes):
            validated.append({
                "index": i,
                "title": scene.get("title", f"Scene {i}"),
                "approach": scene.get("approach", "static"),
                "duration_est": scene.get("duration_est", 30),
                "narration_vi": scene.get("narration_vi", ""),
                "narration_en": scene.get("narration_en", ""),
                "visual_desc": scene.get("visual_desc", ""),
                "manim_template": scene.get("manim_template"),
                "manim_params": scene.get("manim_params", {}),
                "manim_code_hint": scene.get("manim_code_hint", ""),
                "image_prompt": scene.get("image_prompt"),
                "image_url": scene.get("image_url"),
                "code_lines": scene.get("code_lines"),
                "code_language": scene.get("code_language"),
                "ken_burns": scene.get("ken_burns", "zoom_in"),
            })

        # ── Force approach if user explicitly selected one ──
        if forced_approach:
            for scene in validated:
                scene["approach"] = forced_approach
            logger.info(f"Forced approach='{forced_approach}' on all {len(validated)} scenes")

        logger.info(f"Generated {len(validated)} scenes from outline")
        return validated

    except Exception as e:
        logger.error(f"Script generation failed: {e}")
        # Fallback: create a simple single-scene script
        return _fallback_script(outline, lang)


def _call_cliproxy(prompt: str, url: str, api_key: str, model: str) -> str:
    """Call CLIProxy OpenAI-compatible chat endpoint."""
    import requests
    response = requests.post(
        f"{url.rstrip('/')}/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.7,
        },
        timeout=120,
    )
    response.raise_for_status()
    data = response.json()
    content = data["choices"][0]["message"]["content"]
    # Strip markdown code fences if present
    if content.startswith("```"):
        lines = content.split("\n")
        content = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    return content


def _call_gemini(prompt: str, api_key: str) -> str:
    """Call Gemini SDK."""
    import google.generativeai as genai
    genai.configure(api_key=api_key)
    gen_model = genai.GenerativeModel("gemini-2.5-pro")
    response = gen_model.generate_content(
        prompt,
        generation_config=genai.GenerationConfig(
            temperature=0.7,
            response_mime_type="application/json",
        ),
    )
    return response.text


def _fallback_script(outline: str, lang: str) -> List[Dict[str, Any]]:
    """Fallback: create minimal script when AI fails."""
    lines = [l.strip() for l in outline.split("\n") if l.strip()]
    title = lines[0] if lines else "Bài giảng"

    return [
        {
            "index": 0,
            "title": title,
            "approach": "static",
            "duration_est": 60,
            "narration_vi": outline[:300] if lang == "vi" else "",
            "narration_en": outline[:300] if lang == "en" else "",
            "visual_desc": "Text display of outline content",
            "manim_template": None,
            "manim_params": {},
            "image_prompt": None,
            "image_url": None,
            "code_lines": None,
            "code_language": None,
            "ken_burns": "zoom_in",
        }
    ]
