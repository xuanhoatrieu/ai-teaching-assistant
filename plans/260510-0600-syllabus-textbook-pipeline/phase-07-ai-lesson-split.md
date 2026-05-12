# Phase 07: AI Lesson Splitting
Status: ⬜ Pending
Dependencies: Phase 03 (Blocks with content_detail data)
Risk: Normal

## Objective
AI đọc Block 8 (Nội dung chi tiết) → phân chia thành N bài giảng với outline chi tiết.

## Implementation Steps

1. [ ] **AI Prompt: Analyze Syllabus**
   - File: `backend/src/syllabus/prompts/analyze-syllabus.ts` (CREATE)
   - Input: content_detail block + subject metadata (courseName, targetAudience, language)
   - Output: JSON array `[{order, title, outline}]`
   - Rules: 1 bài ≈ 1 buổi giảng, outline đủ chi tiết cho Step 1

2. [ ] **Endpoint: Analyze** `POST /syllabus/:id/analyze`
   - Read content_detail block
   - Call AI → parse JSON response
   - Bulk create SyllabusLesson records
   - Return created lessons

3. [ ] **Endpoint: Update lesson** `PUT /syllabus/:id/lessons/:lessonId`
   - Update title and/or outline

4. [ ] **Endpoint: Delete lesson** `DELETE /syllabus/:id/lessons/:lessonId`

5. [ ] **Frontend: Lesson list UI**
   - File: `frontend/src/components/syllabus/SyllabusLessonList.tsx` (CREATE)
   - Section 2 of SyllabusPanel
   - Button "🤖 AI phân chia bài" (calls analyze endpoint)
   - Each lesson card: title (editable), outline (editable textarea)
   - Per-lesson: [💾 Save] [🗑️ Delete]
   - Status indicators: textbook (none/generating/done), lesson (linked/not)

## Test Criteria
- [ ] AI splits syllabus into reasonable number of lessons
- [ ] Each lesson has meaningful title and outline
- [ ] Edit/save/delete individual lessons works
- [ ] Re-analyze replaces existing lessons (with confirmation)

---
Next Phase: → phase-08-create-lesson-bridge.md
