# US-004 Reference Upload + MarkItDown

## Status

done

## Lane

normal

## Product Contract

Upload reference documents (DOCX, PDF, PPTX, XLSX, TXT) to syllabus.
MarkItDown extracts markdown content for AI context in later phases.
User can view extracted content, delete references.

## Acceptance Criteria

- POST /syllabus/:id/references accepts multipart file upload.
- MarkItDown converts file to markdown, stored in syllabus_references.
- GET /syllabus/:id/references returns list with metadata.
- DELETE /syllabus/:id/references/:refId removes file + DB record.
- UI shows reference list with file name, size, status, extracted preview.
- Upload progress indicator in frontend.
- Supports: .docx, .pdf, .pptx, .xlsx, .txt, .md

## Design Notes

- Reuse MarkItDownService from Phase 04.
- Store original file to uploads/syllabus-refs/<syllabusId>/
- Store extracted markdown in DB (markdownContent field).
- File size limit: 20MB per file.

## Evidence

Pending implementation.

- Backend: `tsc --noEmit` passes
- Frontend: `tsc --noEmit` passes
- Endpoints: POST upload, GET list, GET single, DELETE
- MarkItDown reused from Phase 04
- File storage: uploads/syllabus-refs/<syllabusId>/
- UI: ReferencePanel with upload/list/delete
