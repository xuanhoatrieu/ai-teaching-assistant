# Chuyển đổi CLOZE và FIB sang lựa chọn công bằng chuẩn Moodle MULTICHOICE_S và SCORM H5P

## Outcome
- [x] **Phương án 2A (Ngân hàng câu hỏi & Đề kiểm tra & Moodle XML)**: 100% câu hỏi `CLOZE` (cả sinh mới qua AI lẫn xuất Moodle XML) sử dụng cú pháp dropdown tự xáo trộn `{1:MULTICHOICE_S:=Correct~Distractor1~Distractor2~Distractor3}` (hoặc `{1:MULTICHOICE:...}`), tuyệt đối không bắt sinh viên gõ chữ tự do `{1:SHORTANSWER:...}`, vượt qua 100% kiểm tra `validateClozeText()` (tương thích 100% Moodle 3.x / 4.x `qtype_multianswer`).
- [x] **Đề xuất 1 (Học liệu tương tác Slide / SCORM 1.2 / H5P)**:
  - `FIB`: Luôn sinh `options` gồm 4 phương án (1 đáp án đúng + 3 phương án nhiễu hợp lý) và hiển thị dưới dạng **Word Chips (4 thẻ từ chọn nhanh)** điền trực tiếp vào ô `[ _____ ]` trên SCORM 1.2 & lựa chọn trên H5P `H5P.MultiChoice 1.16` (có fallback an toàn cho slide cũ chưa có `options`).
  - `CLOZE`: Bổ sung `distractors` (3 từ nhiễu ngoài các từ đúng) và hiển thị **inline `<select>` dropdown** tại từng chỗ trống `(1)`, `(2)` kèm Word Bank trực quan, không bắt sinh viên gõ phím tự do.
- [x] **Rà soát & Nâng cấp toàn bộ dữ liệu hiện có trong `ata-postgres`**:
  - Đồng bộ prompt `questions.english` trong bảng `prompts` (kèm cơ chế tự đồng bộ idempotent trong `PromptsService`/`EnglishQuestionService` khi khởi động nếu bản ghi DB còn giữ quy tắc cũ `{1:SHORTANSWER:=word}`).
  - Nâng cấp toàn bộ 6 câu `CLOZE` trong `english_questions`, 2 câu `CLOZE` trong `pptx_audio_sessions.questions_json`, và 2 bản ghi `slides.interactive_data` sang chuẩn có phương án lựa chọn (`MULTICHOICE_S` với 3 phương án nhiễu ngữ pháp/chuyên ngành chuẩn xác; `FIB` đủ 4 phương án).
- [x] **Giao diện Xem trước & Chỉnh sửa trên Frontend**: `Step6QuestionBank.tsx`, `PptxAudioTool.tsx`, `ExamManagerPanel.tsx`, `Step5GeneratePPTX.tsx` hiển thị rõ **✅ Đáp án đúng** và **❌ Phương án nhiễu** cho `MULTICHOICE_S` / `MULTICHOICE` (thay vì nối tất cả bằng chữ `"hoặc"` như trước).

## Context & Authority
- Authority: Yêu cầu trực tiếp của người dùng (chọn **Phương án 2A** cho Ngân hàng câu hỏi Moodle XML + **Đề xuất 1** cho Học liệu tương tác SCORM/H5P + rà soát nâng cấp toàn bộ câu hỏi hiện tại trong AI Teaching Assistant).
- Risk lane: `normal`
- Story: `US-030`

## Approach
1. **Backend Prompts & Auto-Sync (`Phương án 2A`)**:
   - Cập nhật `PromptsService.seedV2()` (`questions.english`) và thêm `onModuleInit` idempotent sync cho `questions.english` khi DB còn chứa `{1:SHORTANSWER:=word}`.
   - Cập nhật prompt `generateEnglishQuestions` trong `PptxAudioToolService` và `generateEnglishForLesson` trong `ExamSetService` bắt buộc dùng `{1:MULTICHOICE_S:=Correct~Wrong1~Wrong2~Wrong3}` (3 phương án nhiễu cùng từ loại/ngữ cảnh, cấm dùng ký tự `~`, `}`, `#` bên trong nội dung phương án).
2. **Moodle XML Exporter & Validator (`backend/src/questions/moodle-xml.helper.ts`)**:
   - Mở rộng `buildEnglishClozeXml` & `repairClozeTokens`:
     - Đọc `data.clozeText || data.rawCloze || q.questionText`.
     - Hỗ trợ tự động nâng cấp bất kỳ token `{1:SHORTANSWER:=...}` hoặc chỗ trống `___` nào sang `{1:MULTICHOICE_S:=Correct~Distractor1~Distractor2~Distractor3}` bằng cách kết hợp `data.answers[i].distractors` / `data.distractors` hoặc bộ sinh phương án nhiễu ngữ cảnh thông minh (`generateContextualDistractors`) đảm bảo luôn có $\ge 3$ phương án nhiễu hợp lệ, khác đáp án đúng, đã escape ký tự Cloze đặc biệt, và đạt `validateClozeText(...) === []` 100%.
     - Cập nhật câu hướng dẫn mặc định tiếng Việt sang `'Chọn từ/cụm từ thích hợp cho mỗi chỗ trống để hoàn thành câu/đoạn văn sau:'`.
3. **Interactive Slides, SCORM 1.2 & H5P (`Đề xuất 1`)**:
   - Cập nhật prompt tạo/trích xuất câu hỏi tương tác trong `SlidesService` và `PptxAudioToolService`: `FIB` bắt buộc có `options` (4 lựa chọn) + `correctAnswer`; `CLOZE` bắt buộc có `distractors` (3 từ nhiễu) + `passage`.
   - Cập nhật `scorm-export.helper.ts`:
     - `FIB`: Khi `Array.isArray(q.options) && q.options.length >= 2`, hiển thị các nút **Word Chips** chọn đáp án (cả chế độ Luyện tập và Chặn bài Mastery Gate), tự động điền từ đã chọn vào preview chỗ trống; giữ fallback `<input type="text">` nếu dữ liệu cũ không có `options`.
     - `CLOZE`: Thay `<input type="text">` bằng `<select class="cloze-inline-select">` chứa danh sách từ đã xáo trộn từ `[...allBlankWords, ...(q.distractors || [])]` (loại trùng) + hiển thị Word Bank trực quan phía trên.
   - Cập nhật `h5p-export.helper.ts`: Đảm bảo `FIB` và `CLOZE` luôn trích xuất đầy đủ `optionsToUse` và `correctAnswersList` cho `H5P.MultiChoice 1.16`.
4. **Frontend Preview & Editor**:
   - Cập nhật `renderClozeVisual` trong `Step6QuestionBank.tsx`, `PptxAudioTool.tsx` và preview Cloze trong `ExamManagerPanel.tsx` để phân biệt đáp án đúng (`=` / `%100%`) màu xanh `✅` với các phương án nhiễu `❌`.
   - Cập nhật `Step5GeneratePPTX.tsx` & `PptxAudioTool.tsx` hiển thị/chỉnh sửa `options` của `FIB` và `distractors` của `CLOZE`.
5. **Database Audit & Upgrade (`ata-postgres`)**:
   - Nâng cấp 6 câu `CLOZE` trong `english_questions`, 2 câu `CLOZE` trong `pptx_audio_sessions`, 2 slide `interactive_data` trong `slides`, và đồng bộ `questions.english` trong `prompts`, sau đó kiểm định 100% câu hỏi sau nâng cấp bằng `buildEnglishMoodleXml` + `validateClozeText`.

## Invariants & Risk
- **Moodle Import Invariant**: Moodle `qtype_multianswer` sẽ hủy toàn bộ lần import XML nếu có bất kỳ 1 token Cloze nào sai cú pháp hoặc `MULTICHOICE_S` có dưới 2 lựa chọn hoặc thiếu dấu `=` (100% grade). Mọi câu `CLOZE` xuất ra bắt buộc phải qua `validateClozeText(rawContent).length === 0`.
- **Security Verification Plan (`mandatory-secure-web-skills`)**:
  - **XSS & Output Encoding**: Mọi nội dung câu hỏi, đáp án đúng và phương án nhiễu trong Moodle XML đều đi qua `escapeForCdata` / `escapeClozeAnswer` / `escapeXmlText`; trong H5P đi qua `escapeHtml`; trong SCORM 1.2 các giá trị truyền vào thuộc tính HTML/JS handler đều được `escapeHtml` / `encodeURIComponent` để ngăn chặn attribute breakout và DOM XSS; trên React Frontend sử dụng JSX auto-escaping thuần túy (không dùng `dangerouslySetInnerHTML`).
  - **SQL Injection Prevention**: Mọi truy vấn cập nhật cơ sở dữ liệu thông qua Prisma ORM hoặc parameterized queries (`$1, $2`), tuyệt đối không nối chuỗi SQL thô với dữ liệu đầu vào chưa kiểm soát.
  - **No Hardcoded Secrets & Localhost Testing**: Không hardcode khóa bí mật hay mật khẩu DB trong mã nguồn; mọi kiểm thử chạy cục bộ.

## Progress
- [x] Rà soát toàn bộ codebase và kiểm toán dữ liệu thực tế trong `ata-postgres`
- [x] Cập nhật Backend Prompts, Moodle XML Cloze `MULTICHOICE_S` & Auto-Upgrade Helper
- [x] Cập nhật Interactive Slides, SCORM 1.2 (Word Chips & Inline Dropdown) & H5P Export
- [x] Cập nhật Frontend Cloze/FIB Visual Preview & Editors
- [x] Nâng cấp dữ liệu câu hỏi hiện có trong `ata-postgres` & Kiểm thử toàn diện (Jest + Build)

## Recovery & Rollback
- Nếu cần khôi phục dữ liệu câu hỏi cũ trong DB, script nâng cấp lưu bản chụp JSON trước khi cập nhật để có thể khôi phục nguyên trạng 100%.

## Validation
- Proof commands:
  - `cd backend && npx jest src/questions/moodle-xml.helper.spec.ts src/slides/scorm-h5p-export.helper.spec.ts`
  - `cd backend && npm run build`
  - `cd frontend && npm run build`
