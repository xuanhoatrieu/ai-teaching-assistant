# US-007 AI Textbook Generation

## Status

done

## Lane

normal

## Product Contract

Generate textbook chapter content for each SyllabusLesson using AI.
Content stored in SyllabusLesson.textbookContent, status tracked via textbookStatus.

## Acceptance Criteria

- POST /syllabus/:syllabusId/lessons/:lessonId/textbook triggers AI generation.
- AI uses: lesson outline + syllabus objectives + reference summaries as context.
- Generated content is academic markdown (headers, sections, examples).
- textbookStatus transitions: none → generating → done | error.
- UI shows textbook generation button with status indicator.
- UI shows preview of generated content (collapsed by default).

## Design Notes

- Reuse AIProviderService.generateTextWithSystem().
- System prompt follows Backward Design methodology.
- Content should be 2000-4000 words per lesson.
- Vietnamese language output.
- Store in SyllabusLesson.textbookContent (Text field, already in schema).

## Evidence

Pending implementation.

- Backend: `tsc --noEmit` passes
- Frontend: `tsc --noEmit` passes
- Endpoint: POST /syllabus/:id/lessons/:lessonId/textbook
- AI context: lesson outline + objectives + description + reference summaries
- System prompt: Backward Design structure, Bloom's taxonomy, anti-AI phrasing rules
- Status tracking: none → generating → done/error
- UI: textbook badge (📗/⏳/⚠️), generate button, collapsible content preview
