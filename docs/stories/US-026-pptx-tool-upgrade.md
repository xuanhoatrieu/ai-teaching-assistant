# US-026: Nâng cấp PPTX Audio Tool — Môn học độc lập, Nạp Context (Word/PDF/Text) & Xuất SCORM/H5P

- **ID**: `US-026-pptx-tool-upgrade`
- **Lane**: `normal`
- **Status**: `done`

## Mô tả
Nâng cấp công cụ PPTX Audio Tool theo 3 hạng mục được người dùng chốt:
1. **Tạo Môn học độc lập (`PptxSubject`) → Tạo Bài học (`PptxAudioSession`)** ngay trong PPTX Tool (do khi giảng viên đã có sẵn file PPTX thì thường không tạo môn học ở luồng tạo bài giảng 6 bước).
2. **Nạp thêm Context cho mỗi bài học** bằng cách tải lên file Word (`.docx`) hoặc PDF (`.pdf`) + ô nhập văn bản (`contextText`), kết hợp nâng cấp bộ đọc PPTX Python (đọc cả Bảng biểu, Group shapes, trích xuất hình ảnh) để AI sinh lời giảng và câu hỏi sâu sắc, bám sát nội dung học thuật.
3. **Xuất gói SCORM 1.2 (`.zip`) và H5P (`.h5p`)** trực tiếp trong PPTX Tool với đầy đủ tùy chọn mẫu nền (Template/BgOption) và giao diện Sáng/Tối (Theme) giống như ở Step 5 trong luồng tạo bài giảng.

## Tiêu chí nghiệm thu (Acceptance Criteria)
- [x] Có thể Tạo / Sửa / Xóa Môn học độc lập (`PptxSubject`) trong PPTX Tool với thông tin: Tên môn, Mô tả, Cấp đào tạo, Chuyên ngành, Đối tượng người học, Ngôn ngữ, Yêu cầu bổ sung.
- [x] Trong mỗi Môn học, có thể Tạo Bài học mới (nhập Tên bài học, nạp file Word/PDF hoặc nhập văn bản ngữ cảnh, và upload file `.pptx`). Các bài PPTX cũ chưa phân loại vẫn hiển thị đầy đủ và có thể gán vào môn học bất kỳ.
- [x] Bóc tách văn bản từ file `.docx` (qua `mammoth`), `.pdf` (qua `pdftotext`), `.txt`/`.md` và lưu vào `contextText` + `contextFileName` của bài học; cho phép xem và chỉnh sửa trực tiếp `contextText` trên giao diện.
- [x] Bộ đọc PPTX Python (`_extract_slides_from_pptx`) trích xuất được chữ trong `Table`, `Group Shapes` và xuất ảnh của từng slide ra thư mục session để hiển thị/đóng gói.
- [x] Khi AI tạo Speaker Notes và Câu hỏi (Review, Interactive, English), prompt tự động nhận đầy đủ ngữ cảnh từ `PptxSubject`, `lessonTitle`, `Global Slide Map` và `contextText`.
- [x] Tại bước Download của PPTX Tool, người dùng có thể chọn Mẫu nền + Chủ đề Sáng/Tối và bấm xuất gói **SCORM 1.2 (.zip)** hoặc **H5P (.h5p)** tải về qua cơ chế `DownloadTicketService`.
