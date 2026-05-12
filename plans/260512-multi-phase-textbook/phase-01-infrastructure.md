# Phase 01: Infrastructure (Mermaid CLI + DB Migration)
Status: ⬜ Pending
Dependencies: None

## Objective
Cài đặt Mermaid CLI trên server và thêm DB fields cho multi-phase tracking.

## Tasks

### 1. Cài đặt Mermaid CLI
- [ ] Cài `@mermaid-js/mermaid-cli` globally trên VPS
- [ ] Kiểm tra `mmdc --version` chạy được
- [ ] Nếu Puppeteer/Chrome cần RAM quá cao → fallback plan: dùng `mermaid.ink` API

### 2. Tạo MermaidService
- [ ] Tạo `backend/src/syllabus/mermaid.service.ts`
- [ ] Pattern giống MarkItDownService: write temp file → spawn mmdc → read output PNG → cleanup
- [ ] Input: mermaid code string + config (theme, background)
- [ ] Output: PNG Buffer
- [ ] Timeout: 30s
- [ ] Fallback: nếu mmdc fail → dùng `https://mermaid.ink/img/<base64>` API

### 3. DB Migration — SyllabusLesson thêm fields
- [ ] Thêm `textbookPlan String?` — Lưu output Backward Design plan
- [ ] Thêm `textbookPhase String?` — Tracking: extracting/planning/writing/illustrating/reviewing/done/error
- [ ] Thêm `textbookImages Json?` — Array: [{url, caption, type: 'mermaid'|'ai_image'}]
- [ ] Chạy `npx prisma db push` (không dùng migrate dev — tránh shadow DB error)

### 4. Tạo thư mục assets + public route
- [ ] Thêm helper `getTextbookAssetsPath(syllabusId, lessonId)` vào FileStorageService
- [ ] Path: `uploads/syllabus-textbook/<syllabusId>/<lessonId>/assets/`
- [ ] Thêm public route: `/files/public/syllabus-textbook/:syllabusId/:lessonId/assets/:filename`
- [ ] Đăng ký route trong `file-storage.controller.ts`

### 5. Register MermaidService
- [ ] Thêm MermaidService vào SyllabusModule providers
- [ ] Inject ImagenService vào SyllabusModule (nếu chưa có)

## Files to Create/Modify
- `backend/src/syllabus/mermaid.service.ts` — **NEW**
- `backend/prisma/schema.prisma` — thêm 3 fields SyllabusLesson
- `backend/src/file-storage/file-storage.service.ts` — thêm getTextbookAssetsPath
- `backend/src/file-storage/file-storage.controller.ts` — thêm public route
- `backend/src/syllabus/syllabus.module.ts` — register providers

## Test Criteria
- [ ] `mmdc` hoạt động: render mermaid code → PNG file
- [ ] DB push thành công, không break data cũ
- [ ] Public route serve file ảnh từ assets/

---
Next Phase: phase-02-reference-enhancement.md
