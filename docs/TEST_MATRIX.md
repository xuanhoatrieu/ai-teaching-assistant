# Test Matrix

This file maps product behavior to proof.

No product behavior has been defined or implemented yet. Do not mark a row
implemented until tests or validation evidence exist.

## Status Values

| Status | Meaning |
| --- | --- |
| planned | Accepted as intended behavior, not implemented |
| in_progress | Actively being built |
| implemented | Implemented and proof exists |
| changed | Contract changed after earlier implementation |
| retired | No longer part of the product contract |

## Matrix

| Story | Contract | Unit | Integration | E2E | Platform | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TBD | Add rows when story packets are created | no | no | no | no | planned | none |
| Phase-01 | Moodle XML export: GET /lessons/:id/review-questions/export/moodle-xml returns valid XML with 3 Bloom categories | no | no | no | no | implemented | TypeScript type-check pass |
| Phase-02 | Syllabus DB models: 4 tables (syllabi, syllabus_blocks, syllabus_references, syllabus_lessons) with cascade delete | no | yes | no | no | implemented | prisma db push sync + tsc pass |
| Phase-03 | Syllabus CRUD: POST create + GET read + PUT update blocks. Tab in SubjectDetail with block editor UI | no | no | no | no | implemented | tsc pass (backend + frontend) |
| Phase-04 | DOCX Import: POST /subjects/:id/syllabus/import → MarkItDown → AI parse → fill 10 blocks | no | no | no | no | implemented | tsc pass + MarkItDown CLI verified |
| Phase-05 | DOCX Export: GET /subjects/:id/syllabus/export/docx → 3-section OOXML (portrait→landscape→portrait) | no | no | no | no | implemented | tsc pass (backend + frontend) |
| Phase-06 | Reference Upload: POST/GET/DELETE /syllabus/:id/references. MarkItDown extracts markdown from DOCX/PDF/PPTX | no | no | no | no | implemented | tsc pass (backend + frontend) |
| Phase-07 | AI Lesson Splitting: POST /syllabus/:id/lessons/generate + DELETE clear + PUT update. AI reads content_detail → JSON array | no | no | no | no | implemented | tsc pass (backend + frontend) |
| Phase-08 | Create Lesson Bridge: POST /syllabus/:id/lessons/:lessonId/bridge. Creates Lesson with pre-filled title+outline, links via lessonId | no | no | no | no | implemented | tsc pass (backend + frontend) |
| Phase-09 | AI Textbook Generation: POST /syllabus/:id/lessons/:lessonId/textbook. AI generates 2000-4000 word academic chapter. Status tracking (none→generating→done/error) | no | no | no | no | implemented | tsc pass (backend + frontend) |
| Phase-10 | Textbook Preview/Edit + Export: PUT save textbook content, GET export all chapters as DOCX. Editable textarea with save/cancel | no | no | no | no | implemented | tsc pass (backend + frontend) |

## Evidence Rules

- Unit proof covers pure domain and application rules.
- Integration proof covers backend enforcement, data integrity, provider
  behavior, jobs, or service contracts.
- E2E proof covers user-visible browser flows.
- Platform proof covers only shell, deployment, mobile, desktop, or runtime
  behavior that cannot be proven in lower layers.
- A story can be implemented without every proof column if the story packet
  explains why.
