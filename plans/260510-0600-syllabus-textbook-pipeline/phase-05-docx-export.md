# Phase 05: Syllabus DOCX Export
Status: ⬜ Pending
Dependencies: Phase 03 (Blocks data exists)
Risk: Normal

## Objective
Export đề cương thành DOCX file đúng mẫu TUAF 2026 (portrait + landscape sections).

## Implementation Steps

1. [ ] **Export service**
   - File: `backend/src/syllabus/syllabus-docx-export.service.ts` (CREATE)
   - Uses `docx` library v9.5.1 (already in project)
   - 3 OOXML sections:
     - Section 1 (Portrait): Header, Block 0-6 (thông tin chung → nhiệm vụ SV)
     - Section 2 (Landscape): Block 7-8 (bảng đánh giá, nội dung chi tiết — wide tables)
     - Section 3 (Portrait): Block 9 (ban hành, ký tên)

2. [ ] **Table builders**
   - Build complex tables matching TUAF template:
     - Bảng số tiết (4x4)
     - Bảng giảng viên (5 columns)
     - Bảng CLO (5 columns)
     - Bảng kế hoạch kiểm tra (7 columns, landscape)
     - Bảng nội dung chi tiết (6 columns, landscape)
     - Bảng rubric (7 columns, landscape)
   - Parse from block.metadata JSON → docx Table objects

3. [ ] **Styling**
   - Font: Times New Roman, sizes matching template
   - Header: institution name + republic header (2-column)
   - Bold section headers, italic notes
   - Page margins matching TUAF standard

4. [ ] **Endpoint** `GET /syllabus/:id/export/docx`
   - File: `backend/src/syllabus/syllabus.controller.ts` (BỔ SUNG)
   - Generate → Packer.toBuffer → send as download

5. [ ] **Frontend button**
   - "📄 Export DOCX" button in SyllabusPanel
   - Download blob as .docx file

## Test Criteria
- [ ] Output DOCX opens correctly in MS Word
- [ ] Portrait sections (blocks 0-6, 9) render correctly
- [ ] Landscape sections (blocks 7-8) render correctly with wide tables
- [ ] Tables have correct column count and headers
- [ ] Vietnamese text renders with correct encoding
- [ ] Font and formatting match TUAF template

---
Next Phase: → phase-06-references.md
