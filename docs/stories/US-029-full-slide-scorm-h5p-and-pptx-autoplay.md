# US-029: Full-Slide SCORM/H5P Export cho PPTX Tool & Auto-Play Audio PPTX chuẩn OOXML

- **Status**: `done`
- **Plan**: `docs/plans/completed/đồng-bộ-scorm-h5p-full-slide-cho-pptx-tool-và-auto-play-audio-pptx-chuẩn-ooxml.md`

## Acceptance Criteria
- [x] Khi tải file `.pptx` có Audio ở cả **Tạo bài giảng** và **PPTX Audio Tool**, mở bằng Microsoft PowerPoint nhận ngay `Playback -> Start: Automatically` (tương đương 100% kết quả của `auto_audio_converter_gui.py`), đồng thời giữ nguyên các animation gốc của slide.
- [x] Khi xuất **SCORM 1.2 (`.zip`)** và **H5P (`.h5p`)** ở **PPTX Audio Tool**, các slide gốc từ PPTX được render thành ảnh Full-Slide 16:9 sắc nét (giữ 100% bố cục, bảng biểu, IPA, trang bìa), kế thừa trọn vẹn khung Interactive Player của Tạo bài giảng (Header TUAF, Sáng/Tối, tự động phát lời giảng, audio mẫu, câu hỏi tương tác & chặn bài Mastery Gate, đồng bộ điểm lên Moodle LMS).
- [x] Hỗ trợ tự động render bổ sung (on-demand) cho cả các phiên PPTX Audio Tool cũ mà không bắt người dùng upload lại file `.pptx`.
