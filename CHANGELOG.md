# Changelog

All notable changes to this project will be documented in this file.

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
