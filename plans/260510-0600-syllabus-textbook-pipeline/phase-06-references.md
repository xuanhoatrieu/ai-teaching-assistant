# Phase 06: Reference Upload + MarkItDown
Status: ⬜ Pending
Dependencies: Phase 02 (Database), Phase 04 (MarkItDown service shared)
Risk: Normal

## Objective
Upload giáo trình/tài liệu tham khảo → MarkItDown → lưu markdown để dùng cho AI textbook.

## Implementation Steps

1. [ ] **Endpoint: Upload reference** `POST /syllabus/:id/references/upload`
   - Accept PDF, DOCX, PPTX, XLSX (multipart)
   - Save to MinIO → create SyllabusReference (status: pending)
   - Queue async MarkItDown processing

2. [ ] **Async MarkItDown processing**
   - Reuse `markitdown.service.ts` from Phase 04
   - Download file from MinIO → temp → markitdown → save markdown_content
   - Update status: pending → processing → done / error
   - Handle large files (timeout 60s)

3. [ ] **Endpoint: List references** `GET /syllabus/:id/references`
   - Return all references with status, fileName, fileSize

4. [ ] **Endpoint: Delete reference** `DELETE /syllabus/:id/references/:refId`
   - Delete from MinIO + DB

5. [ ] **Frontend: Reference upload UI in Block 5 (Học liệu)**
   - File: `frontend/src/components/syllabus/SyllabusReferenceUpload.tsx` (CREATE)
   - File dropzone/picker
   - List uploaded files with status badges (pending/processing/done/error)
   - Preview button (view markdown) + delete button

## Test Criteria
- [ ] Upload PDF → MarkItDown converts → markdown saved
- [ ] Upload DOCX → converts correctly
- [ ] Upload PPTX → converts correctly
- [ ] Large file (>10MB) handled with timeout
- [ ] Delete removes from both MinIO and DB
- [ ] Status updates reflected in real-time UI

---
Next Phase: → phase-07-ai-lesson-split.md
