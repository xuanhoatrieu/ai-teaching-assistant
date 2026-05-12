# Phase 01: Moodle XML Export
Status: ⬜ Pending
Dependencies: None (independent, quick win)
Risk: Tiny

## Objective
Thêm endpoint export ReviewQuestions dưới dạng Moodle XML chuẩn. Thêm nút UI trong Step 6.

## Implementation Steps

### Backend
1. [ ] **Thêm endpoint** `GET /lessons/:lessonId/review-questions/export/moodle-xml`
   - File: `backend/src/questions/questions.controller.ts` (BỔ SUNG)
   - Logic: Query ReviewQuestion[] → group by level → build XML string → send as download
   - XML template theo AWF skill spec (categories: muc_1_biet, muc_2_hieu, muc_3_van_dung)
   - Response headers: `Content-Type: application/xml`, `Content-Disposition: attachment`

2. [ ] **Helper function** `buildMoodleXml(questions, lessonTitle)`
   - File: `backend/src/questions/moodle-xml.helper.ts` (MỚI)
   - Escape HTML entities trong question text
   - CDATA wrap cho questiontext, generalfeedback, answers
   - Category headers per Bloom level

### Frontend
3. [ ] **Thêm nút** "📋 Xuất Moodle XML" trong Step6QuestionBank
   - File: `frontend/src/components/steps/Step6QuestionBank.tsx` (BỔ SUNG)
   - Chỉ hiện khi reviewQuestions.length > 0
   - Handler: fetch blob → download as .xml file

4. [ ] **Test:** Download XML → validate well-formed → import vào Moodle sandbox

## Files to Create/Modify
| File | Action |
|------|--------|
| `backend/src/questions/moodle-xml.helper.ts` | CREATE |
| `backend/src/questions/questions.controller.ts` | ADD endpoint |
| `frontend/src/components/steps/Step6QuestionBank.tsx` | ADD button + handler |

## Test Criteria
- [ ] XML well-formed (parseable by XML parser)
- [ ] Correct category hierarchy (3 levels)
- [ ] All 4 answer options present per question
- [ ] Correct answer has fraction="100"
- [ ] File downloads with correct filename
- [ ] Moodle import accepts the file without errors

---
Next Phase: → phase-02-database.md
