# Phase 09: AI Textbook Generation
Status: ⬜ Pending
Dependencies: Phase 07 (Lessons exist), Phase 06 (References for context)
Risk: Normal

## Objective
AI tạo textbook per lesson sử dụng AWF Backward Design rules + references context.
Hỗ trợ 4 nguồn ảnh: AI Imagen, Mermaid diagrams, user upload, none.

## Implementation Steps

1. [ ] **Textbook generation service**
   - File: `backend/src/syllabus/textbook.service.ts` (CREATE)
   - Multi-stage prompting:
     1. Stage 1: Backward Design (Learning Outcomes → Assessments → Content outline)
     2. Stage 2: Full content generation (academic-narrative style, AWF rules)
   - Inject context: syllabus blocks (description, clo) + reference markdowns

2. [ ] **AI Prompts**
   - File: `backend/src/syllabus/prompts/generate-textbook.ts` (CREATE)
   - Stage 1 prompt: Backward Design analysis
   - Stage 2 prompt: Content writing with AWF rules (anti-AI vocabulary, Harvard Elements, Stanford Clarity)
   - Image placeholders: `![Mô tả](IMAGE:description)` for Imagen, `` ```mermaid `` for diagrams

3. [ ] **Image processing pipeline**
   - After textbook generated, scan for image placeholders:
     - `IMAGE:xxx` → call ImagenService.generate(xxx) → save MinIO → replace with URL
     - `` ```mermaid `` → save temp .mmd → `mmdc -i input.mmd -o output.png -s 2` → save MinIO → replace
   - File: `backend/src/syllabus/textbook-image.service.ts` (CREATE)

4. [ ] **Endpoint: Generate textbook** `POST /syllabus/:id/lessons/:lessonId/generate-textbook`
   - Set status = generating
   - Run AI generation
   - Process images
   - Save markdown to textbookContent
   - Set status = done

5. [ ] **Endpoint: Update textbook** `PUT /syllabus/:id/lessons/:lessonId/textbook`
   - Allow manual edit of textbook markdown content

6. [ ] **Mermaid CLI setup**
   - Install: `npm install -g @mermaid-js/mermaid-cli`
   - Verify: `mmdc --version`
   - Used for rendering diagram code blocks to PNG

7. [ ] **Subject-level image config**
   - Add field or use existing Subject.additionalContext
   - Options: imagen (AI images), mermaid (diagrams), upload (manual), none

## Test Criteria
- [ ] Textbook generated with AWF-quality content
- [ ] Backward Design structure present (outcomes, assessments, content)
- [ ] IMAGE placeholders replaced with actual images
- [ ] Mermaid diagrams rendered as PNG
- [ ] Vietnamese academic-narrative style maintained
- [ ] References used as context in generation

---
Next Phase: → phase-10-textbook-preview-export.md
