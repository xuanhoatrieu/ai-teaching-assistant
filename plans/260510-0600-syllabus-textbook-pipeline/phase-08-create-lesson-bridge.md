# Phase 08: Create Lesson Bridge
Status: ⬜ Pending
Dependencies: Phase 07 (Lesson list exists)
Risk: Tiny

## Objective
2 cách tạo Lesson trong WF cũ từ đề cương:
1. Nút "▶️ Tạo bài giảng" trên mỗi SyllabusLesson → auto-create + navigate
2. Dropdown trong Create Lesson modal → chọn bài từ đề cương → auto-fill

## Implementation Steps

1. [ ] **Endpoint: Create Lesson from Syllabus** `POST /syllabus/:id/lessons/:syllabusLessonId/create-lesson`
   - Create Lesson (title, outlineRaw from SyllabusLesson)
   - Save outlineRaw via OutlineService
   - Link syllabusLesson.lessonId = newLesson.id
   - Return new Lesson with id

2. [ ] **Frontend: "▶️ Tạo bài giảng" button**
   - In SyllabusLessonList, each lesson card
   - Click → POST create-lesson → navigate to `/lessons/${id}`
   - If already linked: show "🔗 Mở bài giảng" instead

3. [ ] **Endpoint: Get available syllabus lessons** `GET /subjects/:id/syllabus/available-lessons`
   - Return SyllabusLessons where lessonId IS NULL (not yet created)

4. [ ] **Frontend: Dropdown in Create Lesson modal**
   - File: `frontend/src/pages/SubjectDetail.tsx` (BỔ SUNG)
   - In existing "Tạo bài giảng" modal, add dropdown "📥 Import từ đề cương"
   - Fetch available lessons → populate dropdown
   - Select → auto-fill title + outline
   - Already-created lessons marked with ✅

## Test Criteria
- [ ] Button creates Lesson + fills outlineRaw
- [ ] Navigation works after creation
- [ ] SyllabusLesson.lessonId linked correctly
- [ ] Dropdown shows only unlinked lessons
- [ ] Selecting from dropdown auto-fills title

---
Next Phase: → phase-09-ai-textbook.md
