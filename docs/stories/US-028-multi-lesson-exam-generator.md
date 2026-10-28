# US-028: Tạo Bộ Câu Hỏi Bài Kiểm Tra Theo Nhóm Bài Học (Multi-Lesson Grounded Exam Generator)

- **Status**: `done`
- **Plan**: `docs/plans/active/tạo-bộ-câu-hỏi-bài-kiểm-tra-theo-nhóm-bài-học-multi-lesson-exam-generator.md`

## Acceptance Criteria
- [x] Hỗ trợ cả 2 luồng: Môn học chính (`SubjectDetail.tsx`) và PPTX Audio Tool (`PptxAudioTool.tsx` ở cấp `PptxSubject`).
- [x] Tạo mới 100% số lượng câu hỏi được yêu cầu (VD: 50 câu) từ danh sách các bài học được chọn (VD: Bài 1 → Bài 6), tuyệt đối không hỏi kiến thức ngoài các bài học được chọn, đồng thời đối chiếu câu hỏi ôn tập / tiếng Anh đã có của từng bài để giữ chuẩn phong cách và chống trùng lặp.
- [x] Xuất Moodle XML gom toàn bộ câu hỏi của bài kiểm tra vào **1 Category duy nhất** theo tên được đặt (VD: `$course$/top/Giua_Ky_Bai_1_6`).
- [x] Kế thừa tối đa code sẵn có (`moodle-xml.helper.ts`, `GenerationJobService`, `AiProviderService`, `ModelConfigService`, `useJobPolling`, `ModelSelector`).

## Verification Proof
- Unit tests: `cd backend && npx jest src/questions/moodle-xml.helper.spec.ts` (22/22 passed)
- Backend build: `cd backend && npm run build` (exit code 0)
- Frontend build: `cd frontend && npm run build` (exit code 0)
