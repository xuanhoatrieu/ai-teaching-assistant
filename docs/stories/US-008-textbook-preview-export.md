# US-008 Textbook Preview Edit Export

## Status

done

## Lane

normal

## Product Contract

Users can preview, edit, and export generated textbook content as DOCX.

## Acceptance Criteria

- PUT /syllabus/:id/lessons/:lessonId updates textbookContent (already exists from Phase 07).
- GET /syllabus/:syllabusId/textbook/export/docx exports all lessons as a single DOCX.
- UI: editable textarea for textbook content with Save button.
- UI: Export DOCX button downloads the combined textbook.

## Evidence

Pending.

- Backend + Frontend: `tsc --noEmit` passes
- PUT textbook content (save edits)
- GET textbook export DOCX (all chapters combined)
- UI: editable textarea, Save/Cancel, Export DOCX button
