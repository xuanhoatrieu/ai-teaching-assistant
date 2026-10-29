# US-030: Chuyển đổi CLOZE & FIB sang lựa chọn công bằng (Moodle MULTICHOICE_S & SCORM/H5P Word Chips/Dropdowns)

- **Status**: `done`
- **Lane**: `normal`
- **Plan**: `docs/plans/completed/chuyển-đổi-cloze-và-fib-sang-lựa-chọn-công-bằng-chuẩn-moodle-multichoice-s-và-scorm-h5p.md`

## Acceptance Criteria
1. **Ngân hàng câu hỏi & Xuất Moodle XML (`Phương án 2A`)**:
   - Toàn bộ AI prompts tạo câu hỏi `CLOZE` (Lesson Step 6, PPTX Tool Step 4, Exam Set Multi-Lesson) sinh cú pháp `{1:MULTICHOICE_S:=Correct~Wrong1~Wrong2~Wrong3}`, không sinh `{1:SHORTANSWER:...}`.
   - `moodle-xml.helper.ts` đảm bảo 100% câu hỏi `CLOZE` xuất ra dùng lựa chọn (`MULTICHOICE_S` / `MULTICHOICE`), tự động nâng cấp các token `{1:SHORTANSWER:...}` cũ nếu còn sót, và vượt qua `validateClozeText()` với `0` lỗi.
2. **Học liệu tương tác Slide / SCORM 1.2 / H5P (`Đề xuất 1`)**:
   - `FIB` sinh 4 phương án (`options`) và hiển thị dạng **Word Chips** chọn từ trên SCORM 1.2 & H5P.
   - `CLOZE` sinh `distractors` và hiển thị dạng **inline `<select>` dropdown** tại từng chỗ trống kèm Word Bank trên SCORM 1.2 & H5P.
3. **Nâng cấp dữ liệu hiện có trong AI Teaching Assistant (`ata-postgres`)**:
   - Đồng bộ prompt `questions.english` trong bảng `prompts`.
   - Nâng cấp toàn bộ 6 câu `CLOZE` trong `english_questions`, 2 câu `CLOZE` trong `pptx_audio_sessions`, và các câu `FIB` trong `slides.interactive_data` sang chuẩn có phương án lựa chọn.
4. **Frontend UI**:
   - `renderClozeVisual` (Step 6, PPTX Tool, Exam Manager) hiển thị rõ đáp án đúng (`✅`) và các phương án nhiễu (`❌`).
