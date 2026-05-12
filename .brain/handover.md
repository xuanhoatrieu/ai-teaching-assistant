# 📋 HANDOVER DOCUMENT
## AI Teaching Assistant — Textbook Export & Timeout Fix

📍 **Đang làm:** DOCX Export Quality + Remove ALL frontend timeouts
🔢 **Đến bước:** Export polish — pending verification

---

### ✅ ĐÃ XONG:
- **AWF Prompt Compliance:** 5-sentence paragraphs, Stanford Clarity, Anti-AI vocabulary in WRITE_PROMPT & REVIEW_FIX_PROMPT
- **Frontend timeout removal:** ALL axios timeouts → 0 (unlimited): speaker-notes, optimize-notes, importDocx, uploadReference, generateLessons, textbook, textbook-pro
- **DOCX Image support:** URL `/files/public/syllabus-textbook/...` → absolute disk path for Pandoc embedding
- **DOCX Code blocks:** `--highlight-style=tango` + python-docx post-processor (gray background, borders, Consolas, LEFT alignment)
- **AWF reference.docx template:** Times New Roman 13pt ALL styles (override Aptos theme via XML w:rFonts), A4, justified body, LEFT headings
- **Critical path bug fixed:** `process.cwd()` = `backend/` → post-process script path was `backend/backend/assets/` (DOUBLE). Script never ran before!
- **python-docx LEFT alignment bug:** `alignment=0` silently ignored → fixed with direct XML `<w:jc w:val="left"/>`

### ⏳ CÒN LẠI:
- Verify DOCX export (code LEFT-aligned, TNR font, images embedded)
- E2E test textbook PRO full pipeline
- Install mermaid-cli (mmdc) on VPS
- Git commit/push (CẦN HỎI USER)

### 🔧 QUYẾT ĐỊNH QUAN TRỌNG:
- AWF dual-layer DOCX styling: reference.docx (style-level) + docx_postprocess.py (run-level)
- python-docx XML override for fonts and alignment (python-docx API insufficient)
- Timeout: 0 = unlimited for ALL AI API calls on dev server

### 📁 FILES CHÍNH ĐÃ THAY ĐỔI:
- `backend/src/syllabus/syllabus-export.service.ts` — image path conversion + code block fix + post-process integration
- `backend/src/syllabus/syllabus.service.ts` — AWF prompt upgrades
- `backend/assets/build_reference.py` — AWF template builder
- `backend/assets/docx_postprocess.py` — Code block styling post-processor
- `backend/assets/reference.docx` — Rebuilt Pandoc template
- `frontend/src/lib/syllabus-api.ts` — ALL timeouts → 0
- `frontend/src/components/steps/Step4GenerateAudio.tsx` — Speaker notes timeouts → 0

---
📍 Đã lưu! Để tiếp tục: Gõ /recap
