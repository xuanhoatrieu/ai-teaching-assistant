# Changelog

## [v1.6.6] - 2026-10-04 - Word Ordering & Dialogue Cloze Question Types in SCORM/H5P/UI

### Added
- **Word Ordering Interactive Question Type (`ORDER`)**:
  - AI generation schema and prompt examples for sentence scrambling into word components.
  - Interactive SCORM student player with drag/click sentence assembly zone, word pool pills, reset button, and practice/gate verification.
  - Full support for both Dark and Light high-contrast themes.
- **Dialogue & Passage Cloze Question Type (`CLOZE`)**:
  - AI generation schema and prompt examples for multi-speaker dialogues (`A:`, `B:`) and narrative paragraphs with bracketed inline blanks `[answer]` and alternatives `[opt1|opt2]`.
  - Automatically generated Word Bank hint pills.
  - SCORM player with inline inputs embedded directly into passage text lines with practice evaluation and mastery gate grading.
- **Step 5 Generator UI & Slide Preview Enhancements**:
  - Added checkboxes for `ORDER` and `CLOZE` in interactive questions configuration modal with updated "Chọn tất cả (7 dạng)".
  - Specialized preview cards for ordered sentences and cloze passages in slide preview stack.
- **E-Learning Export Polish**:
  - H5P export helper updated with badge labels and data mapping for `ORDER` and `CLOZE`.
  - SCORM helper enhanced with center-aligned layout, TUAF branding cleanup, and theme toggling.

## [v1.6.5] - 2026-10-01 - Interactive Slides, Matching Questions & Bilingual Speaker Notes

### Added
- **Interactive Slides in PPTX Generation (Step 5)**:
  - Added dedicated action buttons: "➕ Thêm slide lý thuyết" and "🎮 Thêm slide tương tác".
  - Full support for interactive question types: Multiple Choice (Single/Multi), True/False, Short Answer, Fill-in-the-blank, and **Matching questions** (`matching` type with term-definition pairs).
  - Flexible creation modes:
    - AI-generated from source audio, extracted text/images, or slide range (`fromSlideIndex` - `toSlideIndex`) with full-width expanded input area.
    - Direct extraction from user-provided existing question texts/images.
  - Flexible slide transition policy (`allowPassWithoutPassing`): Allows students to advance to subsequent slides even if the minimum score is not met (ideal for discussion/opinion questions).
  - Standalone interactive slide design layout: Clean presentation focusing purely on questions and choices without redundant slide images.
- **Bilingual Speaker Notes Generation in PPTX Audio Tool**:
  - Added language selection modal for AI speaker notes generation: Vietnamese (Default) and English.
  - Built dedicated 100% academic English prompts for both generation and TTS voice polish, translating all Vietnamese slide terminology into standard lecture English.
  - Added persistent bilingual language toggle `[🇻🇳 VN | 🇬🇧 EN]` on the Notes & Audio header with instant tab switching.
  - Automatic dual-language state management (`noteVN`, `noteEN`, `hasDual: true`, `language: 'en' | 'vi'`) in PostgreSQL sessions.

## [v1.6.4] - 2026-09-30 - Slide Management, Audio Embedding & Voice Clone Guide

### Added
- **Slide CRUD & Reordering (Step 5: Generate PPTX)**:
  - Added ability to create slides at the top, bottom, and between any two adjacent slides using interactive hover dividers (`➕ Chèn slide vào đây`).
  - Added slide movement buttons (`⬆️ Lên`, `⬇️ Xuống`) and deletion button (`🗑️ Xóa`) with confirmation dialog.
  - Implemented automatic sequential renumbering (`1..N`) across `Slide` and `SlideAudio` records ensuring consecutive slide indices in Steps 3, 4, and 5.
- **Independent Sample Audio Upload & Management (Step 5)**:
  - Added `🎧 Tải audio mẫu` button to upload separate audio samples (e.g. English pronunciation/listening exercises, authentic audio clips) stored alongside the slide.
  - In-place audio preview with playback controls, filename, duration display, and delete capability.
  - Updated Python PPTX generator (`pptx_service.py`) and NestJS service to embed extra audio samples directly into PowerPoint slides with a clickable speaker icon.
- **Single-Slide Speaker Notes AI Generation & Editing (Step 4)**:
  - Added endpoint `POST :index/generate-speaker-note` for targeted AI speaker note generation on newly added or edited individual slides.
  - Added `✨ AI tạo lời giảng` and `✨ Viết lại` buttons per slide card.
  - Added manual speaker note creation and editing (`✏️ Tự viết lời giảng` / `✏️ Sửa`).
- **Comprehensive ViTTS Voice Cloning & API Guide**:
  - Authored a step-by-step guide with 13 real-world screenshots covering API Key management, Voice Library, Recording Studio, and Voice Upload for custom voice cloning on the ViTTS platform.
  - Integrated into the official user documentation docx.

### Fixed
- **Step 3 Slide Script Preview Robustness**:
  - Defensively handled `slide.content` as either `string[]` or `string` to eliminate `TypeError: slide.content.map is not a function`.
- **ValidationPipe Compatibility**:
  - Whitelisted `speakerNote` and `insertAfterIndex` in `CreateSlideDto` and `UpdateSlideContentDto` to prevent NestJS 400 Bad Request errors.

### Changed
- **Separation of Concerns**:
  - Removed speaker note display and editing from Step 5 to keep Step 5 strictly focused on visual slide layout, styling, and media assets.

## [v1.6.1] - 2026-09-18 - Fix Active Job Resume for English & Review Questions

### Fixed
- **Background Job State Resume (Step 6)**:
  - Added automatic active job detection (`checkActiveJobs`) on component mount / tab return.
  - Automatically switches to the active tab (English or Review) and displays real-time progress indicators and spinners when returning or reopening browser.
  - Auto-reloads newly generated questions into preview immediately upon background job completion.
- **Backend Job Type Isolation**:
  - Separated English questions job types to `generate-english-questions` and `append-english-questions` to prevent collisions with review questions jobs.

## [v1.6.0] - 2026-09-17 - English Linguistics Questions Tab & Polymorphic Moodle XML Export

### Added
- **English Linguistics Questions Tab (Step 6)**:
  - Added dedicated Tab 3: `🇬🇧 Câu hỏi Tiếng Anh` for English Studies / English Language & Linguistics major.
  - Multi-select Question Types picker supporting: Multiple Choice (1 answer), Multiple Response (multiple answers), Matching (nối cột), Cloze (embedded answers for Open Cloze & Word Formation), Short Answer (thuật ngữ & phiên mã IPA), True/False, and Essay (tự luận, cây cú pháp, bình dịch).
  - Sub-discipline selector: Comprehensive, Phonetics & Phonology, Morphology, Syntax, Semantics & Pragmatics, Translation Studies, ELT / TESOL, and Advanced C1/C2 Skills.
  - Interactive adaptive question cards rendering customized UI for each question type (matching pairs table, cloze highlighted blanks, short answer key chips, essay scoring criteria).
- **Polymorphic Moodle XML Export**:
  - Full Moodle XML export engine in `moodle-xml.helper.ts` supporting `<question type="multichoice">`, `<question type="match">`, `<question type="cloze">`, `<question type="shortanswer">`, `<question type="truefalse">`, `<question type="essay">`.
  - Automatic category organization (`$course$/top/[Lesson_Title]/English_Questions`).
  - Full Unicode and IPA character set preservation wrapped in `<![CDATA[ ... ]]>` ensuring seamless import into Moodle LMS without XML parser errors.
- **Cloze (Embedded Answers) & Moodle XML Import Polish**:
  - Normalized blank point weights to `{1:...}` in Moodle XML generation to prevent unintended multi-point scoring (e.g. `Marked out of 3.00`).
  - Added automatic instruction prompt injection (`<p><strong>...</strong></p>`) into Moodle Cloze XML question text.
  - Required base root verbs in brackets after blanks (e.g. `(travel)`) for verb conjugation / word transformation questions so students know what base word to conjugate.
  - Supported British and American spelling variants in Cloze answers (e.g. `{1:SHORTANSWER:=is travelling~=is traveling}`).
  - Added strict allowable Moodle fraction mapping for Multiple Response (MR) questions to avoid `cannotimport` error in Moodle LMS.
- **Enhanced Web App Cloze Preview UI**:
  - Formatted question card titles to clean natural text using blanks `[ ______ ]` instead of leaking raw Moodle syntax `{1:SHORTANSWER:=...}`.
  - Implemented interactive visual Cloze preview simulating Moodle with styled badges for answers and point values.
  - Added collapsible `📋 Xem mã Moodle Cloze nguồn` code section for quick copy-pasting.
- **Dedicated Excel Export**:
  - Export English questions to formatted `.xlsx` spreadsheet with question type, sub-discipline, difficulty, question text, option/pair/cloze details, and academic explanations.
- **Database & Backend Architecture**:
  - Added `EnglishQuestion` model in Prisma schema (`english_questions` table).
  - Created `EnglishQuestionService` and integrated with `GenerationJobService` for smooth async background generation.
  - Registered `questions.english` academic prompt template in `PromptsService`.

## [v1.5.27] - 2026-09-16 - Mobile UI Layout Polish & MinIO Registry Fix

### Fixed
- **Mobile Navigation Polish (User App)**:
  - Removed duplicate hamburger menu button and sliding drawer from mobile header.
  - Eliminated horizontal viewport scrolling by removing off-screen `transform: translateX(100%)` and adding global `overflow-x: hidden; max-width: 100vw;`.
  - Added streamlined mobile header actions with user chip and quick logout button.
  - Added dedicated logout button in User Settings account tab.
- **Admin Layout Mobile Optimization**:
  - Enforced `flex-direction: column !important;` on `.admin-layout` in mobile media query so header stays at the top and content takes 100% full width instead of being squeezed into a tiny 50px side column.
  - Added close button `✕` in Admin mobile sidebar drawer header.
- **Docker Compose & MinIO Fix**:
  - Updated community MinIO image to `quay.io/minio/minio:latest` across all docker-compose configurations (`docker-compose.yml`, `docker-compose.registry.yml`, `docker-compose.prod.yml`) resolving Docker Hub 404 access denied errors.
  - Removed obsolete `version: '3.8'` attribute.

## [v1.5.26] - 2026-09-15 - Mobile UI/UX Redesign (Touch-First & Thumb-Zone)

### Added
- **Mobile Navigation & Bottom Navigation Bar**
  - Fixed bottom navigation bar (`📚 Môn học`, `🎙️ Audio PPTX`, `🧰 Công cụ`, `⚙️ Cài đặt`, `🛡️ Admin`) with glassmorphism backdrop blur and iOS safe area padding
  - Slide-up Tools Bottom Sheet modal for mobile quick access
  - Admin mobile quick-exit button (`[ 🏠 Về App ]`) directly in mobile header
- **User Settings Segmented Tabs**
  - Divided settings into 4 swipe-friendly tabs (`👤 Tài khoản`, `🤖 Model AI`, `🔑 API Keys`, `📑 Mẫu Slide`)
  - Converted API key and slide template dialogs into mobile Bottom Sheets with drag handle
- **Admin Settings & Users Mobile Optimization**
  - 6 dedicated segmented tabs for CLIProxy, Custom OpenAI, Image Gen, ViTTS, SMTP, and System Keys
  - Converted 8-column user table into responsive Mobile Cards with highlighted status and touch-first action buttons
  - Fixed dark theme consistency for Admin reset password modal
- **Workflow Stepper & Lesson Editor UX**
  - Mobile progress bar and step counter banner (`Bước X/6 · Y%`)
  - Fixed sticky bottom action bar for smooth step navigation without scrolling
  - Segmented slide card view in Step 4 (Content | Original script | Optimized script)
  - Responsive question cards with highlighted correct answers in Step 6


### Changed
- **Moodle XML Question Name**: Updated XML export to include the question content preview (truncated to 200 characters) in the question name field (`B1-1-01: Nội dung câu hỏi...`) instead of just the ID. This makes questions identifiable in Moodle's question bank list.

## [v1.1.0] - 2026-02-25 - Speaker Notes Model & Question Bank Polish

### Added
- **Speaker Notes Model Selection (Step 4)**
  - New `SPEAKER_NOTES` task type in Prisma `TaskType` enum
  - Independent AI model selector for speaker note generation
  - Updated `ModelConfigService` defaults, CLIProxy classifiers, and frontend `ModelSelector`

- **Interactive Question Answer Editing (Step 6)**
  - Edit mode now allows modifying answer text (not just question text)
  - Inline input fields with correct-answer prefix preservation
  - `handleUpdateInteractive` sends full `answers[]` array to backend

- **Admin Prompt Editor UI**
  - Widened modal to 50vw (from 420px) with `.prompt-modal` class
  - Monospace font, 20 rows textarea for easier prompt editing

### Changed
- **Excel Export Filenames**: Now use lesson title (`lessonTitle_review.xlsx`, `lessonTitle_interactive.xlsx`)
- **Review Excel Columns**: Renamed to English (`Question ID`, `Question`, `Correct Answer (A)`, `Option B`, `Option C`, `Option D`, `Explanation`) — removed `Mức độ` column
- **Speaker Notes Prompt**: Updated rules (Hook→Explain→Bridge), fixed rhetorical questions in examples
- **Interactive Questions Prompt**: Clarified MR answer format, added answer count limit

### Fixed
- Removed bold styling (`font-weight:500→400`) from interactive question text and correct answers — prevents bold persisting when copying to Word
- Fixed CSS specificity conflict: `UserSettings.css` `.modal-content {max-width:420px}` was overriding `AdminPage.css`. Resolved with `.prompt-modal` class + `!important`

---

## [2026-02-14] - Outline Fix & UI Polish

### Fixed
- **Outline Edit JSON Error**
  - Fixed `handleGenerate` response parsing to correctly extract `wrapper.content` from nested controller response
  - Added `useEffect` to sync local `detailedOutline` state when `lessonData` refreshes
  - Added auto-clean for markdown ` ```json ` wrappers before `JSON.parse` in `handleSaveEdit`
  - Added auto-save on component unmount via `useRef` + cleanup `useEffect`

- **Nginx 504 Gateway Timeout on AI Generation**
  - Increased `proxy_read_timeout`, `proxy_connect_timeout`, `proxy_send_timeout` to 180s in `nginx.conf`
  - AI generation requests (outline, slides) can take 60-120s, default 60s was too short

- **Auto-save Outline on Step Navigation**
  - `handleNextStep` in `LessonEditorV2.tsx` now saves `detailedOutline` before moving from Step 2 to Step 3
  - Matches existing auto-save pattern for slide script (Step 3 → Step 4)

### Changed
- Browser title: `frontend` → `AI Teaching Assistant`
- Favicon: Replaced default Vite SVG with custom graduation cap + AI circuit icon
- Added `<meta description>` for SEO

---

## [2026-02-05] - Production Deployment 🚀

### Added
- **CI/CD Pipeline**
  - GitHub Actions workflow for Docker image builds
  - Auto-push to GitHub Container Registry (GHCR)
  - Image tags: `ghcr.io/xuanhoatrieu/ai-teaching-assistant/{backend,frontend}:main`

- **Deployment Documentation**
  - `docs/DEPLOYMENT.md` - Quick deployment guide for updates
  - `docs/DEPLOYING.md` - Full VPS setup guide

### Fixed
- **Prisma 7 Docker Compatibility**
  - Switched to Node 22 Alpine (Prisma 7 requires Node 22+)
  - Added OpenSSL for Alpine Linux
  - Added `binaryTargets: ["native", "linux-musl-openssl-3.0.x"]`
  - Removed `url` from schema.prisma (Prisma 7 uses prisma.config.ts only)

- **NestJS Dockerfile**
  - Fixed CMD path: `dist/src/main` instead of `dist/main`
  - Properly copy Prisma client from builder stage

- **Frontend API URL**
  - Changed `API_BASE_URL` fallback from `localhost:3001` to `/api`
  - Added nginx proxy configuration for `/api/` routing to backend

### Infrastructure
- VPS deployment with Docker Compose
- Nginx reverse proxy for frontend with API routing
- Cloudflare Tunnel for HTTPS
  - Frontend: https://ai.hoclieu.id.vn
  - Backend: https://api.hoclieu.id.vn
- Removed Watchtower (Docker API version incompatible)

---

## [2026-01-30] - PPTX Template Background Fixes

### Fixed
- **Step 5 Slide Persistence**
  - Slides no longer disappear when navigating away from Step 5
  - Split API endpoint: `GET /lessons/:id/slides` now returns Slide[] entities
  - Added `GET /lessons/:id/slides/script-data` for lesson metadata (Step 3)

- **PPTX Background Images in Generated Files**
  - Template backgrounds (titleBgUrl, contentBgUrl) now correctly appear in PPTX
  - Fixed `getLocalPath()` to handle `/files/public/system/templates/...` URLs
  - Added regex pattern matching for both system and user template paths

- **Template Background Preview in UI**
  - Background images now display correctly in 3 locations:
    - Admin → PPTX Templates
    - Settings → Mẫu PPTX cá nhân
    - Step 5 → Template Picker
  - Added new public routes for serving template images:
    - `GET /files/public/system/templates/:templateId/:filename`
    - `GET /files/public/:userId/templates/:templateId/:filename`

### Changed
- `file-storage.controller.ts`: Added 2 new route handlers for template backgrounds
- `pptx.service.ts`: Enhanced URL-to-path mapping in `getLocalPath()` function
- `slides.controller.ts`: Split endpoint to serve different data for Step 3 vs Step 5

---

## [2026-01-24] - Model Configuration & Multi-Provider TTS


### Added
- **Phase 08: Model Configuration**
  - Per-user AI model selection for each task type (Outline, Slides, Questions, Image, TTS)
  - `ModelConfig` table with TaskType enum
  - Model discovery API to list available models from providers
  - Settings UI with "Discover Models" button and task-specific dropdowns

- **Multi-Provider TTS Support**
  - Gemini 2.5 Flash TTS (default)
  - Vbee TTS with dynamic personal voice discovery from API
  - Google Cloud TTS (Neural2 voices)

- **API Endpoints:**
  - `GET /user/model-config` - Get user's model configurations
  - `POST /user/model-config` - Save model for a task type
  - `POST /user/model-config/bulk` - Save multiple configs at once
  - `GET /user/model-config/discover` - Discover available models from providers

- **Database Changes:**
  - Added `TaskType` enum (OUTLINE, SLIDES, QUESTIONS, IMAGE, TTS)
  - Added `VBEE` to `APIService` enum
  - Created `ModelConfig` table

### Changed
- Default models updated to Gemini 2.5:
  - Text generation: `gemini-2.5-pro`
  - Image generation: `gemini-2.5-flash-preview-image-generation`
  - TTS: `gemini-2.5-flash-preview-tts`

---

## [2026-01-24] - Lesson Workflow V2

### Added
- **5-Step Lesson Workflow** - New wizard UI for generating lesson content
  - Step 1: Raw Outline input
  - Step 2: AI-generated detailed outline (Gemini)
  - Step 3: AI-generated slide script with Visual Ideas & Speaker Notes
  - Step 4: PPTX generation (UI ready, Python integration pending)
  - Step 5: Question Bank generation with 3 Bloom's levels

- **Backend Modules:**
  - `OutlineModule` - /lessons/:id/outline/* endpoints
  - `SlidesModule` - /lessons/:id/slides/* endpoints
  - `QuestionBankModule` - /lessons/:id/questions/* endpoints with Excel export

- **Frontend Components:**
  - `WorkflowStepper` - 5-step progress indicator
  - `LessonEditorContext` - State management for workflow
  - `LessonEditorV2` - New editor page at /lessons/:id/v2
  - Step1-5 components for each workflow step

- **Database Changes:**
  - Added `detailedOutline`, `slideScript`, `currentStep` fields to Lesson
  - Created `QuestionBank` model with 1:1 relation to Lesson

- **Dependencies:**
  - `react-markdown` - Markdown preview for generated content
  - `xlsx` - Excel export for question bank

### Notes
- Old editor preserved at /lessons/:id for backward compatibility
- New V2 editor at /lessons/:id/v2

---

## [2026-01-23] - API Keys & Settings

### Added
- User-level API key management (Gemini, Google Cloud TTS, Imagen)
- Admin Settings page with system configuration
- Encrypted API key storage with AES-256

### Changed
- Updated admin navigation with Settings link

---

## [2026-01-22] - Authentication & Admin

### Added
- JWT authentication with bcrypt password hashing
- User registration and login
- Admin dashboard with usage statistics
- Prompts management (CRUD)
- PPTX Templates management
- User management for admins

### Fixed
- Prisma 7 configuration with driver adapter

---

## [2026-01-20] - Project Setup

### Added
- Initial project setup with NestJS backend and React frontend
- PostgreSQL database with Prisma ORM
- Basic Subject and Lesson CRUD
