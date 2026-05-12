# US-005 AI Lesson Splitting

## Status

done

## Lane

normal

## Product Contract

AI analyzes the content_detail block of the syllabus and splits it into N lessons.
Each lesson has: title, sortOrder, outline (markdown).
User can trigger re-split (clears old lessons) or manually edit results.

## Acceptance Criteria

- POST /syllabus/:id/lessons/generate triggers AI lesson splitting.
- AI reads content_detail + course_objectives blocks as context.
- Optionally includes reference markdown as supplementary context.
- Result: array of SyllabusLesson records with title + outline.
- GET /syllabus/:id includes populated lessons array.
- DELETE /syllabus/:id/lessons clears all generated lessons.
- UI shows generated lessons with title + outline preview.
- UI has "Generate Lessons" button with loading state.

## Design Notes

- Reuse AIProviderService.generateTextWithSystem().
- System prompt instructs AI to output JSON array of {title, outline}.
- context = content_detail block + course_objectives block + reference summaries.
- Store in SyllabusLesson table (already exists from Phase 02).

## Evidence

Pending implementation.

- Backend: `tsc --noEmit` passes
- Frontend: `tsc --noEmit` passes
- Endpoints: POST generate, DELETE clear, PUT update
- AI system prompt: JSON array output with title + outline
- Context: content_detail + objectives + general_info + reference summaries
- UI: expandable lesson cards with outline preview, generate/clear buttons
