# 📋 HANDOVER DOCUMENT
## AI Teaching Assistant — Background Jobs & VPS Docker Hotfix

📍 **Đang làm:** Sửa lỗi luồng chạy nền PPTX Step 5 & Khắc phục lỗi upload tài liệu trên VPS Docker
🔢 **Đến bước:** Đã hoàn thành sửa lỗi & Kiểm thử cục bộ thành công 100% — Chờ người dùng build lại Docker image và triển khai lên VPS.

---

### ✅ ĐÃ XONG:
- **Hotfix Luồng Chạy Nền Step 5 (Frontend):**
  - Sửa lỗi ghi đè trạng thái trong `loadSavedContent` ở `Step5GeneratePPTX.tsx`: Tránh đặt status thành `'completed'` khi có tác vụ chạy nền đang hoạt động.
  * Tối ưu hóa phase hiển thị của slide cards ở frontend để hiển thị `'optimizing_content'` hoặc `'generating_image'` tương ứng thay vì hiển thị `'error'` khi job đang chạy.
- **Dọn dẹp Tác vụ Mồ côi (Backend Startup):**
  - Thêm logic dọn dẹp các background job bị kẹt ở trạng thái `pending`/`processing` when NestJS khởi động lại (trong `main.ts`).
- **API Guard Tránh Trùng lặp (Backend Controller):**
  - Thêm chốt chặn duplicate job trong `SlideAudioController` ở backend.
- **Khắc phục lỗi Mimetype & MarkItDown trên VPS Docker:**
  - Thay thế `FileTypeValidator` ở API `importSyllabus` và `uploadOutline` bằng hàm kiểm tra phần mở rộng file (Extension Check) case-insensitive trực tiếp ở logic controller.
  - Cập nhật `Dockerfile` cài đặt `python3`, `py3-pip` và thư viện CLI `markitdown` ở stage `production`.
- **Hỗ trợ Import Đề Cương Cũ & Điền Mẫu Mới (Option 1):**
  - Tối ưu hóa System Prompt `SYLLABUS_PARSE_SYSTEM_PROMPT` giúp AI nhận diện ngữ nghĩa linh hoạt từ các đề cương mẫu cũ sang 10 mục chuẩn mới.
- **Tạo Đề Cương Mới Theo Định Dạng Bảng Chuẩn:**
  - Thiết lập định dạng bảng biểu, cấu trúc và tiêu đề mẫu mặc định (`defaultContent`) cho 10 mục đề cương chi tiết (theo mẫu chuẩn TUAF 2026) khi tạo mới thay vì để trống text đơn thuần.

### ⏳ CÒN LẠI / CẦN LÀM TIẾP:
- Đã được user phê duyệt push code. Tiến hành commit, tạo tag `v1.5.8` và push lên GitHub để kích hoạt Github Actions build image mới cho VPS.

### 🔧 QUYẾT ĐỊNH QUAN TRỌNG:
- Bỏ qua `FileTypeValidator` của NestJS khi upload tài liệu do trình duyệt gửi mimetype thiếu chính xác. Dùng case-insensitive extension check là giải pháp an toàn nhất.
- Đóng gói đầy đủ python + markitdown vào container môi trường production của backend.
- Sử dụng AI semantic mapping cho đề cương cũ thay vì viết code parser thủ công.

### 📁 FILES CHÍNH ĐÃ THAY ĐỔI:
- `~` [backend/src/main.ts](file:///home/trieuhoa/ai-teaching-assistant/backend/src/main.ts)
- `~` [backend/src/slide-audio/slide-audio.controller.ts](file:///home/trieuhoa/ai-teaching-assistant/backend/src/slide-audio/slide-audio.controller.ts)
- `~` [backend/src/syllabus/syllabus.controller.ts](file:///home/trieuhoa/ai-teaching-assistant/backend/src/syllabus/syllabus.controller.ts)
- `~` [backend/src/syllabus/syllabus.service.ts](file:///home/trieuhoa/ai-teaching-assistant/backend/src/syllabus/syllabus.service.ts)
- `~` [backend/src/lessons/lessons.controller.ts](file:///home/trieuhoa/ai-teaching-assistant/backend/src/lessons/lessons.controller.ts)
- `~` [backend/Dockerfile](file:///home/trieuhoa/ai-teaching-assistant/backend/Dockerfile)
- `~` [frontend/src/components/steps/Step5GeneratePPTX.tsx](file:///home/trieuhoa/ai-teaching-assistant/frontend/src/components/steps/Step5GeneratePPTX.tsx)

---
📍 Đã lưu! Để tiếp tục: Gõ /recap
