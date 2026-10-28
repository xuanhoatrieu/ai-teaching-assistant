# Đồng bộ Bước 3 PPTX Audio Tool với Giao diện Bước 5

- **Status**: `completed`

## Outcome
- [x] **Gộp 5 bước thành 4 bước gọn gàng trong PPTX Tool**:
  1. `📚 Môn học & Bài` (Quản lý môn, tải PPTX, nạp Context Word/PDF/Text)
  2. `🎙️ Lời giảng & Audio` (Soạn Speaker Notes AI & tạo giọng đọc TTS)
  3. `📊 Biên tập Slide & Xuất học liệu` (Giao diện giống hệt Step 5: Thanh cấu hình Template/SCORM/H5P kèm preview + Hàng nút Xuất PPTX/SCORM/H5P/Moodle XML/Hướng dẫn Moodle + Danh sách Card Slide 2 cột + Chèn Slide Lý thuyết / Tương tác Mastery Gate xen kẽ)
  4. `❓ Ngân hàng Câu hỏi` (Câu hỏi Ôn tập, Câu hỏi Tương tác & Tiếng Anh chuyên ngành)
- [x] **Thanh Cấu hình Giao diện & Hàng nút Xuất Học Liệu chuẩn Step 5**:
  - 3 Dropdown đồng bộ (`🎨 Mẫu giao diện PowerPoint`, `🌐 Giao diện xuất SCORM & H5P` với 4 tùy chọn gồm cả `custom`, `🌓 Chủ đề màu sắc (Theme)`), kèm 2 ảnh thumbnail xem trước (`titleBgUrl` & `contentBgUrl`).
  - Hàng nút hành động: `📥 Tải PPTX (có Audio)`, `📦 Xuất SCORM (.zip)`, `🌟 Xuất H5P (.h5p)`, `📋 Xuất Moodle Quiz XML`, `❓ Hướng dẫn Moodle` (kèm Modal Hướng dẫn đưa học liệu vào Moodle 3 cách).
- [x] **Danh sách Card Slide 2 cột trực quan (Thay thế bảng `<table>` và gộp tab Nội dung Slide)**:
  - Header mỗi Slide: Số thứ tự Slide, Badge loại slide (`📘 Lý thuyết`, `🧩 Kiểm tra nhanh`, `🎧 Nghe & Tương tác`), Dropdown chọn bố cục hiển thị (`layoutType`: `split_standard`, `split_reversed`, `comparison_3col`, `hero_infographic`, `process_steps`, `audio_lab`, `checkpoint_gate`), Trạng thái Audio (`✅ Có audio`), nút Di chuyển (`⬆️`/`⬇️`), Xóa slide (`🗑️`).
  - Thân Card 2 cột:
    - Cột trái: Hiển thị các ý chính / gạch đầu dòng (`optimizedContent` hoặc `content`), hỗ trợ **✏️ Sửa nội dung trực tiếp** (tiêu đề + danh sách gạch đầu dòng có icon/point/description) hoặc **✨ AI tối ưu nội dung slide**.
    - Cột phải: Hiển thị ảnh trích xuất từ slide PPTX (`imageUrl`), hỗ trợ **📤 Đổi ảnh** (mở `ImageCropModal` cắt/căn chỉnh ảnh 1:1) hoặc **🖼️ AI tạo ảnh minh họa** cho những slide chưa có ảnh.
    - Hỗ trợ **🎧 Tải audio mẫu (`extraAudioUrl`)** cho từng slide.
- [x] **Chèn Slide Lý thuyết & Slide Tương tác (Mastery Gate / Audio Lab) xen kẽ giữa các Slide**:
  - Thanh chia (`slide-insert-divider`) giữa các slide với 2 nút `📖 + Lý thuyết` và `🎯 + Tương tác`.
  - Modal **Thêm Slide Lý thuyết** và Modal **Cấu hình Slide Tương tác** (chọn 7 dạng câu hỏi `MC`, `TF`, `MR`, `FIB`, `MATCH`, `ORDER`, `CLOZE`; chọn chế độ AI sáng tạo từ dải slide / văn bản / audio / ảnh hoặc Trích xuất đề có sẵn; cấu hình Mastery Gate: Bắt buộc đạt chuẩn / Cho phép qua bài, Điểm đạt tối thiểu, Slide quay về khi trượt).

## Context & Authority
- Authority: User confirmation (`tốt đề xuất gộp tab là rất chuẩn, hãy làm theo đề xuất này`)
- Risk lane: `normal`

## Approach
1. **Backend (`backend/src/pptx-audio-tool/`)**:
   - Mở rộng cấu trúc `ParsedSlide` trong `PptxAudioToolService` để hỗ trợ các trường tương thích với Step 5 (`originalSlideIndex`, `slideType`, `layoutType`, `optimizedContent`, `interactiveData`, `extraAudioUrl`, `extraAudioName`, `extraAudioDuration`).
   - Thêm các API quản lý & biên tập từng slide trong session (`PptxAudioToolController` & `PptxAudioToolService`):
     - `PUT /pptx-audio-tool/:sessionId/slides/:slideIndex/content`
     - `POST /pptx-audio-tool/:sessionId/slides`
     - `DELETE /pptx-audio-tool/:sessionId/slides/:slideIndex`
     - `POST /pptx-audio-tool/:sessionId/slides/:slideIndex/move`
     - `POST /pptx-audio-tool/:sessionId/slides/:slideIndex/upload-image`
     - `POST /pptx-audio-tool/:sessionId/slides/:slideIndex/regenerate-image`
     - `POST /pptx-audio-tool/:sessionId/slides/:slideIndex/regenerate-content`
     - `POST /pptx-audio-tool/:sessionId/slides/:slideIndex/extra-audio` & `DELETE /pptx-audio-tool/:sessionId/slides/:slideIndex/extra-audio`
     - `POST /pptx-audio-tool/:sessionId/slides/:slideIndex/generate-interactions`
     - `GET /pptx-audio-tool/:sessionId/export/moodle-xml`
   - Cập nhật `buildExportSlidesForSession` để tôn trọng các slide tương tác (`interactiveData`, `slideType`, `layoutType`, `extraAudioUrl`, `optimizedContent`) đã được chèn xen kẽ giữa các slide khi đóng gói SCORM 1.2 và H5P.
2. **Frontend (`frontend/src/pages/PptxAudioTool.tsx` & `Steps.css` / `PptxAudioTool.css`)**:
   - Rút gọn `STEPS` từ 5 bước còn 4 bước (`Môn học & Bài`, `Lời giảng & Audio`, `Slide & Xuất học liệu`, `Ngân hàng Câu hỏi`).
   - Xây dựng giao diện Bước 3 (`activeStep === 2`) đồng bộ 100% với `Step5GeneratePPTX.tsx` (sử dụng chung hệ thống class của `Steps.css` + `ImageCropModal`).

## Invariants & Risk
- **Security Verification Plan**:
  - Mọi endpoint thao tác slide đều kiểm tra quyền sở hữu session (`session.userId === userId` hoặc `role === 'ADMIN'`).
  - Upload ảnh (`upload-image`) và audio mẫu (`extraAudio`) kiểm tra định dạng MIME/extension hợp lệ, lưu cô lập trong `/uploads/pptx-tool/{sessionId}/`.

## Progress
- [x] Initial design and verification steps
- [x] Implementation
- [x] Validation

## Validation
- Proof command: `cd backend && npm run build && cd ../frontend && npm run build`
