# Đồng bộ SCORM/H5P Full-Slide cho PPTX Tool và Auto-Play Audio PPTX chuẩn OOXML

## Outcome
- [x] **1. Chuẩn hóa OOXML Audio Auto-Play (`Start: Automatically`) cho cả Tạo bài giảng và PPTX Audio Tool**:
  - Nâng cấp `_set_audio_autoplay_xml` trong `backend/utils/pptx_generator/pptx_service.py` theo chuẩn OOXML đối chiếu từ `auto_audio_converter_gui.py` (`fix_slide`):
    - Cặp điều kiện kích hoạt khi mở slide: `<p:cond delay="indefinite"/>` + `<p:cond evt="onBegin" delay="0"><p:tn val="{mainSeq_id}"/></p:cond>` trên `<p:cTn>` bao ngoài.
    - Điều kiện chuyển slide `<p:prevCondLst>` (`onPrev`) & `<p:nextCondLst>` (`onNext`) trên thẻ `<p:seq>`.
    - Node media nền `<p:audio><p:cMediaNode>` dưới `tmRoot/childTnLst` có `onStopAudio` và `<p:spTgt spid="{shape_id}"/>`.
    - `nodeType="afterEffect"` cho `presetClass="mediacall"`.
    - Bảo toàn toàn bộ hiệu ứng animation sẵn có (`existing_timing`) của slide gốc khi chèn audio ở luồng PPTX Audio Tool (`/inject-audio`), tự cấp `cTn id = max_id + 1`.
- [x] **2. Render Full-Slide PNG sắc nét từ PPTX gốc & Kế thừa trọn vẹn SCORM 1.2 / H5P Player của Tạo bài giảng**:
  - Cập nhật `backend/utils/pptx_generator/Dockerfile` bổ sung `libreoffice-impress`, `libreoffice-common`, `poppler-utils` và bộ font Unicode/Tiếng Việt/IPA (`fonts-liberation`, `fonts-dejavu-core`, `fonts-noto-core`, `fonts-freefont-ttf`).
  - Bổ sung hàm `_render_pptx_slides_to_png` (dùng `subprocess.run` với `shell=False` và profile LibreOffice cô lập `-env:UserInstallation=...`) cùng endpoint `POST /render-pptx-slides` và tích hợp trực tiếp vào `POST /parse-pptx-local` trong `backend/utils/pptx_generator/main.py`.
  - Lọc bỏ placeholder số trang (`sldNum`) khi bóc tách text trong `_extract_slides_from_pptx` để không làm bẩn dữ liệu bullet/AI.
  - Cập nhật `PptxAudioToolService` (`backend/src/pptx-audio-tool/pptx-audio-tool.service.ts`) & `PptxAudioToolController` (`backend/src/pptx-audio-tool/pptx-audio-tool.controller.ts`):
    - Bổ sung `ensureRenderedSlidesForSession(sessionId)` tự động render và cache `renderedSlideUrl` cho cả các phiên cũ chưa re-upload.
    - Trong `buildExportSlidesForSession`, gán `layoutType: 'full_slide_canvas'` và `imageUrl: s.renderedSlideUrl` cho các slide gốc PPTX chưa bị thay đổi bố cục/ảnh thủ công, đồng thời giữ nguyên 100% các layout tương tác của Tạo bài giảng (`checkpoint_gate`, `audio_lab`, `split_standard`, `comparison_3col`, `process_steps`...) cho các slide thêm mới hoặc tối ưu bằng AI.
  - Cập nhật `backend/src/slides/scorm-export.helper.ts` & `backend/src/slides/h5p-export.helper.ts`:
    - Hỗ trợ `layoutType === 'full_slide_canvas'` cho mọi slide (kể cả Slide bìa `idx === 0`), hiển thị trọn vẹn slide gốc 16:9 sắc nét kèm tự động phát lời giảng, nút `🔊 Nghe lời giảng`, nút `⛶ Toàn màn hình`, audio mẫu và câu hỏi tương tác đính kèm.
    - Khắc phục lỗi Slide bìa (`idx === 0`) ở chế độ HTML truyền thống (vẫn hiển thị subtitle/bullets nếu có) và chuẩn hóa MIME type động (`.wav` / `.mp3` / `.jpg` / `.png`) trong H5P.
  - Cập nhật `frontend/src/pages/PptxAudioTool.tsx`: Đồng bộ `link.download = ''` trong `triggerNativeDownload` giống `Step5GeneratePPTX.tsx` và thêm tùy chọn bố cục `full_slide_canvas`.
- [x] **3. Kiểm thử Tự động (Unit Tests + Thực chứng trên file PPTX thực tế)**:
  - Unit test Python kiểm chứng mọi slide sinh bởi `_add_audio_with_autoplay` đạt chuẩn OOXML 100% (chạy qua `fix_slide` của `auto_audio_converter_gui.py` trả về `changed == False`, bảo toàn animation cũ nếu có).
  - Unit test Jest cho `scorm-export.helper.ts` & `h5p-export.helper.ts` (`full_slide_canvas`, cover slide, path boundary security, dynamic audio MIME).
  - Kiểm thử thực tế render 27 slides từ file PPTX thực trong `uploads/pptx-tool` và build sạch cả `backend` + `frontend`.

## Invariants & Risk
- **Invariants to preserve**:
  - Tuyệt đối không phá vỡ luồng xuất PPTX / SCORM / H5P hiện có của **Tạo bài giảng (Step 5)**.
  - Các phiên PPTX Audio Tool đã tạo trước đó hoạt động bình thường, không bắt buộc người dùng upload lại file `.pptx` hay tạo lại audio TTS.
  - Không làm mất hiệu ứng chuyển động (animations) sẵn có trên slide của giảng viên khi chèn audio vào PPTX.

## Security Review & Verification Plan
- **System Command Execution (`subprocess.run`)**: Tuyệt đối không dùng `shell=True`; chỉ gọi mảng tham số cố định `['soffice', ...]` và `['pdftoppm', ...]`, kiểm tra đường dẫn `os.path.realpath(file_path)` nằm trong thư mục được phép (`uploads` hoặc `tmp`) và tồn tại thật trước khi thực thi.
- **Path Traversal & File System Boundary (`resolveLocalMediaFile`)**: Chuẩn hóa đường dẫn bằng `path.resolve()` và kiểm tra prefix có dấu phân cách thư mục (`resolved.startsWith(uploadsRoot + path.sep)` / `datauserRoot + path.sep`) trước khi đọc file đóng gói vào ZIP SCORM/H5P.
- **Authentication & Resource Ownership**: Mọi API lấy ticket tải SCORM/H5P (`POST /pptx-audio-tool/:sessionId/export/{scorm|h5p}/ticket`) tiếp tục xác thực JWT và kiểm tra quyền sở hữu `assertPptxSessionAccess` + header `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`.
- **XSS Prevention**: Mọi chuỗi nhúng vào XML/HTML manifest và player đều đi qua `escapeXml` / `escapeHtml` và serialize JSON an toàn; trên React sử dụng JSX auto-escaping, không dùng `dangerouslySetInnerHTML`.

## Progress
- [x] Khảo sát mã nguồn và thống nhất giải pháp kỹ thuật với người dùng
- [x] Triển khai Phase 1: Python `pptx_service.py`, `main.py`, `Dockerfile` + Python unit test
- [x] Triển khai Phase 2: NestJS `scorm-export.helper.ts`, `h5p-export.helper.ts`, `pptx-audio-tool.service.ts`, `pptx-audio-tool.controller.ts` + Jest unit tests
- [x] Triển khai Phase 3: Frontend `PptxAudioTool.tsx` + Full build & E2E verification

## Validation
- `python3 -m unittest backend/utils/pptx_generator/test_autoplay_and_render.py`
- `cd backend && npx jest src/slides/scorm-h5p-export.helper.spec.ts src/questions/moodle-xml.helper.spec.ts && npm run build`
- `cd frontend && npm run build`
