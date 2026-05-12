# Phase 02: Reference Enhancement
Status: ⬜ Pending
Dependencies: Phase 01

## Objective
Nâng cấp reference injection: từ cắt 3000 chars → 50K chars + AI trích xuất chương relevant.

## Tasks

### 1. Nâng reference limit 3000 → 50000
- [ ] Sửa `generateTextbook()` hiện tại: `slice(0, 3000)` → `slice(0, 50_000)`
- [ ] Sửa `generateLessons()`: cùng pattern, nâng từ 2000 → 20000
- [ ] Thêm constant `REF_CHAR_LIMIT = 50_000` để dễ điều chỉnh

### 2. Tạo EXTRACT_PROMPT
- [ ] System prompt: "Đọc tài liệu tham khảo, trích xuất phần liên quan đến bài [title]"
- [ ] Input: toàn bộ reference markdown (không cắt) + lesson title + outline
- [ ] Output: Nội dung relevant trích nguyên văn, không tóm tắt
- [ ] Xử lý edge case: ref quá lớn (>800K chars) → chia chunks gửi tuần tự

### 3. Implement extractRelevantReferences()
- [ ] Method mới trong SyllabusService hoặc TextbookGenService
- [ ] Gọi AI với EXTRACT_PROMPT cho mỗi reference
- [ ] Ghép kết quả thành 1 context string
- [ ] Trả về extracted content (sẽ được dùng bởi Phase 03)

## Files to Modify
- `backend/src/syllabus/syllabus.service.ts` — nâng limit + thêm method

## Test Criteria
- [ ] Reference 300K chars → AI trích xuất đúng chương liên quan (~10-30K chars)
- [ ] generateTextbook() cũ vẫn hoạt động bình thường (backward compatible)

---
Next Phase: phase-03-multi-phase-pipeline.md
