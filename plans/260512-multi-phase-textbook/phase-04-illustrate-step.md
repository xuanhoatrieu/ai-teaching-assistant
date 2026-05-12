# Phase 04: Illustrate Step
Status: ⬜ Pending
Dependencies: Phase 01 (MermaidService), Phase 03 (pipeline)

## Objective
Implement Step ILLUSTRATE: scan bài viết, tìm markers, tạo ảnh (Mermaid + AI Image), chèn vào markdown.

## Tasks

### 1. Tạo ILLUSTRATE_PROMPT
- [ ] System prompt yêu cầu AI scan bài viết và tạo illustration specs
- [ ] Output: JSON array `[{position, type, content}]`
  - `type: "mermaid"` → `content` = mermaid code
  - `type: "ai_image"` → `content` = image generation prompt (tiếng Anh)
  - `type: "code_output"` → `content` = simulated output text
- [ ] Input: bài viết markdown (từ Step WRITE/REVIEW)
- [ ] AI scan qua bài → tìm `<!-- ILLUSTRATION: ... -->` markers + tự đề xuất thêm
- [ ] Giới hạn: tối đa 5 illustrations/bài (tránh quá lâu)

### 2. Implement illustrateTextbook()
- [ ] Parse AI response → danh sách illustrations
- [ ] Với mỗi illustration:
  - **Mermaid**: gọi MermaidService.renderToPng() → save assets → lấy URL
  - **AI Image**: gọi ImagenService.generateImage() → save assets → lấy URL
  - **Code Output**: chèn trực tiếp output text vào markdown (không cần render)
- [ ] Replace markers trong markdown bằng `![caption](URL)` hoặc code block
- [ ] Lưu danh sách ảnh vào SyllabusLesson.textbookImages

### 3. Image storage helper
- [ ] `saveTextbookAsset(syllabusId, lessonId, buffer, filename)` → publicUrl
- [ ] Path: `uploads/syllabus-textbook/<syllabusId>/<lessonId>/assets/<filename>`
- [ ] Filename: `<type>_<index>_<sanitized_desc>.png`
- [ ] Return public URL: `/files/public/syllabus-textbook/...`

### 4. Mermaid rendering integration
- [ ] Gọi MermaidService với code từ AI
- [ ] Config: theme=default, backgroundColor=white, width=800
- [ ] Nếu mermaid code có syntax error → log warning, skip ảnh đó
- [ ] Fallback: dùng mermaid.ink API nếu local mmdc fail

### 5. AI Image integration
- [ ] Gọi ImagenService.generateImage() hoặc generateImageViaCLIProxy()
- [ ] Dùng model từ user config (ModelSelector IMAGE)
- [ ] Prompt prefix: "Educational textbook illustration, clean academic style, no text: "
- [ ] Nếu image gen fail → skip, log warning

## Files to Create/Modify
- `backend/src/syllabus/syllabus.service.ts` — thêm illustrateTextbook() + saveTextbookAsset()
- `backend/src/syllabus/mermaid.service.ts` — đã tạo ở Phase 01

## Test Criteria
- [ ] Mermaid diagram render thành PNG và serve qua public URL
- [ ] AI image gen tạo ảnh minh họa phù hợp nội dung
- [ ] Code output được chèn đúng vị trí trong markdown
- [ ] Nếu 1 ảnh fail → bỏ qua, không crash pipeline
- [ ] textbookImages lưu đúng metadata

---
Next Phase: phase-05-frontend.md
