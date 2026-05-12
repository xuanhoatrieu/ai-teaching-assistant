# Phase 06: E2E Test + Polish
Status: ⬜ Pending
Dependencies: Phase 01-05

## Objective
Test toàn bộ pipeline end-to-end, fix bugs, polish UX.

## Tasks

### 1. Test E2E trên browser
- [ ] Upload đề cương → AI split → chọn 1 bài → "Tạo textbook (5 bước)"
- [ ] Verify progress bar update đúng 5 bước
- [ ] Verify ảnh/sơ đồ hiển thị trong preview
- [ ] Verify textbook DOCX export bao gồm ảnh
- [ ] Test với môn IT (có code + output)
- [ ] Test với môn không-IT (chỉ sơ đồ + ảnh minh họa)

### 2. Error handling + edge cases
- [ ] Test khi AI timeout ở giữa pipeline → verify partial save
- [ ] Test khi Mermaid render fail → verify skip gracefully
- [ ] Test khi Image gen fail → verify skip gracefully
- [ ] Test khi reference rỗng → verify pipeline vẫn chạy (skip EXTRACT)
- [ ] Test khi user nhấn "Tạo textbook" lần 2 → verify overwrite confirm

### 3. Polish + Documentation
- [ ] Cập nhật knowledge.json với decisions mới
- [ ] Cập nhật features.json
- [ ] Cập nhật handover.md
- [ ] Commit message rõ ràng

## Test Criteria
- [ ] Pipeline hoàn chỉnh 5 bước cho ≥2 môn học khác nhau
- [ ] Không regression: textbook 1-shot cũ vẫn hoạt động
- [ ] DOCX export có ảnh inline

---
Hoàn thành! 🎉
