# 📋 HANDOVER DOCUMENT
## AI Teaching Assistant — Async Packaging & Audio Pipeline Release (v1.5.25)

📍 **Đang làm:** Đã hoàn thành toàn bộ hệ thống đóng gói PowerPoint bất đồng bộ kèm Audio (Step 5), nâng cấp tiến trình tạo âm thanh nền (Step 4), tối ưu bộ nhớ tạm thời tự động dọn dẹp (Ephemeral Storage) và điều chỉnh nhịp hiển thị tiến trình mượt mà.
🔢 **Đến bước:** Đã kiểm thử thực tế, lưu thông tin phiên làm việc và chuẩn bị commit & push gắn tag `v1.5.25` lên GitHub.

---

### ✅ ĐÃ XONG (v1.5.25):

1. **Hệ thống đóng gói PPTX bất đồng bộ kèm Audio (Step 5):**
   - Chuyển đổi đóng gói PPTX sang `GenerationJob` chạy ngầm, không block trình duyệt, hỗ trợ hủy tiến trình giữa chừng.
   - Kết nối trực tiếp giữa Python FastAPI và NestJS qua dòng sự kiện NDJSON (`/generate-stream`), thông báo từng slide theo thời gian thực.
   - Sửa lỗi lệch chỉ số slide (`slideIndex + 1`) giữa dữ liệu kịch bản và ảnh/audio.
   - Cơ chế lưu trữ tạm thời tự động dọn dẹp (`uploads/temp-pptx/`): tạo file tạm khi đóng gói và tự động dọn dẹp sạch sẽ khi rời trang / đổi template / chuyển bước.
   - Endpoint phát hiện file tạm `GET /lessons/:lessonId/pptx/temp-status` cho phép khôi phục nút tải và dung lượng file ngay cả khi F5 reload trang.
   - Banner tải file nổi bật **🎉 ĐÃ ĐÓNG GÓI XONG** kèm dung lượng file MB thực tế và nút CTA lớn trực quan.
   - Khắc phục hiện tượng tiến trình nhảy vọt lên 95%: rút ngắn chu kỳ polling xuống 600ms, phân bổ tiến trình hợp lý (nhúng slide 8% ➔ 63% với micro-pacing 40ms/slide, nén đa phương tiện 65% ➔ 95% qua các giai đoạn rõ ràng).

2. **Hệ thống tạo âm thanh nền bất đồng bộ (Step 4):**
   - Chuyển đổi tiến trình sinh âm thanh hàng loạt sang Background Job (`audio-generation`), hiển thị tiến độ từng slide chi tiết.
   - Hỗ trợ khôi phục tiến trình khi reload trang (`checkActiveJob`) và hủy tác vụ (`cancelJob`).
   - Tích hợp trình phát nghe thử audio kèm sóng âm, nút tải gói toàn bộ âm thanh bài học định dạng ZIP.

3. **Tối ưu hóa TTS & ViTTS:**
   - Hỗ trợ song song ViTTS hệ thống và ViTTS cá nhân, tự động khử trùng lặp IP server.
   - Tối ưu hóa timeout tổng hợp giọng nói cho các đoạn lời giảng dài.

---
📍 Đã lưu! Để tiếp tục: Gõ /recap
