# Plan: Video Generation — Module Mới cho AI Teaching Assistant

**Created:** 2026-04-30
**Status:** 🟡 Planning

---

## 📌 Bối Cảnh

### App Hiện Tại: AI Teaching Assistant
| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18 + TypeScript + Vite |
| **Backend** | NestJS + TypeScript + Prisma |
| **Database** | PostgreSQL |
| **AI** | Gemini 2.5 Pro/Flash |
| **TTS** | viTTS (`vitts.hoclieu.id.vn`) + Google TTS + Vbee |
| **Storage** | MinIO (S3-compatible) |
| **Deploy** | Docker Compose |

### Workflow Hiện Tại (6 bước):
```
1. Nhập Outline → 2. Tạo Outline Chi Tiết → 3. Kịch Bản Slide
→ 4. Tạo Audio → 5. Tạo PPTX → 6. Ngân Hàng Câu Hỏi
```

### Module Mới: Video Generation (Step 7 / Page mới)
Thêm khả năng **tạo video bài giảng tự động** từ outline/slide script đã có.

---

## 🎯 Giải Pháp Hybrid Pipeline

```
                     ┌─────────────────┐
                     │  Lesson Outline  │  ← Đã có từ Step 2
                     │  Slide Script    │  ← Đã có từ Step 3
                     │  Audio Files     │  ← Đã có từ Step 4
                     └────────┬────────┘
                              │
                    ┌─────────▼──────────┐
                    │  VIDEO ORCHESTRATOR │  ← Module mới (Python)
                    │  Phân tích nội dung │
                    │  → chọn approach    │
                    └─────────┬──────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
     ┌────────────┐  ┌────────────────┐  ┌──────────┐
     │  APPROACH A │  │  APPROACH B    │  │ APPROACH C│
     │  Manim     │  │  Screen Record │  │ Static   │
     │  Animation │  │  (Playwright)  │  │ Slide+TTS│
     └──────┬─────┘  └───────┬────────┘  └─────┬────┘
            └────────────────┼──────────────────┘
                             ▼
                    ┌────────────────┐
                    │  FFmpeg Comp.  │
                    │  Video+Audio   │
                    │  +Subtitle     │
                    └───────┬────────┘
                            ▼
                       📹 Final MP4
                       → MinIO Storage
```

### 3 Approaches Tùy Nội Dung:

| Approach | Khi Nào Dùng | Ví Dụ |
|----------|-------------|-------|
| **A: Manim** | Toán, công thức, đồ thị, diagrams | Cross Entropy, Gradient Descent |
| **B: Screen Record** | Code demo, IDE, terminal | Python basics, SQL tutorial |
| **C: Static Slide+TTS** | Text-heavy, lý thuyết | Giới thiệu môn, lịch sử |

> AI tự quyết định scene nào dùng approach nào. Có thể **mix** trong 1 video.

---

## 🏗️ Kiến Trúc Tích Hợp

### Tận Dụng Hạ Tầng Có Sẵn:

| Cần | Đã Có ✅ | Cần Xây 🆕 |
|-----|---------|------------|
| User auth | JWT (auth module) | — |
| AI generation | Gemini service | Video script prompts |
| TTS | viTTS + Google TTS | Duration sync logic |
| Storage | MinIO | Video upload logic |
| Async queue | Redis | Video job queue |
| Lesson data | Prisma models | VideoGeneration model |

### Cần Xây Mới:

```
ai-teaching-assistant/
├── backend/src/
│   └── video-gen/                 🆕 NestJS Module
│       ├── video-gen.module.ts
│       ├── video-gen.controller.ts   # REST API
│       ├── video-gen.service.ts      # Business logic
│       ├── video-gen.processor.ts    # Bull queue processor
│       └── dto/
│           ├── create-video.dto.ts
│           └── video-status.dto.ts
│
├── frontend/src/
│   └── pages/
│       └── VideoGeneratorPage.tsx 🆕 React Page
│
├── vid-worker/                    🆕 Python Worker Service
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── worker.py                  # Redis queue consumer
│   ├── orchestrator.py            # Phân tích & điều phối
│   ├── script_gen.py              # AI tạo video script
│   ├── manim_gen.py               # AI sinh Manim code
│   ├── manim_renderer.py          # xvfb + manimgl render
│   ├── screen_recorder.py         # Playwright recorder
│   ├── static_composer.py         # Slide image + pan/zoom
│   ├── tts_client.py              # viTTS API wrapper
│   ├── compositor.py              # FFmpeg ghép final video
│   └── templates/                 # Manim scene templates
│       ├── title_card.py
│       ├── formula_scene.py
│       ├── graph_scene.py
│       ├── code_scene.py
│       └── comparison_scene.py
│
└── docker-compose.yml             # Thêm vid-worker service
```

### Git Workflow:

```
/home/moodle/vid_create/       ← Dev & test tại đây
  └── vid-worker/              ← Python worker service
       │
       ↓  (git subtree add / copy)
       │
ai-teaching-assistant/         ← Repo chính
  ├── backend/src/video-gen/   ← NestJS module (code trực tiếp)
  ├── frontend/src/pages/      ← React page (code trực tiếp)
  └── vid-worker/              ← Copy từ vid-create
```

---

### Database Schema Mới:

```prisma
model VideoGeneration {
  id           String   @id @default(uuid())
  lessonId     String
  lesson       Lesson   @relation(fields: [lessonId])
  userId       String
  user         User     @relation(fields: [userId])

  // Config
  format       String   @default("horizontal")  // horizontal | vertical
  resolution   String   @default("1080p")       // 480p | 720p | 1080p | 4k
  style        String   @default("auto")         // auto | manim | static | hybrid

  // Language & Subtitle
  narrationLang  String  @default("vi")          // vi | en
  subtitleLang   String  @default("vi")          // vi | en | both | none
  narrationSpeed Float   @default(1.0)           // 0.8 | 1.0 | 1.2 | 1.5

  // Status tracking
  status       String   @default("pending")      // pending|processing|done|error
  progress     Int      @default(0)              // 0-100
  currentStep  String?                           // script|render|tts|compose
  totalScenes  Int?                              // Tổng số scenes
  doneScenes   Int      @default(0)              // Số scene đã render xong
  errorMessage String?

  // Output
  videoUrl     String?                           // MinIO URL (final)
  subtitleUrl  String?                           // SRT file URL
  duration     Float?                            // seconds
  fileSize     Int?                              // bytes

  // Metadata
  videoScript  Json?                             // Video narration script (KHÁC slideScript)
  sceneData    Json?                             // Scene breakdown + approach per scene

  scenes       VideoScene[]                      // Relation to scenes
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

// Mỗi scene render độc lập, ghép sau
model VideoScene {
  id             String   @id @default(uuid())
  videoGenId     String
  videoGen       VideoGeneration @relation(fields: [videoGenId])

  sceneIndex     Int                             // Thứ tự: 0, 1, 2, ...
  title          String                          // "Giới thiệu Python"
  approach       String                          // manim | static | screen_record
  narrationText  String                          // Script ngắn gọn cho TTS
  subtitleText   String?                         // Subtitle text (có thể EN)

  // Scene output
  clipUrl        String?                         // MinIO URL of scene clip
  audioUrl       String?                         // Audio file URL
  duration       Float?                          // seconds
  status         String   @default("pending")    // pending|rendering|done|error
  errorMessage   String?

  createdAt      DateTime @default(now())
}
```

### Resolution Map:

| Option | Pixels (16:9) | Pixels (9:16) | Manim Flag |
|--------|--------------|--------------|------------|
| 480p | 854×480 | 480×854 | `-l` |
| 720p | 1280×720 | 720×1280 | `-m` |
| 1080p | 1920×1080 | 1080×1920 | `--hd` |
| 4K | 3840×2160 | 2160×3840 | `--uhd` |

---

## 📋 Phase Details

### Phase 01: Backend Module (NestJS)
> Tạo video-gen module trong backend hiện tại

| # | Task | Files |
|---|------|-------|
| 1 | Prisma schema: VideoGeneration model | `prisma/schema.prisma` |
| 2 | Migration + seed | `prisma/migrations/` |
| 3 | DTOs: CreateVideoDto, VideoStatusDto | `video-gen/dto/` |
| 4 | Controller: REST endpoints | `video-gen.controller.ts` |
| 5 | Service: CRUD + job dispatch | `video-gen.service.ts` |
| 6 | Bull queue: video generation jobs | `video-gen.processor.ts` |
| 7 | MinIO integration: upload video | `video-gen.service.ts` |
| 8 | API routes + guards | `video-gen.module.ts` |

**API Endpoints:**
```
POST /lessons/:id/video/generate     # Bắt đầu tạo video
GET  /lessons/:id/video/status       # Kiểm tra tiến độ
GET  /lessons/:id/video/download     # Download video
DELETE /lessons/:id/video            # Xóa video
GET  /video-gen/history              # Lịch sử tạo video
```

---

### Phase 02: Python Worker Service
> Xử lý nặng: Manim render, FFmpeg compose, TTS sync

| # | Task | Files |
|---|------|-------|
| 1 | Dockerfile + requirements.txt | `vid-worker/Dockerfile` |
| 2 | Redis queue consumer (worker.py) | `vid-worker/worker.py` |
| 3 | Orchestrator: phân tích content → chọn approach | `orchestrator.py` |
| 4 | Script generator: Gemini → video script JSON | `script_gen.py` |
| 5 | Manim code generator: Gemini → Python scene code | `manim_gen.py` |
| 6 | Manim renderer: xvfb + manimgl → video clips | `manim_renderer.py` |
| 7 | TTS client: viTTS API → audio WAV | `tts_client.py` |
| 8 | Static composer: slide → video (pan/zoom effect) | `static_composer.py` |
| 9 | FFmpeg compositor: ghép video + audio + subtitle | `compositor.py` |
| 10 | Manim templates: title, formula, graph, code | `templates/` |

---

### Phase 03: Frontend Page (React)
> Giao diện tạo video cho giảng viên

| # | Task | Files |
|---|------|-------|
| 1 | Route setup: `/lessons/:id/video` | `App.tsx` |
| 2 | VideoGeneratorPage: main layout | `VideoGeneratorPage.tsx` |
| 3 | Config panel: format, quality, style selection | Components |
| 4 | Progress tracker: real-time status updates | WebSocket/polling |
| 5 | Video preview: embedded player | Components |
| 6 | Download + share buttons | Components |
| 7 | API client: video-gen endpoints | `lib/api.ts` |

---

### Phase 04: Integration & Polish
> Kết nối tất cả + test end-to-end

| # | Task | Files |
|---|------|-------|
| 1 | Docker compose: thêm vid-worker service | `docker-compose.yml` |
| 2 | End-to-end test: lesson → video | Test scripts |
| 3 | Error handling + retry logic | Worker + Backend |
| 4 | Vertical video (9:16) support | Manim config |
| 5 | Performance optimization | Worker |
| 6 | Documentation | `docs/` |

---

## 🔑 Data Flow Chi Tiết

```
Giảng viên bấm "Tạo Video" trên lesson page
         │
         ▼
[Frontend] POST /lessons/:id/video/generate
  {
    format: "horizontal",
    resolution: "1080p",
    style: "auto",
    narrationLang: "vi",
    subtitleLang: "both",      // ← VI + EN sub
    narrationSpeed: 1.2        // ← Hơi nhanh
  }
         │
         ▼
[NestJS Backend]
  1. Lấy lesson data (outline, slideScript — KHÔNG dùng trực tiếp)
  2. Tạo VideoGeneration record (status: pending)
  3. Push job lên Redis queue
  4. Return { jobId, status: "pending" }
         │
         ▼
[Python vid-worker] (nhận job từ Redis)

  STEP 1 — VIDEO SCRIPT (KHÁC slideScript!):
    Gọi Gemini: "Từ slide outline này, tạo video narration script.
    Mỗi scene 50-80 từ, ngắn gọn, dễ theo dõi.
    Output: narration_vi + narration_en"
    → videoScript JSON (ngắn hơn slideScript rất nhiều)

  STEP 2 — SCENE BREAKDOWN:
    AI chia bài thành N scenes, mỗi scene chọn approach:
    Scene 01: "Title" → Manim (10s)
    Scene 02: "Python là gì" → Static (60s)
    Scene 03: "Code Hello World" → Manim/Code (45s)
    ...
    Scene 15: "Tổng kết" → Manim (15s)
    → Lưu N records VideoScene vào DB

  STEP 3 — RENDER TỪNG SCENE (song song nếu có thể):
    For each scene:
      a. Generate Manim code (nếu approach=manim)
      b. Render → clip_01.mp4, clip_02.mp4, ...
      c. Update DB: scene.status = "done", doneScenes++
      d. Nếu lỗi → retry 1 lần, nếu vẫn lỗi → skip scene

  STEP 4 — TTS:
    For each scene:
      viTTS.synthesize(narration_text, speed=1.2) → audio_01.wav

  STEP 5 — COMPOSE:
    FFmpeg:
      - Ghép từng (clip + audio) → scene_01_final.mp4
      - Concat tất cả scenes → lesson_video_full.mp4
      - Burn subtitle (VI hoặc EN hoặc both)
      - Output resolution: 1920x1080

  STEP 6 — UPLOAD:
    Upload → MinIO → update DB: status="done"
         │
         ▼
[Frontend] Polling GET /lessons/:id/video/status
  → Progress: "Đang render scene 3/15 (20%)..."
  → Khi done: video player + download + chia sẻ
```

### Video Script vs Slide Script:

| | Slide Script (Step 3) | Video Script (Step 7) |
|---|---|---|
| Mục đích | Speaker notes cho giảng viên | Narration cho video |
| Độ dài | 200-500 từ/slide | 50-80 từ/scene |
| Style | Chi tiết, đầy đủ | Ngắn gọn, dễ nghe |
| Ngôn ngữ | Chỉ VI | VI + EN (chọn) |
| Sinh bởi | Gemini (prompt khác) | Gemini (prompt riêng cho video) |

---

## ⚙️ Docker Compose Addition

```yaml
# Thêm vào docker-compose.yml hiện tại
vid-worker:
  build: ./vid-worker
  depends_on:
    - redis
  environment:
    - REDIS_URL=redis://redis:6379
    - VITTS_API_KEY=${VITTS_API_KEY}
    - VITTS_BASE_URL=https://vitts.hoclieu.id.vn
    - GEMINI_API_KEY=${GEMINI_API_KEY}
    - MINIO_ENDPOINT=minio:9000
    - MINIO_ACCESS_KEY=${MINIO_ROOT_USER}
    - MINIO_SECRET_KEY=${MINIO_ROOT_PASSWORD}
  volumes:
    - ./vid-worker/manim:/app/manim
    - vid-worker-cache:/app/cache
  deploy:
    resources:
      limits:
        memory: 4G
```

---

## 🚀 Bước Tiếp Theo

1️⃣ `/code phase-01` — Bắt đầu code backend module
2️⃣ Xem plan trước — Anh review plan này
3️⃣ Chỉnh sửa — Nói tôi biết cần sửa gì
