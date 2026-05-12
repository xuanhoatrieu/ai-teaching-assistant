# Phase 03: Multi-Phase Pipeline Core
Status: ⬜ Pending
Dependencies: Phase 01, Phase 02

## Objective
Tạo pipeline 5 bước: EXTRACT → PLAN → WRITE → ILLUSTRATE → REVIEW+FIX.
Phase này implement 3 bước đầu (EXTRACT, PLAN, WRITE) + orchestrator.
ILLUSTRATE sẽ ở Phase 04.

## Tasks

### 1. Tạo PLAN_PROMPT (Backward Design)
- [ ] System prompt yêu cầu AI:
  - Xác định 3-5 Learning Outcomes (Bloom's verbs)
  - Thiết kế 3 Assessments (cơ bản → trung bình → nâng cao)
  - Lập outline nội dung (chỉ phục vụ assessments)
  - Chọn running example xuyên suốt
- [ ] Output: JSON `{learningOutcomes, assessments, contentOutline, runningExample}`
- [ ] Lưu vào SyllabusLesson.textbookPlan

### 2. Tạo WRITE_PROMPT (Academic Narrative)
- [ ] Prompt tích hợp toàn bộ AWF standards:
  - Harvard 6 elements (Motive, Thesis, Evidence, Analysis, Key Terms, Structure)
  - Stanford Clarity (5 nguyên tắc)
  - Academic-narrative tone (vô nhân xưng, cô đọng)
  - Formula derivation chain (≥3/5 bước)
  - Anti-AI vocabulary (danh sách cấm)
  - Paragraph expansion (≥3 câu/khái niệm)
  - Running example xuyên suốt
- [ ] Input: plan (từ Step 1) + extracted refs (từ Step 0) + lesson context
- [ ] Output: Markdown 3000-6000 từ
- [ ] Chỉ dẫn rõ: đánh dấu vị trí cần ảnh bằng `<!-- ILLUSTRATION: {type: "mermaid|ai_image", description: "..."} -->`

### 3. Tạo REVIEW_FIX_PROMPT
- [ ] Prompt yêu cầu AI kiểm tra 40+ mục checklist:
  - Backward Design (LO, assessments, relevance)
  - Harvard Elements (motive, thesis, evidence, analysis)
  - Anti-AI Vocabulary (danh sách cấm tiếng Việt + Anh)
  - Anti-AI Structure (Rule of Three, Negative Parallelism)
  - Academic Tone (không conversational, không khẩu ngữ)
  - Chuẩn hóa ngôn từ (thay thế từ biểu cảm)
  - Paragraph Expansion (≥3 câu/khái niệm)
  - Formula Derivation (≥3/5 bước)
- [ ] Output: Bài viết đã sửa (final markdown), KHÔNG trả danh sách lỗi
- [ ] Prompt nhấn mạnh: "Trả lại TOÀN BỘ bài viết đã sửa, giữ nguyên illustration markers"

### 4. Implement generateTextbookMultiPhase()
- [ ] Method mới (giữ nguyên `generateTextbook()` cũ làm fallback)
- [ ] Orchestrator gọi tuần tự 5 bước:
  ```
  1. extractRelevantReferences() → relevantRefs
  2. AI(PLAN_PROMPT, context + relevantRefs) → plan
  3. AI(WRITE_PROMPT, plan + relevantRefs + context) → draft
  4. illustrateTextbook(draft) → illustratedDraft (Phase 04)
  5. AI(REVIEW_FIX_PROMPT, illustratedDraft) → finalMarkdown
  ```
- [ ] Mỗi bước update `textbookPhase`: extracting→planning→writing→illustrating→reviewing→done
- [ ] Try/catch: nếu bất kỳ bước nào fail → set textbookPhase = 'error', lưu partial content

### 5. Tạo API endpoint mới
- [ ] `POST /syllabus/:id/lessons/:lessonId/textbook-pro` — gọi multi-phase
- [ ] Giữ endpoint cũ `/textbook` → gọi 1-shot (backward compatible)
- [ ] Hoặc: thêm query param `?mode=pro` trên endpoint cũ

### 6. Tạo polling endpoint
- [ ] `GET /syllabus/:id/lessons/:lessonId/textbook-status`
- [ ] Trả về: `{phase, progress: 0-100, message}`
- [ ] Frontend poll mỗi 3-5 giây để cập nhật progress bar

## Files to Create/Modify
- `backend/src/syllabus/syllabus.service.ts` — thêm generateTextbookMultiPhase + prompts
- `backend/src/syllabus/syllabus.controller.ts` — thêm endpoint

## Test Criteria
- [ ] Pipeline chạy 5 bước tuần tự, mỗi bước log đúng phase
- [ ] textbookPlan được lưu (để user có thể xem plan)
- [ ] Nếu step 3 fail → textbookPhase = 'error', step 1-2 vẫn lưu
- [ ] Endpoint cũ `/textbook` vẫn hoạt động bình thường

---
Next Phase: phase-04-illustrate-step.md
