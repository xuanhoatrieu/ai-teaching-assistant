# Story US-034: Hỗ trợ đa ngôn ngữ (Auto-Detect Slide EN/VI + Nút chọn ngôn ngữ) cho Câu hỏi tương tác & Mặc định chọn MC + MR

## Status & Meta
- **Story ID**: US-034
- **Risk Lane**: Standard (`normal`)
- **Status**: Done

## Goal & Acceptance Criteria
1. **Tự động phát hiện ngôn ngữ nội dung Slide / Tài liệu nguồn (Auto-Detect Slide Language)**:
   - Khi ngôn ngữ câu hỏi là `'auto'` (mặc định) hoặc khi môn học là `'vi'` / `'vi-en'`, nếu nội dung chữ trên các Slide (tiêu đề, nội dung bullet) hoặc văn bản nguồn chủ yếu là Tiếng Anh (tỷ lệ dấu tiếng Việt rất thấp và có từ tiếng Anh), hệ thống tự động sinh câu hỏi tương tác, phương án trả lời, câu dẫn, phản hồi/giải thích 100% bằng **Tiếng Anh (`en`)**.
   - Nếu Môn học (`Subject` / `PptxSubject`) hoặc Phiên (`session.language`) được cấu hình là `'en'`, mặc định sinh bằng Tiếng Anh (`en`).
2. **Nút chọn Ngôn ngữ câu hỏi trực tiếp trên Giao diện (Frontend & Backend API)**:
   - Bổ sung bộ chọn nhanh **Ngôn ngữ câu hỏi**: `🔄 Tự động theo Slide` (`auto`), `🇬🇧 Tiếng Anh` (`en`), `🇻🇳 Tiếng Việt` (`vi`) tại cả 4 nơi:
     1. **Bước 5 (Tạo PowerPoint)** — Trong Modal Cấu hình Slide Tương tác (`Step5GeneratePPTX.tsx`).
     2. **Bước 6 (Ngân hàng Câu hỏi)** — Tại thanh công cụ Tab Câu hỏi tương tác (`Step6QuestionBank.tsx`).
     3. **PPTX & Audio Tool — Bước 3 (Slide & Xuất học liệu)** — Trong Modal Chèn/Cấu hình Slide Tương tác (`PptxAudioTool.tsx`).
     4. **PPTX & Audio Tool — Bước 4 (Ngân hàng Câu hỏi)** — Tại thanh công cụ Tab Câu hỏi tương tác & Tab Câu hỏi ôn tập (`PptxAudioTool.tsx`).
3. **Đồng bộ Prompt, Nhãn loại câu hỏi (`typeLabels`), Chuẩn hóa (`normalizeInteractiveQuestions`) & Giao diện SCORM/H5P**:
   - Khi ngôn ngữ mục tiêu là Tiếng Anh (`en`):
     - `TF`: `options: ["True", "False"]`, `correctAnswer: "True" | "False"`, chuẩn hóa tự động sang `["True", "False"]`.
     - `ORDER`: `"Arrange the following words/phrases to form a complete sentence:"`.
     - `CLOZE`: `"Choose the appropriate word/phrase for each blank:"`.
     - Metadata (`badgeLabel`, `instruction`, `explanation`, `correctFeedback`, `incorrectFeedback`) và tiêu đề mặc định của Slide tương tác (`"Knowledge Checkpoint"`, `"Listening Comprehension"`) đều bằng Tiếng Anh.
     - Cập nhật `InteractiveQuestionService` (Bước 6), `SlidesService.generateSlideInteractions` (Bước 5), `PptxAudioToolService.generateSlideInteractions` (PPTX Bước 3), `PptxAudioToolService.generateInteractiveQuestions` và `PptxAudioToolService.generateReviewQuestions` (PPTX Bước 4).
     - Cập nhật `h5p-export.helper.ts` và `scorm-export.helper.ts` để các nút/nhãn câu hỏi tương tác hiển thị tiếng Anh khi nội dung/bài giảng là tiếng Anh.
4. **Mặc định loại câu hỏi tương tác chỉ chọn `MC` và `MR`**:
   - Bỏ chọn mặc định đủ 7 dạng câu hỏi ở Bước 5 (`Step5GeneratePPTX.tsx`) và 3 dạng ở PPTX Tool Bước 3 (`PptxAudioTool.tsx`), cũng như fallback mặc định ở Backend (`slides.service.ts` và `pptx-audio-tool.service.ts`).
   - Mặc định chỉ tích chọn 2 dạng: **`MC` (Multiple Choice - 1 đáp án)** và **`MR` (Multiple Response - Nhiều đáp án)** (`['MC', 'MR']`). Giảng viên muốn thêm dạng khác (`TF`, `FIB`, `MATCH`, `ORDER`, `CLOZE`) sẽ chủ động bấm chọn thêm.

## Verification & Security Plan
- **Input Validation**: Validate tham số `questionLanguage` / `language` nhận từ request body chỉ chấp nhận allow-list `['auto', 'en', 'vi']`.
- **Output Encoding / XSS Prevention**: Các trường nhãn và nội dung câu hỏi trên React JSX dùng cơ chế auto-escaping của React; trong `h5p-export.helper.ts` và `scorm-export.helper.ts` tiếp tục dùng `escapeHtml()` cho toàn bộ chuỗi trước khi render.
- **Build & Test**: Chạy `npm run build` cho cả `backend` và `frontend`, cùng unit test kiểm chứng hàm nhận diện ngôn ngữ văn bản slide (`detectSlideContentLanguage`) và chuẩn hóa câu hỏi tiếng Anh/tiếng Việt.
