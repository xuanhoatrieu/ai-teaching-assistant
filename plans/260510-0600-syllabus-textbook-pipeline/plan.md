# Plan: Syllabus → Textbook → Lesson Pipeline
Created: 2026-05-10
Status: ✅ Complete
BRIEF: artifacts/syllabus_textbook_brief.md (v3)

## Overview
Xây dựng pipeline tạo đề cương chi tiết (block-based), AI phân chia bài giảng, AI tạo textbook, 
và bridge vào Lesson Workflow hiện tại. Kèm Moodle XML export cho question bank.

**Nguyên tắc:** Không thay đổi code cũ. Chỉ bổ sung endpoints/files mới.

## Tech Stack (đã có)
- Backend: NestJS + Prisma + PostgreSQL
- Frontend: React + Vite
- DOCX: docx.js v9.5.1 (ECMA-376 OOXML)
- XLSX: ExcelJS v4.4.0
- PPTX: pptxgenjs v4.0.1
- AI: Gemini/CLIProxy
- Images: ImagenService (Gemini Flash/Imagen 3.0)
- File Processing: MarkItDown (Python, installed)
- Storage: MinIO

## Phases

| Phase | Name | Status | Est. | Tasks |
|-------|------|--------|------|-------|
| 01 | Moodle XML Export | ✅ Complete | 1-2d | 4 |
| 02 | Database Models | ✅ Complete | 1d | 3 |
| 03 | Syllabus Blocks CRUD | ✅ Complete | 3-4d | 8 |
| 04 | Syllabus DOCX Import | ✅ Complete | 2d | 4 |
| 05 | Syllabus DOCX Export | ✅ Complete | 2-3d | 5 |
| 06 | Reference Upload + MarkItDown | ✅ Complete | 2d | 5 |
| 07 | AI Lesson Splitting | ✅ Complete | 2-3d | 5 |
| 08 | Create Lesson Bridge | ✅ Complete | 1-2d | 4 |
| 09 | AI Textbook Generation | ✅ Complete | 4-5d | 7 |
| 10 | Textbook Preview/Edit + Export | ✅ Complete | 2-3d | 5 |

**Total:** ~50 tasks | Est: 21-30 days

## Quick Commands
- Start Phase 1: `/code phase-01`
- Check progress: `/next`
- Save context: `/save-brain`
