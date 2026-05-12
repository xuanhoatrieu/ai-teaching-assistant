# US-002 Syllabus Blocks CRUD

## Status

done

## Lane

normal

## Product Contract

Create SyllabusModule with full CRUD for syllabus blocks. Add "Đề cương" tab to SubjectDetail.
User can create a syllabus (auto-generates 10 blocks), view/edit each block, save individually or bulk.

## Relevant Product Docs

- `plans/260510-0600-syllabus-textbook-pipeline/phase-03-syllabus-blocks.md`

## Acceptance Criteria

- POST /subjects/:id/syllabus creates syllabus with 10 default blocks.
- GET /subjects/:id/syllabus returns syllabus + blocks (sorted) + refs + lessons.
- PUT /syllabus/:id/blocks/:blockId updates single block.
- PUT /syllabus/:id/blocks bulk-updates all blocks.
- SubjectDetail has "Đề cương" tab rendering SyllabusPanel.
- Each block: view mode + edit mode with save/cancel.
- No changes to existing endpoints or components.

## Design Notes

- API: RESTful under /subjects/:id/syllabus and /syllabus/:id
- Tables: syllabi, syllabus_blocks (from Phase 02)
- UI: SyllabusPanel.tsx, SyllabusBlockEditor.tsx
- 10 block types: header, general_info, lecturers, description, clo, materials, student_tasks, assessment, content_detail, update_log

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | n/a |
| Integration | API endpoints return correct data |
| E2E | Tab renders, blocks editable |
| Platform | n/a |
| Release | n/a |

## Evidence

Pending implementation.

- Backend: `tsc --noEmit` passes (0 errors)
- Frontend: `tsc --noEmit` passes (0 errors)
- Graphify: 26,409 nodes (+24 from syllabus module)
- Files: 6 created, 2 modified (app.module.ts, SubjectDetail.tsx)
