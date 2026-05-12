# US-006 Create Lesson Bridge

## Status

done

## Lane

normal

## Product Contract

Each SyllabusLesson card has a "Tạo bài giảng" button that creates a Lesson
in the existing 6-step workflow, pre-filling the outline from the SyllabusLesson.
The SyllabusLesson.lessonId field links the two records.

## Acceptance Criteria

- POST /syllabus/:syllabusId/lessons/:lessonId/bridge creates a Lesson and links it.
- Outline from SyllabusLesson is pre-filled into the new Lesson.
- UI shows "🔗 Đã tạo" badge and disables the create button for linked lessons.
- UI has "Mở bài giảng" link to navigate to the lesson editor.
- Cannot create duplicate — if lessonId already set, return error.

## Design Notes

- Reuse existing LessonService or direct Prisma create.
- The Lesson model needs: subjectId, title, outline (rawOutline).
- SyllabusLesson.lessonId updated after creation.

## Evidence

Pending implementation.

- Backend: `tsc --noEmit` passes
- Frontend: `tsc --noEmit` passes
- Endpoint: POST /syllabus/:id/lessons/:lessonId/bridge
- Creates Lesson with pre-filled title + outlineRaw from SyllabusLesson
- Links via SyllabusLesson.lessonId, prevents duplicate creation
- UI: "➕ Tạo bài giảng" / "📝 Mở bài giảng" in expanded lesson card
