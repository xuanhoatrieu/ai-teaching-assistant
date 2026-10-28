# US-027: Đồng bộ Bước 3 PPTX Audio Tool với Giao diện Bước 5 & Gộp tab Nội dung Slide

- **ID**: `US-027-pptx-tool-step5-workspace`
- **Lane**: `normal`
- **Status**: `completed`

## Mô tả
Nâng cấp Bước 3 của PPTX Audio Tool (`Biên tập Slide & Xuất học liệu`) để có giao diện và tính năng tương đồng 100% với Bước 5 (`Step5GeneratePPTX.tsx`) trong luồng tạo bài giảng, đồng thời gộp tab `Nội dung Slide` vào bước này giúp quy trình PPTX Tool gọn thành 4 bước.

## Tiêu chí nghiệm thu (Acceptance Criteria)
- [x] Thanh Stepper của PPTX Tool rút gọn thành 4 bước: `1. Môn học & Bài`, `2. Lời giảng & Audio`, `3. Slide & Xuất học liệu`, `4. Ngân hàng Câu hỏi`.
- [x] Bước 3 có Thanh cấu hình Giao diện (`Mẫu giao diện PowerPoint` kèm ảnh preview, `Giao diện xuất SCORM & H5P` 4 chế độ, `Chủ đề màu sắc Sáng/Tối`) và hàng nút hành động (`Tải PPTX có Audio`, `Xuất SCORM .zip`, `Xuất H5P .h5p`, `Xuất Moodle Quiz XML`, `❓ Hướng dẫn Moodle`).
- [x] Danh sách Slide hiển thị dạng Card 2 cột: chọn bố cục (`layoutType`), di chuyển/xóa slide, sửa trực tiếp tiêu đề & gạch đầu dòng (`✏️ Sửa nội dung`), AI tối ưu nội dung/tạo ảnh minh họa, đổi/cắt ảnh (`📤 Đổi ảnh` với `ImageCropModal`), tải audio mẫu (`🎧 Tải audio mẫu`).
- [x] Giữa các slide có thanh chèn `+ Lý thuyết` và `+ Tương tác`, kèm Modal cấu hình Slide Tương tác 7 dạng câu hỏi & chính sách chặn bài Mastery Gate.
- [x] Khi xuất SCORM 1.2 và H5P, hệ thống kết xuất đúng bố cục (`layoutType`), ảnh slide, nội dung tối ưu, audio lời giảng, audio mẫu và các slide tương tác Mastery Gate đã chèn giữa bài.
