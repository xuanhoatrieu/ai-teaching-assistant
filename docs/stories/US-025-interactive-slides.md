# Story: US-025-interactive-slides — Slide tương tác tại Step 5 & Đóng gói học liệu Moodle

**Lane:** normal
**Status:** done
**Created:** 2026-09-30

## Context

Giảng viên cần tạo học liệu điện tử có tính tương tác cao (như nghe audio mẫu trả lời câu hỏi môn tiếng Anh, hoặc câu hỏi kiểm tra nhanh sau slide lý thuyết các môn khác) để đưa trực tiếp lên Moodle LMS.
Hiện tại quy trình thủ công (tải PPTX -> căn chỉnh autoplay -> dùng iSpring chèn quiz -> đóng gói SCORM -> xuất XML) rất mất thời gian.
Mục tiêu là tích hợp phân loại loại slide ngay tại Step 5 (`content`, `interactive_audio`, `checkpoint_quiz`), cho phép AI sinh tương tác trực tiếp theo ngữ cảnh slide/audio mẫu, và hỗ trợ xuất bản học liệu tương tác.

## Acceptance Criteria

- [x] AC1: Model `Slide` hỗ trợ lưu dữ liệu tương tác (`interactiveData` JSON) và trường `slideType` (`content`, `interactive_audio`, `checkpoint_quiz`).
- [x] AC2: Backend API cung cấp endpoint `POST /slides/:slideIndex/generate-interactions` và `PUT /slides/:slideIndex/content` cho phép cập nhật `slideType` và `interactiveData`.
- [x] AC3: Giao diện Step 5 hiển thị trực quan loại slide (Badge), cho phép đổi loại slide, hiển thị khối câu hỏi tương tác trên slide.
- [x] AC4: Giao diện Step 5 có nút `✨ AI tạo bài tập` (phân tích nội dung slide hoặc audio mẫu) và modal cho phép tùy chỉnh câu hỏi.
- [x] AC5: Đảm bảo build backend và frontend thành công (Zero regression).
- [x] AC6: Xuất gói SCORM 1.2 (`.zip`) hoàn chỉnh đưa vào Moodle LMS (tự động phát audio lời giảng từng slide, bài nghe mẫu, chấm điểm câu hỏi tương tác đồng bộ Sổ điểm Gradebook).
- [x] AC7: Xuất gói H5P (`.h5p`) chuẩn Course Presentation nạp trực tiếp vào Moodle H5P.
- [x] AC8: Xuất ngân hàng câu hỏi chuẩn Moodle Quiz XML (`.xml`) nạp trực tiếp vào Ngân hàng câu hỏi Moodle.
- [x] AC9: Tích hợp cửa sổ hướng dẫn chi tiết quy trình đưa SCORM/H5P/XML vào Moodle và khung hướng dẫn từng bước trên slide card.

## Validation

| Type | Status | Command |
|---|---|---|
| Build Backend | ✅ Pass | `cd backend && npm run build` (0 error) |
| Build Frontend | ✅ Pass | `cd frontend && npm run build` (0 error) |

## Files Changed

- `backend/prisma/schema.prisma` — thêm `interactiveData` vào Slide
- `backend/src/slides/scorm-export.helper.ts` — tạo manifest và player HTML5 SCORM 1.2
- `backend/src/slides/h5p-export.helper.ts` — tạo gói H5P Course Presentation
- `backend/src/slides/slides.service.ts` — bổ sung sinh tương tác AI và các phương thức xuất SCORM, H5P, Moodle XML
- `backend/src/slides/slides.controller.ts` — thêm route endpoint xuất SCORM, H5P, Moodle XML
- `frontend/src/components/steps/Step5GeneratePPTX.tsx` — UI các nút xuất Moodle, hướng dẫn từng bước và modal hướng dẫn
- `frontend/src/components/steps/Steps.css` — styling cho các nút xuất Moodle, modal hướng dẫn và callout quy trình slide
