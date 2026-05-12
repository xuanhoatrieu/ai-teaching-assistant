# Plan: Hybrid Video Generation for AI Teaching Assistant

**Created:** 2026-04-30T10:40
**Status:** 🟡 In Progress

---

## Overview

Xây dựng module **tạo video bài giảng tự động** tích hợp vào app **AI Teaching Assistant** hiện có.
Pipeline hybrid kết hợp 4 approach cho từng loại nội dung khác nhau trong cùng 1 video.

### Nguồn Gốc Dữ Liệu (từ app hiện tại)

```
Step 2: detailedOutline  ─┐
Step 3: slideScript      ─┼──→  VIDEO ORCHESTRATOR  ──→  Video MP4
Step 4: audioFiles       ─┘     (Python Worker)
```

### 4 Approach Hybrid

| Approach | Engine | Khi Nào | Ví Dụ |
|----------|--------|---------|-------|
| **A: Manim Animation** | ManimGL + Xvfb | Công thức, đồ thị, diagram | Cross Entropy, Neural Net |
| **B: Screen Record** | Playwright headless | Code demo, IDE, terminal | Python tutorial, SQL |
| **C: Static Media** | FFmpeg Ken Burns | Ảnh + TTS narration | Lịch sử, giới thiệu môn |
| **D: AI Image + Manim** | Imagen 3 + Manim | Visual concept cần ảnh minh họa | Kiến trúc mạng, sơ đồ |

> AI (Gemini) tự phân tích từng đoạn outline → chọn approach phù hợp.
> Một video dài sẽ chia thành N scenes, mỗi scene render độc lập, ghép sau.

### User Config Options

| Config | Options | Default |
|--------|---------|---------|
| Format | horizontal (16:9) / vertical (9:16) | horizontal |
| Resolution | 480p / 720p / 1080p / 4K | 1080p |
| Narration Language | vi / en | vi |
| Subtitle | vi / en / both / none | vi |
| Narration Speed | 0.8 / 1.0 / 1.2 / 1.5 | 1.0 |
| Style | auto / manim / static / hybrid | auto |

---

## Tech Stack

| Layer | Technology | Source |
|-------|-----------|--------|
| Backend API | NestJS + Prisma + Bull queue | Existing app |
| Python Worker | Python 3.12 + ManimGL + Playwright + FFmpeg | **New (dev ở đây)** |
| AI Script | Gemini 2.5 Pro | Existing app |
| AI Image | Imagen 3 | Existing app |
| TTS | viTTS (`vitts.hoclieu.id.vn`) | Existing app |
| Storage | MinIO | Existing app |
| Queue | Redis + Bull | Existing app |
| Auth | JWT | Existing app |

---

## Git Workflow

```
/home/moodle/vid_create/         ← DEV & TEST TẠI ĐÂY
  └── vid-worker/                ← Python Worker (Phase 01 + 02)
       │
       ↓  git subtree add / copy
       │
ai-teaching-assistant/           ← REPO CHÍNH
  ├── backend/src/video-gen/     ← NestJS module (Phase 03)
  ├── frontend/src/pages/        ← React page (Phase 04)
  └── vid-worker/                ← Copy từ vid-create
```

---

## Phases

| Phase | Name | Status | Tasks | Est. |
|-------|------|--------|-------|------|
| 01 | Python Worker Core | ⬜ Pending | 12 | 2 days |
| 02 | Manim Templates & Renderers | ⬜ Pending | 10 | 2 days |
| 03 | NestJS Backend Module | ⬜ Pending | 9 | 1.5 days |
| 04 | React Frontend Page | ⬜ Pending | 8 | 1.5 days |
| 05 | Integration & E2E Test | ⬜ Pending | 7 | 1 day |

**Tổng: ~46 tasks | Ước tính: 8 ngày dev**

---

## Database Schema (tóm tắt)

```
VideoGeneration (1 per video job)
  ├── config: format, resolution, narrationLang, subtitleLang, speed, style
  ├── status: pending → processing → done/error
  ├── output: videoUrl, subtitleUrl, duration, fileSize
  ├── videoScript: JSON (KHÁC slideScript — ngắn 50-80 từ/scene)
  └── scenes: VideoScene[]

VideoScene (N per video — render độc lập, ghép sau)
  ├── sceneIndex, title, approach (manim/static/screen_record/imagen)
  ├── narrationText (VI), subtitleText (EN)
  ├── clipUrl, audioUrl, duration
  └── status: pending → rendering → done/error
```

---

## Quick Commands
- Start Phase 1: `/code phase-01`
- Check progress: `/next`
- Save context: `/save-brain`
