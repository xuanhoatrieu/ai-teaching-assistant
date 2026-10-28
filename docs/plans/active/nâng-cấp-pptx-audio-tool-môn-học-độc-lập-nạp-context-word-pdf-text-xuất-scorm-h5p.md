# Nâng cấp PPTX Audio Tool: Môn học độc lập, Nạp Context (Word/PDF/Text) & Xuất SCORM/H5P

## Outcome
- [ ] **1. Quản lý Môn học & Bài học độc lập trong PPTX Tool**:
  - Có model `PptxSubject` riêng biệt trong DB (`id`, `userId`, `name`, `description`, `institutionType`, `expertiseArea`, `courseName`, `targetAudience`, `majorName`, `additionalContext`, `language`, `createdAt`, `updatedAt`).
  - `PptxAudioSession` đóng vai trò là **Bài học (Lesson)** thuộc `PptxSubject` (`pptxSubjectId`, `lessonTitle`), hỗ trợ tương thích ngược cho các session cũ chưa gắn môn học (nhóm "Chưa phân loại" và cho phép di chuyển vào môn học).
  - Giao diện PPTX Tool cho phép Tạo/Sửa/Xóa Môn học độc lập → Chọn Môn học → Tạo Bài học mới (nhập tên bài học, nạp Context, tải file PPTX) → Quản lý danh sách bài học theo từng môn.
- [ ] **2. Bổ sung Context đa nguồn cho Bài học (Word / PDF / Text + Deep PPTX Parser)**:
  - `PptxAudioSession` lưu trữ `contextText` (văn bản hướng dẫn/bài đọc nhập tay hoặc trích xuất) và `contextFileName` (tên file `.docx` / `.pdf` / `.txt` / `.md` đã nạp).
  - API cho phép tải lên file `.docx`, `.pdf`, `.txt`, `.md` (bóc tách text qua `mammoth` / `pdftotext` / `MarkItDownService`) và/hoặc cập nhật ô nhập văn bản `contextText` cho từng bài học (ngay lúc tạo bài hoặc chỉnh sửa bất kỳ lúc nào trong bài học).
  - Nâng cấp Python `_extract_slides_from_pptx` (`main.py`) để trích xuất sâu nội dung từ **Bảng (`Table`)**, **Group Shapes (`GROUP`)**, và trích xuất **Hình ảnh (`PICTURE`)** từ từng slide lưu ra thư mục session (`/uploads/pptx-tool/{sessionId}/images/slide_XX.png`) để phục vụ cả AI lẫn xuất SCORM/H5P.
  - Khi AI sinh **Speaker Notes** (`generateSpeakerNotesBackground`) và **Ngân hàng câu hỏi** (Review, Interactive, English), tự động kết hợp:
    1. Thông tin học thuật của `PptxSubject` (Chuyên ngành, Đối tượng người học, Yêu cầu sư phạm)
    2. Toàn cảnh danh sách tiêu đề các slide trong bài (`Global Slide Map`)
    3. Nội dung `contextText` (từ file Word/PDF + ô văn bản giảng viên nhập)
    4. Nội dung chi tiết + bảng biểu trên từng slide.
- [ ] **3. Xuất gói SCORM 1.2 (`.zip`) & H5P (`.h5p`) trực tiếp trong PPTX Tool**:
  - Tích hợp `packageScormZip` và `packageH5pZip` vào `PptxAudioToolService` & `PptxAudioToolController` kèm cơ chế `DownloadTicketService` (hỗ trợ tải mượt bằng trình duyệt / IDM).
  - Tự động đóng gói tiêu đề bài (`lessonTitle` hoặc `fileName`), nội dung từng slide, hình ảnh trích xuất từ slide PPTX (`imageUrl`), âm thanh lời giảng (`audioUrl`), và các câu hỏi tương tác (`interactive` trong `questionsJson`).
  - Giao diện Step 3 (Download / Xuất học liệu) của PPTX Tool bổ sung bộ chọn **Mẫu nền (Template / BgOption)**, **Chủ đề Sáng/Tối (Theme)** và 2 nút **📦 Xuất SCORM (.zip)**, **🌟 Xuất H5P (.h5p)** giống Step 5 của luồng tạo bài giảng.

## Context & Authority
- Authority: User confirmation in conversation (`1, tạo subject độc lập ở pptx; 2, nạp thêm context cho mỗi bài bằng cách thêm word hoặc pdf + ô nhập văn bản nếu có; 3, đồng ý với phương án đề xuất`)
- Risk lane: `normal`

## Approach
1. **Database & Prisma Migration**:
   - Thêm bảng `PptxSubject` (`pptx_subjects`) vào `backend/prisma/schema.prisma`.
   - Thêm các trường vào `PptxAudioSession` (`pptx_audio_sessions`):
     - `pptxSubjectId String? @map("pptx_subject_id")` (FK tới `PptxSubject`, `onDelete: SetNull`)
     - `lessonTitle String? @map("lesson_title")`
     - `contextText String? @map("context_text")`
     - `contextFileName String? @map("context_file_name")`
   - Chạy migration cập nhật PostgreSQL database và generate Prisma Client.
2. **Python PPTX Parser Upgrade (`backend/utils/pptx_generator/main.py`)**:
   - Nâng cấp `_extract_slides_from_pptx(prs, output_images_dir=None)` để:
     - Đệ quy vào `GROUP` shapes lấy toàn bộ text.
     - Trích xuất dữ liệu từ `TABLE` shapes thành chuỗi bảng có cấu trúc.
     - Trích xuất ảnh chính từ mỗi slide (nếu có shape picture) lưu vào `{sessionDir}/images/slide_{idx:02d}.{ext}` và trả về `imageUrl: "/uploads/pptx-tool/{sessionId}/images/..."` trong `ParsedSlide`.
3. **Backend (`backend/src/pptx-audio-tool/`)**:
   - CRUD cho `PptxSubject`: `GET /pptx-audio-tool/subjects`, `POST /pptx-audio-tool/subjects`, `PUT /pptx-audio-tool/subjects/:id`, `DELETE /pptx-audio-tool/subjects/:id`.
   - Cập nhật Upload & Session APIs để nhận `pptxSubjectId`, `lessonTitle`, `contextText`.
   - Thêm API quản lý bài học & Context:
     - `PUT /pptx-audio-tool/:sessionId/meta` (cập nhật `lessonTitle`, `pptxSubjectId`, `contextText`)
     - `POST /pptx-audio-tool/:sessionId/context-file` (upload file `.docx`, `.pdf`, `.txt`, `.md` → trích xuất text bằng `mammoth` cho `.docx`, `pdftotext` cho `.pdf`, UTF-8 cho `.txt/.md` → lưu vào `contextText` & `contextFileName`).
   - Bơm ngữ cảnh (`PptxSubject` + `lessonTitle` + `Global Slide Map` + `contextText`) vào `generateSpeakerNotesBackground`, `generateReviewQuestions`, `generateInteractiveQuestions`, `generateEnglishQuestions`.
   - Thêm chức năng xuất SCORM 1.2 & H5P kèm Download Ticket:
     - `POST /pptx-audio-tool/:sessionId/export/scorm/ticket` & `GET /pptx-audio-tool/:sessionId/export/scorm/file`
     - `POST /pptx-audio-tool/:sessionId/export/h5p/ticket` & `GET /pptx-audio-tool/:sessionId/export/h5p/file`
     - Hỗ trợ nhúng câu hỏi tương tác của session vào cuối bài giảng SCORM/H5P.
4. **Frontend (`frontend/src/pages/PptxAudioTool.tsx` & `PptxAudioTool.css`)**:
   - Nâng cấp khu vực quản lý đầu vào theo cấu trúc: **Danh sách Môn học PPTX** (Tạo/Sửa/Xóa môn học với thông tin chuyên ngành, đối tượng SV) → **Danh sách Bài học trong môn** → **Tạo Bài học mới** (Đặt tên bài + Nạp Context Word/PDF/Text + Tải file PPTX).
   - Cho phép xem/cập nhật **Ngữ cảnh bổ sung (Word/PDF + Văn bản)** ngay trong bài học bất kỳ lúc nào (ở cả tab Upload/Thông tin bài học và trong Modal tạo lời giảng AI).
   - Ở tab **Download (Xuất học liệu)**: Thêm bảng cấu hình Giao diện SCORM/H5P (Mẫu nền TUAF/Minimal/Custom + Theme Sáng/Tối) và nút xuất **📦 Xuất SCORM (.zip)**, **🌟 Xuất H5P (.h5p)** hoạt động giống hệt Step 5.

## Invariants & Risk
- **Invariants to preserve**:
  - Các `PptxAudioSession` cũ (`pptxSubjectId = null`) vẫn hiển thị và hoạt động bình thường, không mất dữ liệu.
  - Chunked upload cho file PPTX > 25MB vẫn hoạt động và truyền đầy đủ `pptxSubjectId`, `lessonTitle`, `contextText`.
  - Xác thực quyền sở hữu (`userId`) trên mọi thao tác Subject/Session và Download Ticket.
- **Security Verification Plan**:
  - Kiểm tra quyền sở hữu `userId` cho tất cả các endpoint `PptxSubject` và `PptxAudioSession`.
  - Xác thực định dạng file upload cho Context (chỉ cho phép `.docx`, `.pdf`, `.txt`, `.md` với giới hạn kích thước an toàn, dùng `path.basename` và thư mục tạm cô lập khi gọi `pdftotext` bằng `execFile` mảng tham số để chống Command Injection và Path Traversal).
  - Sử dụng `DownloadTicketService` cho các luồng tải SCORM/H5P để không lộ JWT trên URL.

## Progress
- [x] Initial design and verification steps
- [x] Implementation
- [x] Validation

## Recovery & Rollback
- Migration chỉ thêm bảng mới (`pptx_subjects`) và các cột nullable vào `pptx_audio_sessions`, hoàn toàn an toàn và không phá vỡ dữ liệu hiện có.

## Validation
- Proof command: `cd backend && npm test && npm run build && cd ../frontend && npm run build`
