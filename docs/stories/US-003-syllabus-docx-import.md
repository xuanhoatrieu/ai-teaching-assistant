# US-003 Syllabus DOCX Import

## Status

done

## Lane

normal

## Product Contract

Upload existing DOCX syllabus → MarkItDown converts to markdown → AI parses and maps
content to 10 blocks → auto-fill syllabus form. User reviews and edits.

## Relevant Product Docs

- `plans/260510-0600-syllabus-textbook-pipeline/phase-04-docx-import.md`

## Acceptance Criteria

- POST /subjects/:id/syllabus/import accepts multipart DOCX upload.
- MarkItDown subprocess converts DOCX to markdown.
- AI parses markdown into 10 block mappings (JSON).
- Blocks auto-populated in DB, user can review.
- Error handling: wrong file type, empty file, AI parse failure, MarkItDown timeout.
- Upload `Mau_De_cuong_2026.docx` fills blocks correctly.

## Design Notes

- Commands: `markitdown <filepath>` (Python CLI, already installed)
- API: multipart/form-data with single file field
- AI prompt: structured JSON output mapping blockType → content
- Timeout: 30s for MarkItDown, 60s for AI parse

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | n/a |
| Integration | Upload DOCX → blocks filled |
| E2E | n/a |
| Platform | n/a |
| Release | n/a |

## Evidence

Pending implementation.

- Backend: `tsc --noEmit` passes
- Frontend: `tsc --noEmit` passes
- Graphify: 26,415 nodes (+6 from markitdown.service + controller updates)
- MarkItDown CLI: verified at `/home/trieuhoa/.local/bin/markitdown`
- AI system prompt: structured JSON parse for 10 block types with code fence stripping
