# Phase 05: Frontend Progress + Preview
Status: ⬜ Pending
Dependencies: Phase 03 (API endpoints)

## Objective
Thêm progress bar 5 bước khi generate textbook, hiển thị ảnh trong preview.

## Tasks

### 1. Thêm nút "Tạo textbook Pro" 
- [ ] Nút mới bên cạnh nút "📕 Tạo textbook" hiện tại
- [ ] Label: "🚀 Tạo textbook (5 bước)" hoặc toggle giữa Quick/Pro
- [ ] Gọi API endpoint mới `/textbook-pro`

### 2. Progress bar 5 bước
- [ ] Component `TextbookProgress`: hiển thị 5 bước với status
- [ ] Poll `GET /textbook-status` mỗi 3 giây
- [ ] UI mỗi bước:
  ```
  ✅ Trích xuất tài liệu tham khảo
  ✅ Lập kế hoạch bài viết (Backward Design)
  🔄 Viết nội dung chương... (đang chạy)
  ⬜ Tạo sơ đồ & hình minh họa
  ⬜ Kiểm tra & hiệu chỉnh chất lượng
  ```
- [ ] Animation: spinner cho step đang chạy, checkmark cho step xong

### 3. Image preview trong textbook
- [ ] ReactMarkdown đã hỗ trợ `![alt](url)` → ảnh tự render
- [ ] Kiểm tra URL ảnh textbook được resolve đúng (public route)
- [ ] Thêm CSS cho ảnh textbook: max-width, border, caption styling
- [ ] Click ảnh → zoom (optional)

### 4. Hiển thị Plan (optional)
- [ ] Trong expandable section "📋 Xem kế hoạch bài viết"
- [ ] Hiển thị Learning Outcomes, Assessments, Content outline
- [ ] Giúp user hiểu AI đã plan gì trước khi viết

## Files to Modify
- `frontend/src/components/syllabus/SyllabusPanel.tsx` — thêm nút + progress
- `frontend/src/components/syllabus/SyllabusPanel.css` — styling progress bar
- `frontend/src/lib/syllabus-api.ts` — thêm API calls mới

## Test Criteria
- [ ] Progress bar update realtime khi generate
- [ ] Ảnh hiển thị đúng trong textbook preview
- [ ] Nút "Tạo textbook" cũ vẫn hoạt động (1-shot fallback)

---
Next Phase: phase-06-testing.md
