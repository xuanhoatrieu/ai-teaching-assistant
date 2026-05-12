# Phase 02: Manim Templates & Renderers
**Status:** ⬜ Pending
**Dependencies:** Phase 01 (worker core)

---

## Objective
Xây dựng thư viện Manim scene templates tái sử dụng, để AI (Gemini) chỉ cần
truyền parameters là tạo được video scene chất lượng cao, không cần sinh code
Manim phức tạp mỗi lần.

---

## Requirements

### Functional
- [ ] Template library: 6+ scene types
- [ ] AI Manim code generation: Gemini sinh code cho scene phức tạp
- [ ] Manim code validator: check syntax trước khi render
- [ ] IDE template cho Playwright: hỗ trợ nhiều ngôn ngữ
- [ ] Imagen 3 integration: prompt → image → video

### Non-Functional
- [ ] Mỗi template render < 30s cho 1080p
- [ ] Template parameterized: font size, color, language tùy chỉnh
- [ ] Fallback: nếu Manim render lỗi → dùng static approach thay thế

---

## Implementation Steps

### Manim Templates

1. [ ] **templates/title_card.py** — Title + Subtitle animation
   - Params: title, subtitle, logo_path (optional), color_scheme
   - Effects: Write title → FadeIn subtitle → hold 3s

2. [ ] **templates/formula_scene.py** — LaTeX formula display
   - Params: formula_latex, explanation_text, step_by_step (bool)
   - Effects: Write formula → highlight parts → show explanation

3. [ ] **templates/graph_scene.py** — Function graph / chart
   - Params: function_str, x_range, y_range, labels
   - Effects: Draw axes → animate curve → label points

4. [ ] **templates/code_display.py** — Code with syntax highlighting
   - Params: code_lines[], language, highlight_lines[]
   - Effects: Animated typing → highlight specific lines → show output box

5. [ ] **templates/comparison_scene.py** — Side-by-side comparison
   - Params: left_title, right_title, items_left[], items_right[]
   - Effects: Split screen → animate items → highlight winner

6. [ ] **templates/diagram_scene.py** — Flowchart / architecture diagram
   - Params: nodes[], edges[], highlight_path[]
   - Effects: Build diagram step by step → highlight flow path

7. [ ] **templates/image_overlay.py** — Image + Text overlay (Manim)
   - Params: image_path, title, annotations[]
   - Effects: FadeIn image → Write title → draw annotations → zoom

### AI Code Generation

8. [ ] **manim_gen.py** — AI sinh Manim code cho scene phức tạp
   - Khi template KHÔNG đủ → Gemini sinh full Manim code
   - Prompt engineering: cho Gemini biết ManimGL API, font, color
   - Output: Python code string → write temp file → render

9. [ ] **manim_validator.py** — Validate Manim code trước render
   - Syntax check (AST parse)
   - Import check (chỉ cho phép manimlib + standard lib)
   - Timeout: kill render nếu > 60s

### Playwright IDE Templates

10. [ ] **ide_templates/** — HTML templates cho screen recording
    - `python_ide.html` — Monaco Editor + Python mode + dark theme
    - `terminal.html` — Terminal emulator (xterm.js)
    - `split_ide.html` — Code left + Output right (split pane)
    - Tất cả responsive: 1920×1080 hoặc 1080×1920

---

## Files to Create/Modify
- `vid-worker/templates/title_card.py`
- `vid-worker/templates/formula_scene.py`
- `vid-worker/templates/graph_scene.py`
- `vid-worker/templates/code_display.py`
- `vid-worker/templates/comparison_scene.py`
- `vid-worker/templates/diagram_scene.py`
- `vid-worker/templates/image_overlay.py`
- `vid-worker/manim_gen.py`
- `vid-worker/manim_validator.py`
- `vid-worker/ide_templates/*.html`

---

## Test Criteria
- [ ] Mỗi template render thành công 1080p MP4 bằng xvfb-run
- [ ] AI-generated code cho "giới thiệu Python" render OK
- [ ] Validator bắt được code lỗi syntax
- [ ] Playwright record qua IDE template tạo WebM/MP4
- [ ] Imagen prompt → image → Ken Burns video thành công

---
**Next Phase:** [phase-03-backend-module.md](./phase-03-backend-module.md)
