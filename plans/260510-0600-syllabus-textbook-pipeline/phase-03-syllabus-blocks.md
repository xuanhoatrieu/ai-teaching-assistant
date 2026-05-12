# Phase 03: Syllabus Blocks CRUD + UI
Status: ⬜ Pending
Dependencies: Phase 02 (Database)
Risk: Normal

## Objective
Backend CRUD cho syllabus blocks + Frontend tab "📋 Đề cương" với 10 blocks editable.

## Implementation Steps

### Backend
1. [ ] **Create SyllabusModule**
   - Files: `backend/src/syllabus/syllabus.module.ts`, `syllabus.controller.ts`, `syllabus.service.ts`
   - Register in `app.module.ts`

2. [ ] **Endpoint: Create Syllabus** `POST /subjects/:id/syllabus`
   - Auto-create 10 default blocks (header, general_info, lecturers, description, clo, materials, student_tasks, assessment, content_detail, update_log)
   - Return syllabus with all blocks

3. [ ] **Endpoint: Get Syllabus** `GET /subjects/:id/syllabus`
   - Return syllabus + blocks (sorted by sortOrder) + references + lessons
   - If no syllabus exists, return null (frontend shows "Create" button)

4. [ ] **Endpoint: Update Block** `PUT /syllabus/:id/blocks/:blockId`
   - Update title, content, metadata for single block

5. [ ] **Endpoint: Save All Blocks** `PUT /syllabus/:id/blocks`
   - Bulk update all blocks in one request

### Frontend
6. [ ] **Create SyllabusPanel component**
   - File: `frontend/src/components/syllabus/SyllabusPanel.tsx` + `.css`
   - Two sections: "Đề cương" (blocks) + "Phân chia bài" (lessons — Phase 07)
   - Initialize button if no syllabus exists

7. [ ] **Create SyllabusBlockEditor component**
   - File: `frontend/src/components/syllabus/SyllabusBlockEditor.tsx`
   - View mode: display content (markdown rendered or plain text)
   - Edit mode: textarea or structured form depending on blockType
   - Per-block buttons: [✏️ Edit] [💾 Save] [↩️ Cancel]
   - Block types with structured forms: header (2 inputs), general_info (form), lecturers (table), clo (table)
   - Block types with textarea: description, materials, student_tasks, assessment, content_detail, update_log

8. [ ] **Add tab to SubjectDetail**
   - File: `frontend/src/pages/SubjectDetail.tsx` (BỔ SUNG)
   - Add 'syllabus' to activeTab state
   - Add tab button "📋 Đề cương"
   - Render SyllabusPanel when active

## Files to Create/Modify
| File | Action |
|------|--------|
| `backend/src/syllabus/syllabus.module.ts` | CREATE |
| `backend/src/syllabus/syllabus.controller.ts` | CREATE |
| `backend/src/syllabus/syllabus.service.ts` | CREATE |
| `backend/src/app.module.ts` | ADD import |
| `frontend/src/components/syllabus/SyllabusPanel.tsx` | CREATE |
| `frontend/src/components/syllabus/SyllabusPanel.css` | CREATE |
| `frontend/src/components/syllabus/SyllabusBlockEditor.tsx` | CREATE |
| `frontend/src/lib/syllabus-api.ts` | CREATE |
| `frontend/src/pages/SubjectDetail.tsx` | ADD tab |

## Test Criteria
- [ ] Create syllabus → 10 blocks auto-created
- [ ] Edit single block → saves correctly
- [ ] Save all → bulk update works
- [ ] Tab switch works in SubjectDetail
- [ ] Block view/edit toggle works

---
Next Phase: → phase-04-docx-import.md
