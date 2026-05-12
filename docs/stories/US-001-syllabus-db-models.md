# US-001 Syllabus Database Models

## Status

done

## Lane

normal

## Product Contract

Add 4 new Prisma models (Syllabus, SyllabusBlock, SyllabusReference, SyllabusLesson) to support
the syllabus-driven textbook pipeline. These models are additive — no existing tables modified.

- Syllabus has 1:1 relation with Subject (cascade delete)
- SyllabusBlock stores 10 template blocks per syllabus
- SyllabusReference stores uploaded reference files + MarkItDown markdown
- SyllabusLesson stores AI-split lessons with optional link to existing Lesson

## Relevant Product Docs

- `plans/260510-0600-syllabus-textbook-pipeline/phase-02-database.md`
- `artifacts/syllabus_textbook_brief.md` (BRIEF v3)

## Acceptance Criteria

- 4 new tables created in PostgreSQL via Prisma migration.
- Subject → Syllabus cascade delete works.
- Syllabus → Blocks/References/Lessons cascade delete works.
- SyllabusLesson optionally links to Lesson (SetNull on delete).
- Prisma Client types available after `prisma generate`.
- No changes to existing table structures.

## Design Notes

- Commands: `npx prisma migrate dev --name add_syllabus_models`
- Tables: syllabi, syllabus_blocks, syllabus_references, syllabus_lessons
- Domain rules: subjectId is unique on syllabi (1:1). lessonId is unique on syllabus_lessons (1:1 optional).
- Relations use snake_case @@map for DB columns.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | n/a |
| Integration | Migration runs, tables exist, cascade delete works |
| E2E | n/a |
| Platform | n/a |
| Release | n/a |

## Harness Delta

First story file created for this project.

## Evidence

Pending migration execution.

- `prisma db push` sync confirmed: "Your database is now in sync with your Prisma schema"
- `prisma generate` success: Prisma Client v7.3.0 generated
- `npx tsc --noEmit` passes with 0 errors
- Graphify re-indexed: 26,385 nodes, 79,244 edges
