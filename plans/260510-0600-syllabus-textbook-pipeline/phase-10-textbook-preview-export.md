# Phase 10: Textbook Preview/Edit + DOCX Export
Status: ⬜ Pending
Dependencies: Phase 09 (Textbook content exists)
Risk: Normal

## Objective
Markdown preview + editor cho textbook, user upload ảnh, export textbook ra DOCX.

## Implementation Steps

1. [ ] **Textbook Preview/Edit component**
   - File: `frontend/src/components/syllabus/TextbookPreview.tsx` (CREATE)
   - Two tabs: "Preview" (rendered markdown) + "Edit" (textarea/code editor)
   - Preview renders markdown with images, code blocks, math
   - Edit mode: plain textarea with markdown
   - Position: ABOVE action buttons (per BRIEF v3)

2. [ ] **Image upload in editor**
   - Button "📷 Chèn ảnh" in edit mode
   - Upload → MinIO → insert markdown `![caption](url)` at cursor
   - File: `frontend/src/components/syllabus/TextbookImageUpload.tsx` (CREATE)

3. [ ] **Textbook DOCX export service**
   - File: `backend/src/syllabus/textbook-docx-export.service.ts` (CREATE)
   - Parse markdown → docx elements (headings, paragraphs, code blocks, images, tables)
   - Download images from URLs → embed in DOCX
   - Academic styling: Times New Roman, proper heading hierarchy
   - Code blocks: monospace font, light gray background

4. [ ] **Endpoint: Export textbook DOCX** `GET /syllabus/:id/lessons/:lessonId/export/docx`
   - Generate DOCX from textbookContent
   - Include embedded images
   - Download as .docx

5. [ ] **Frontend integration in SyllabusLessonList**
   - Each lesson card layout:
     ```
     Title (editable)
     Outline (editable textarea)
     ── Textbook ──
     [Preview/Edit tabs] ← TextbookPreview component
     [💾 Lưu] [📚 Tạo Textbook] [🔄 Tạo lại]
     [📄 Export DOCX] [▶️ Tạo bài giảng]
     Status: Bài giảng ⬜/✅
     ```

## Test Criteria
- [ ] Markdown preview renders correctly (headings, images, code, tables)
- [ ] Edit mode preserves content
- [ ] Image upload inserts markdown at correct position
- [ ] DOCX export includes all content + embedded images
- [ ] DOCX opens correctly in MS Word
- [ ] Academic styling applied (Times New Roman, heading sizes)

---
🎉 Pipeline Complete!
