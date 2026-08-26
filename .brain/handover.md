# 📋 HANDOVER DOCUMENT
## AI Teaching Assistant — Pedagogical Speaker Notes & Chunking Release (v1.5.21)

📍 **Đang làm:** Đã hoàn thành nâng cấp hệ thống tạo lời giảng chuẩn sư phạm, loại bỏ văn phong AI và tối ưu hóa xử lý phân mảnh (Slide Chunking).
🔢 **Đến bước:** Kiểm tra hoạt động trên môi trường chạy thực tế và sẵn sàng đẩy bản phát hành `v1.5.21`.

---

### ✅ ĐÃ XONG (v1.5.21):
- **Cải tiến Prompt Few-Shot Chuẩn Sư Phạm (`slides.speaker-notes`):**
  - Đóng vai Giảng viên đại học giàu kinh nghiệm giảng bài trực tiếp trên lớp.
  - Cấu trúc 4 bước: [Bối cảnh / Đặt vấn đề] ➔ [Bản chất & Ví dụ thực tế] ➔ [Cảnh báo lỗi sai thường gặp] ➔ [Chốt ý & Dẫn dắt].
  - Ràng buộc thời lượng: 200 - 280 từ / slide nội dung (~1.5 - 2 phút nói).
  - Tích hợp mẫu chuẩn Before/After loại bỏ hoàn toàn các câu sáo rỗng AI.
- **Tối ưu Lời giảng cho TTS (`slides.optimize-notes`):**
  - Tách câu dài thành các câu ngắn (10 - 18 từ) có nhịp thở ngắt nghỉ tự nhiên cho VieNeu / TTS.
  - Chuyển đổi mã code, công thức toán học, ký hiệu và từ viết tắt sang văn nói.
  - Bảo toàn độ dài >= 95% đầu vào (giữ nguyên 1.5 - 2 phút).
- **Cơ chế Slide Chunking (Micro-Batching 4 slides/cụm):**
  - Chia nhỏ bài giảng thành các lô 4 slide để AI sinh lời giảng đồng đều từ slide đầu đến slide cuối, triệt tiêu 100% nguy cơ đứt gãy JSON / quá tải token.
  - Tự động duy trì mạch nối ngữ cảnh giữa các slide.
  - Báo cáo tiến độ % thời gian thực qua `GenerationJob` lên giao diện Bước 4.
- **Bộ lọc Hậu kỳ Hybrid Anti-AI (Code Regex):**
  - Quét sạch các cụm từ hoa mỹ/sáo rỗng còn sót lại và định dạng văn bản thô thuần túy cho TTS.
- **Cập nhật phiên bản hệ thống lên `1.5.21`:** Build backend và frontend thành công không lỗi.

---
📍 Đã lưu! Để tiếp tục: Gõ /recap
