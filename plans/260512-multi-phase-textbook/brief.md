# 💡 BRIEF: Multi-Phase Textbook Generation

**Ngày tạo:** 2026-05-12
**Brainstorm:** User + AI
**Status:** 📋 Ready for /plan

---

## 1. VẤN ĐỀ CẦN GIẢI QUYẾT

Hệ thống textbook generation hiện tại dùng **1-shot AI call** — gửi tất cả context + 1 system prompt → nhận ngay markdown. Có 3 hạn chế lớn:

1. **Reference bị cắt 3000 chars** — sách tham khảo 300-500 trang bị bỏ ~99% nội dung
2. **Không có ảnh/sơ đồ minh họa** — textbook thuần text, không có flowchart, diagram, ảnh
3. **Không tự kiểm tra chất lượng** — AI viết xong là lưu, không review Anti-AI/Academic tone

## 2. GIẢI PHÁP ĐỀ XUẤT

Chuyển từ 1-shot → **5-step pipeline tuần tự**, mỗi step gọi AI riêng:

```
Step 0: EXTRACT   — AI chọn phần relevant từ references (thay vì cắt 3000 chars)
Step 1: PLAN      — Backward Design (Learning Outcomes → Assessments → Content plan)
Step 2: WRITE     — Viết draft theo plan + Harvard structure + Anti-AI
Step 3: ILLUSTRATE — Scan bài → tạo sơ đồ (Mermaid), ảnh (CLIProxy GPT Image), code+output
Step 4: REVIEW+FIX — Tự kiểm 40 mục Anti-AI → sửa → final markdown
```

## 3. QUYẾT ĐỊNH TỪ BRAINSTORM

### 3.1 Reference Strategy (Kết hợp A + C)
- **Strategy C:** Nâng limit mặc định 3000 → **50,000 chars/ref** (an toàn cho mọi model)
- **Strategy A:** Step 0 (EXTRACT) — AI scan toàn bộ reference → trích xuất chương liên quan → inject vào context Step 2 (WRITE)
- Gemini 2.5 Flash có 1M token context → 50K chars/ref × 3 refs = 150K chars ≈ 37K tokens → chỉ 3.7% context window

### 3.2 Image & Diagram Generation
- **Mermaid CLI** (`mmdc`): Cài trên server → render mermaid code → PNG. Dùng cho flowchart, sequence diagram, mind map, pie chart, timeline
- **AI Image Gen**: Dùng CLIProxy GPT Image model (đã có sẵn qua ImagenService). Dùng cho ảnh minh họa khái niệm (sinh học, nông nghiệp, kiến trúc...)
- **Code + Output**: AI tự viết output chính xác (cho môn IT/Toán/Thống kê). KHÔNG cần sandbox/container
- **KHÔNG cần file .py kèm theo** — hệ thống phục vụ đa ngành, không phải chỉ lập trình

### 3.3 Image Storage
- Lưu ảnh vào thư mục assets theo pattern:
  ```
  uploads/syllabus-textbook/<syllabusId>/<lessonId>/assets/
  ├── img_001_ten_mo_ta.png    (AI generated)
  ├── diagram_002_flowchart.png (Mermaid rendered)
  └── diagram_003_timeline.png  (Mermaid rendered)
  ```
- Serve qua public route: `/files/public/syllabus-textbook/<syllabusId>/<lessonId>/assets/<filename>`
- Markdown dùng absolute URL: `![mô tả](/files/public/...)`

### 3.4 Review Strategy
- AI **tự sửa luôn**, KHÔNG cần user duyệt review
- Step 4 = REVIEW + FIX gộp: AI kiểm tra → liệt kê lỗi → sửa → trả final markdown

### 3.5 Không làm
- ❌ Code execution (sandbox/container)
- ❌ File .py thực hành kèm theo
- ❌ User duyệt review trước khi sửa

## 4. KIẾN TRÚC KỸ THUẬT

### 4.1 Backend Changes

**File sửa:** `backend/src/syllabus/syllabus.service.ts`
- Tách `generateTextbook()` → `generateTextbookMultiPhase()`
- 5 system prompts riêng: EXTRACT_PROMPT, PLAN_PROMPT, WRITE_PROMPT, ILLUSTRATE_PROMPT, REVIEW_FIX_PROMPT
- Status tracking: `extracting → planning → writing → illustrating → reviewing → done`

**File mới:** `backend/src/syllabus/mermaid.service.ts`
- Wrapper cho `mmdc` CLI (tương tự MarkItDownService)
- Input: mermaid code string → Output: PNG buffer
- Timeout 30s, temp file management

**File mới/sửa:** `textbook-gen.service.ts` hoặc thêm methods vào SyllabusService
- `renderMermaidDiagram(code) → imageUrl`
- `generateAIImage(prompt) → imageUrl`
- `saveTextbookAsset(syllabusId, lessonId, buffer, filename) → publicUrl`

### 4.2 Database Changes

**SyllabusLesson model — thêm fields:**
```prisma
model SyllabusLesson {
  // ... existing fields ...
  textbookPlan     String?   // Lưu output Step 1 (plan)
  textbookPhase    String?   // Current phase: extracting/planning/writing/illustrating/reviewing/done/error
  textbookImages   Json?     // Array of {url, caption, type: 'mermaid'|'ai_image'}
}
```

### 4.3 Frontend Changes

**File sửa:** `frontend/src/components/syllabus/SyllabusPanel.tsx`
- Progress bar 5 bước thay vì spinner đơn giản
- Hiển thị ảnh trong textbook preview (ReactMarkdown đã hỗ trợ `![](url)`)

### 4.4 Dependencies

- `npm install -g @mermaid-js/mermaid-cli` trên server
- Puppeteer/Chrome headless (dependency của mmdc) — cần kiểm tra VPS có đủ RAM

## 5. ESTIMATE

| Step | Công việc | Thời gian |
|------|-----------|-----------|
| 1 | Cài Mermaid CLI + MermaidService | 0.5 ngày |
| 2 | Tách generateTextbook → 5 prompts | 1 ngày |
| 3 | Step ILLUSTRATE (Mermaid + ImageGen integration) | 1 ngày |
| 4 | DB migration + status tracking | 0.5 ngày |
| 5 | Frontend progress bar + image preview | 0.5 ngày |
| 6 | Test E2E + debug | 0.5 ngày |
| **Tổng** | | **~4 ngày** |

## 6. RỦI RO

| Rủi ro | Mức | Giải pháp |
|--------|-----|-----------|
| Mermaid CLI cần Puppeteer/Chrome → RAM cao trên VPS | 🟡 | Dùng `mermaid.ink` API online fallback |
| 5 lần gọi AI → timeout nginx 600s có thể không đủ | 🟡 | Mỗi step gọi riêng, frontend poll status |
| CLIProxy GPT Image có thể chậm/fail | 🟢 | ImagenService đã có fallback chain |
| Token cost tăng 4-5x | 🟢 | Chấp nhận — textbook viết 1 lần, đọc nhiều lần |

## 7. BƯỚC TIẾP THEO

→ Chạy `/plan` để tạo roadmap chi tiết + task breakdown
→ Hoặc `/code` nếu đã rõ và muốn bắt tay vào làm
