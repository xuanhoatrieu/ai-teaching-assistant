# Phase 04: Syllabus DOCX Import
Status: ⬜ Pending
Dependencies: Phase 03 (Blocks CRUD)
Risk: Normal

## Objective
Upload existing DOCX đề cương → MarkItDown parse → AI mapping 10 blocks → auto-fill.

## Implementation Steps

1. [ ] **Endpoint: Import DOCX** `POST /subjects/:id/syllabus/import`
   - File: `backend/src/syllabus/syllabus.controller.ts` (BỔ SUNG)
   - Accept multipart file upload (DOCX only)
   - Save temp file → run MarkItDown subprocess → get markdown
   - Send markdown to AI with structured prompt → get JSON array of blocks
   - Upsert blocks into DB

2. [ ] **MarkItDown service**
   - File: `backend/src/syllabus/markitdown.service.ts` (CREATE)
   - `convertToMarkdown(filePath: string): Promise<string>`
   - Uses `child_process.execFile('markitdown', [filePath])`
   - Handle errors: file not found, unsupported format, timeout

3. [ ] **AI Parse prompt**
   - File: `backend/src/syllabus/prompts/parse-syllabus.ts` (CREATE)
   - Input: markdown text of syllabus
   - Output: JSON `[{blockType, title, content, metadata?}]`
   - Must handle: tables → JSON metadata, mixed content, Vietnamese text

4. [ ] **Frontend upload UI**
   - File: `frontend/src/components/syllabus/SyllabusPanel.tsx` (BỔ SUNG)
   - Add file upload zone at top: "📁 Import từ file DOCX"
   - Show progress: uploading → processing → filling blocks
   - After import: blocks auto-populate, user reviews

## Test Criteria
- [ ] Upload `Mau_De_cuong_2026.docx` → 10 blocks filled correctly
- [ ] Tables (giảng viên, CLO, nội dung chi tiết) parsed into metadata JSON
- [ ] Vietnamese characters preserved
- [ ] Error handling: wrong file type, empty file, AI parse failure

---
Next Phase: → phase-05-docx-export.md
