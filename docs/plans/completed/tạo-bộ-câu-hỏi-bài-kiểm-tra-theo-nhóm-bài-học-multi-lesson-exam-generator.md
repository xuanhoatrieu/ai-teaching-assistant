# Tạo Bộ Câu Hỏi Bài Kiểm Tra Theo Nhóm Bài Học (Multi-Lesson Exam Generator)

## Outcome
- [x] **1. Mô hình Dữ liệu Dùng chung (`ExamQuestionSet`) cho cả 2 luồng (`Subject` & `PptxSubject`)**:
  - Thêm model `ExamQuestionSet` (`exam_question_sets`) vào `backend/prisma/schema.prisma` (và tự động khởi tạo an toàn `CREATE TABLE IF NOT EXISTS` khi khởi động):
    - `id`, `userId`, `subjectId` (nullable, FK tới `Subject` cho luồng Môn học chính), `pptxSubjectId` (nullable, FK tới `PptxSubject` cho luồng PPTX Audio Tool).
    - `title` (Tên bài kiểm tra, VD: *"Giữa kỳ 1 - Bài 1 đến Bài 6"*).
    - `categoryName` (Tên Category duy nhất khi xuất Moodle XML, VD: `Giua_Ky_Bai_1_6`).
    - `mode` (`REVIEW` — Trắc nghiệm 4 lựa chọn A/B/C/D theo Bloom | `ENGLISH` — 5 dạng chấm tự động `MC, MR, MATCH, CLOZE, TRUEFALSE`).
    - `lessonIdsJson` (Mảng ID và tiêu đề các bài học được chọn + số lượng câu phân bổ cho từng bài).
    - `configJson` (Cấu hình tổng số câu, tỷ lệ mức độ `level1/level2/level3`, danh sách `questionTypes`, `subDiscipline`).
    - `questionsJson` (Mảng câu hỏi chuẩn hóa có kèm `sourceLessonId`, `sourceLessonTitle`, `sourceSection` để truy vết nguồn gốc từng câu).
- [x] **2. Thuật toán Sinh Câu hỏi "Chia để trị theo từng Bài học" (Per-Lesson Closed-World Pipeline) & Kế thừa 100% Parser/Helper sẵn có**:
  - Khi giảng viên chọn $K$ bài học (VD: Bài 1 → Bài 6) và yêu cầu tạo mới 100% tổng $N$ câu (VD: 50 câu):
    - Hệ thống chia chỉ tiêu số câu cho từng bài học $i \in \{1..K\}$ (tự động chia đều hoặc theo số câu giảng viên tinh chỉnh trên giao diện).
    - Chạy bất đồng bộ qua `GenerationJobService` (cập nhật tiến trình theo từng bài: *"Đang tạo câu hỏi từ Bài 2/6 (18/50 câu)..."*).
    - Ở mỗi bài học $i$:
      1. **Trích xuất Nội dung Bài học $i$ (`LESSON CONTENT`)**:
         - Với `Subject`: Gộp `syllabusLesson.textbookContent` (Giáo trình), `slides` (`title`, `content`, `speakerNote`), `slideScript`, `detailedOutline`, `outlineRaw`.
         - Với `PptxSubject`: Gộp `contextText` (tài liệu Word/PDF/văn bản), `slidesJson` (`title`, `content`, `speakerNote`), `contentJson`.
      2. **Trích xuất Câu hỏi Đã tạo của Bài học $i$ (`EXISTING REFERENCE QUESTIONS`)**:
         - Với `Subject`: Lấy `reviewQuestions` và `englishQuestions` của Bài $i$.
         - Với `PptxSubject`: Lấy `questionsJson.review` và `questionsJson.english` của phiên Bài $i$.
      3. **Gọi AI với Khóa "Closed-World & Anti-Duplication"**:
         - Kế thừa `PromptComposerService` (`questions.review` / `questions.english`) kết hợp khối chỉ dẫn **CLOSED-WORLD EXAM GROUNDING**:
           - **Tuyệt đối chỉ hỏi kiến thức nằm trong Bài $i$** (cấm 100% việc đưa kiến thức ngoài bài học).
           - **Tham khảo các câu hỏi đã có của Bài $i$** để giữ đúng chuẩn thuật ngữ/độ khó nhưng **tạo mới 100% câu hỏi** (đổi ngữ cảnh, ví dụ, góc hỏi; cấm chép lại câu cũ).
           - Mỗi câu hỏi trả về có gắn `sourceLessonId`, `sourceLessonTitle` và `sourceSection` (mục kiến thức trong bài).
      4. **Kế thừa Bộ chuẩn hóa sẵn có**:
         - Dùng lại `stripOptionPrefix()`, `cleanExplanation()`, `extractMatchPairs()`, `isMatchingQuestionText()` từ `moodle-xml.helper.ts` và logic chuẩn hóa của `EnglishQuestionService` / `ReviewQuestionService`.
- [x] **3. Xuất Moodle XML 1 Category duy nhất & Xuất Excel (`.xlsx`)**:
  - Mở rộng nhẹ `moodle-xml.helper.ts` thêm hàm `buildSingleCategoryExamMoodleXml()` **tái sử dụng trực tiếp** `buildQuestionXml()` (cho `REVIEW`) và `buildEnglishQuestionXml()` (cho `ENGLISH`), gom toàn bộ câu hỏi của bộ đề vào **1 `<category>` duy nhất** là `$course$/top/{categoryName}` (VD: `$course$/top/Giua_Ky_Bai_1_6`).
  - Xuất Excel (`.xlsx`) tái sử dụng cấu trúc bảng của `ReviewQuestionService` / `EnglishQuestionService` và bổ sung cột **Bài học nguồn (`Source Lesson`)**.
- [x] **4. Giao diện Dùng chung `<ExamManagerPanel />` tích hợp ở CẢ 2 NƠI (`SubjectDetail.tsx` & `PptxAudioTool.tsx`)**:
  - Viết **1 component dùng chung duy nhất** `frontend/src/components/exam/ExamManagerPanel.tsx` và nhúng vào:
    1. Trang Chi tiết Môn học chính (`SubjectDetail.tsx` — Tab `📝 Bài kiểm tra`).
    2. Trang Công cụ PPTX Audio (`PptxAudioTool.tsx` — Nút/Khu vực `📝 Bài kiểm tra của môn` khi chọn một `PptxSubject`).

---

## Context & Authority
- Authority: User confirmation (`1. làm cả 2 nơi; 2. tạo mới 100; 3. cho hết vào 1 category, đặt tên như vd; chú ý kế thừa các code đã có sẵn, ko cần viết lại code. phải tạo check list công việc để đảm bảo không bị bỏ sót`)
- Risk lane: `normal`

---

## Master Checklist Công Việc (Đảm bảo không bỏ sót)

### Phase 1: Database & Moodle XML Single-Category Helper
- [x] **1.1.** Thêm model `ExamQuestionSet` vào `backend/prisma/schema.prisma` và chạy `npx prisma db push` + `npx prisma generate`.
- [x] **1.2.** Thêm hàm `toMoodleCategorySlug(rawName: string)` và `buildSingleCategoryExamMoodleXml()` vào `backend/src/questions/moodle-xml.helper.ts` (tái sử dụng `buildQuestionXml` và `buildEnglishQuestionXml`, xuất toàn bộ câu hỏi vào đúng 1 category `$course$/top/{categoryName}`).
- [x] **1.3.** Bổ sung unit test trong `backend/src/questions/moodle-xml.helper.spec.ts` kiểm chứng:
  - Toàn bộ 50 câu (cả chế độ `REVIEW` lẫn `ENGLISH`) nằm trong đúng 1 `<question type="category">` duy nhất.
  - Không có câu `essay` hay `shortanswer` lọt vào XML.

### Phase 2: Backend Service & API Endpoints (Kế thừa Code sẵn có)
- [x] **2.1.** Tạo `ExamSetService` (`backend/src/questions/exam-set.service.ts`) và `ExamSetController` (`backend/src/questions/exam-set.controller.ts`) đăng ký trong `QuestionsModule`:
  - Tự động đảm bảo bảng `exam_question_sets` tồn tại khi `onModuleInit()`.
  - `GET /exam-sets?subjectId=...&pptxSubjectId=...`: Lấy danh sách các bộ câu hỏi kiểm tra của môn học.
  - `GET /exam-sets/:id`: Xem chi tiết bộ câu hỏi kiểm tra.
  - `POST /exam-sets/generate-async`: Khởi tạo `GenerationJob` chạy ngầm tạo mới 100% $N$ câu hỏi qua các bài học được chọn (`lessonIds` hoặc `pptxSessionIds`):
    - Thu thập nội dung bài học + câu hỏi ôn tập / câu tiếng Anh sẵn có của từng bài làm ngữ cảnh đối chiếu.
    - Chia chỉ tiêu câu hỏi cho từng bài học (hỗ trợ cả chia đều tự động lẫn chỉ tiêu tùy chỉnh từng bài).
    - Gọi AI theo từng bài với khóa `CLOSED-WORLD` & `ANTI-DUPLICATION`, chuẩn hóa bằng các hàm sẵn có trong `moodle-xml.helper.ts`.
  - `POST /exam-sets/:id/append-async`: Tạo thêm câu hỏi bổ sung vào bộ đề kiểm tra hiện có.
  - `PUT /exam-sets/:id`: Cập nhật tên bộ đề, `categoryName`, hoặc sửa/xóa câu hỏi trong bộ đề.
  - `DELETE /exam-sets/:id`: Xóa bộ đề kiểm tra.
  - `GET /exam-sets/:id/export/moodle-xml`: Xuất file `.xml` chuẩn Moodle với 1 category duy nhất `$course$/top/{categoryName}`.
  - `GET /exam-sets/:id/export/excel`: Xuất file `.xlsx` có cột Bài học nguồn (`Source Lesson`) và Mức độ / Loại câu hỏi.

### Phase 3: Frontend Shared Component `<ExamManagerPanel />` & Tích hợp 2 Nơi
- [x] **3.1.** Tạo API client `frontend/src/lib/exam-sets-api.ts`.
- [x] **3.2.** Xây dựng component dùng chung `frontend/src/components/exam/ExamManagerPanel.tsx` (kế thừa `useJobPolling`, `ModelSelector`, và kiểu hiển thị thẻ câu hỏi từ `Step6QuestionBank.tsx`):
  - Danh sách các bộ câu hỏi kiểm tra đã tạo trong môn học.
  - Modal / Form **Tạo bộ câu hỏi kiểm tra mới**:
    - Nhập tên bài kiểm tra (tự động gợi ý `categoryName` không dấu, VD: `Giua_Ky_Bai_1_6`, cho phép sửa trực tiếp).
    - Tick chọn các bài học (VD: Bài 1 → Bài 6, có nút *Chọn tất cả* / *Chọn khoảng bài*). Hiển thị số lượng nội dung & câu hỏi sẵn có của từng bài.
    - Chọn chế độ: **Câu hỏi Trắc nghiệm Đa ngành (Bloom 3 mức)** hoặc **Câu hỏi Tiếng Anh Tự động chấm (MC, MR, MATCH, CLOZE, TRUEFALSE)**.
    - Nhập tổng số câu (VD: `50` câu) → Tự động tính số câu phân bổ cho từng bài học (cho phép giảng viên chỉnh tay số câu từng bài nếu muốn).
  - Thanh tiến trình `useJobPolling` hiển thị tiến độ tạo câu hỏi theo từng bài học.
  - Giao diện xem, lọc theo Bài học nguồn / Mức độ / Loại câu, sửa/xóa từng câu, tạo thêm câu, và 2 nút **`📋 Xuất Moodle XML (1 Category)`** + **`📊 Xuất Excel (.xlsx)`**.
- [x] **3.3.** Nhúng `<ExamManagerPanel mode="subject" ... />` vào trang **Chi tiết Môn học chính (`frontend/src/pages/SubjectDetail.tsx`)** dưới dạng Tab mới **`📝 Bài kiểm tra`**.
- [x] **3.4.** Nhúng `<ExamManagerPanel mode="pptx-subject" ... />` vào trang **PPTX Audio Tool (`frontend/src/pages/PptxAudioTool.tsx`)** ngay trong khu vực quản lý Môn học PPTX (`PptxSubject`) để tạo đề kiểm tra từ các bài học PPTX (`PptxAudioSession`).

### Phase 4: Kiểm thử & Xác thực (Validation)
- [x] **4.1.** Chạy unit tests: `cd backend && npx jest src/questions/moodle-xml.helper.spec.ts`.
- [x] **4.2.** Kiểm tra build TypeScript toàn dự án: `cd backend && npm run build && cd ../frontend && npm run build`.

---

## Invariants & Risk
- **Invariants to preserve**:
  - Kế thừa tối đa `moodle-xml.helper.ts`, `GenerationJobService`, `AiProviderService`, `ModelConfigService`, `useJobPolling`, `ModelSelector` — không nhân bản logic xử lý XML hay chuẩn hóa câu hỏi.
  - 100% câu hỏi xuất ra Moodle XML đều chấm tự động (`MC`, `MR`, `MATCH`, `CLOZE`, `TRUEFALSE`), gom vào đúng 1 `<category>` duy nhất theo tên đã cấu hình.
  - Tuyệt đối không sinh câu hỏi ngoài phạm vi nội dung các bài học được tick chọn.
  - Mọi truy vấn và thao tác trên `ExamQuestionSet` đều kiểm tra quyền sở hữu `userId`.

## Progress
- [x] Initial design and verification steps
- [x] Implementation
- [x] Validation

## Recovery & Rollback
- Bảng mới `exam_question_sets` hoàn toàn độc lập, không làm thay đổi cấu trúc các bảng hiện có (`lessons`, `review_questions`, `english_questions`, `pptx_audio_sessions`).

## Validation
- Proof command: `cd backend && npx jest src/questions/moodle-xml.helper.spec.ts && npm run build && cd ../frontend && npm run build`

## Verification Plan

### Automated Security Check
- **Security Scanner**: Run a scan on all newly created files to identify common vulnerabilities (e.g., XSS, SQL injection). If findings are detected, auto-apply the fix and document the results.
- **Security Audit**: Audit the new code for design-level security issues (input validation, secrets handling, auth checks, strict `userId` resource ownership verification on `ExamQuestionSet`, `Subject`, `Lesson`, `PptxSubject`, and `PptxAudioSession`, and safe React JSX escaping without `dangerouslySetInnerHTML` or `alert/confirm/prompt`). Document findings and remediations in the walkthrough artifact.
