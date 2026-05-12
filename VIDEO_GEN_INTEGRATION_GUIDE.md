# 🎬 Video Generation Pipeline — Hướng dẫn tích hợp

> **Dự án:** AI Teaching Assistant — Module Video Generation  
> **Ngày tạo:** 2026-04-30  
> **Trạng thái:** Code Phase 01–05 hoàn tất, sẵn sàng tích hợp  
> **Máy dev:** `trieuhoa@117.0.36.6:222`  
> **Thư mục:** `/home/trieuhoa/ai-teaching-assistant/`

---

## 1. Tổng quan chức năng

### Video Generation Pipeline là gì?

Một pipeline tự động tạo video bài giảng từ nội dung lesson (outline + slide script) đã có sẵn trong hệ thống AI Teaching Assistant. Pipeline sử dụng phương pháp **Hybrid** kết hợp 4 cách render khác nhau:

| Approach | Khi nào dùng | Công cụ |
|----------|-------------|---------|
| **Manim** | Công thức toán, đồ thị, diagram, title card | ManimGL + Xvfb |
| **Playwright** | Demo code, gõ lệnh terminal, IDE screencast | Playwright + Chromium headless |
| **Imagen 3** | Ảnh minh họa concept trừu tượng, kiến trúc | Google Imagen 3 API |
| **Static** | Text-heavy, liệt kê, timeline | FFmpeg + Ken Burns effect |

### Luồng hoạt động

```
User chọn lesson → Cấu hình video (resolution, ngôn ngữ, tốc độ, phụ đề)
    → Bấm "Tạo Video"
    → NestJS Backend tạo job → đẩy vào Redis Queue
    → Python Worker nhận job → AI tạo kịch bản → Render từng scene
    → TTS sinh giọng đọc → FFmpeg ghép scene + audio + subtitle
    → Upload lên MinIO → WebSocket báo progress realtime về Frontend
    → User xem/download video
```

### Tính năng chính

- ✅ **Chọn resolution:** 480p / 720p / 1080p / 4K
- ✅ **Chọn format:** 16:9 (YouTube) hoặc 9:16 (TikTok)
- ✅ **Chọn ngôn ngữ narration:** Tiếng Việt / English
- ✅ **Chọn phụ đề:** VI / EN / Both / Không có
- ✅ **Chọn tốc độ đọc:** 0.8x / 1.0x / 1.2x / 1.5x
- ✅ **Progress realtime:** WebSocket hiển thị từng scene đang render
- ✅ **Fallback strategy:** Nếu Manim/Imagen lỗi → tự chuyển sang Static
- ✅ **Lịch sử video:** Xem/xóa các video đã tạo

---

## 2. Cấu trúc file đã sync

Tất cả file đã được sync vào `/home/trieuhoa/ai-teaching-assistant/`. Dưới đây là chi tiết:

### 2.1 Python Worker — `vid-worker/` (25 files)

```
vid-worker/
├── config.py               # ENV vars, resolution map, constants
├── worker.py               # Redis queue consumer, main entry point
├── orchestrator.py          # Pipeline coordinator (bộ não chính)
├── script_gen.py            # Gemini AI → video script JSON
├── tts_client.py            # viTTS API wrapper + retry + fallback
├── compositor.py            # FFmpeg compose/concat/subtitle/thumbnail
├── storage.py               # MinIO upload/download/delete
├── manim_gen.py             # AI sinh code Manim cho scene phức tạp
├── manim_validator.py       # Validate code Manim trước khi render
├── requirements.txt         # Python dependencies
├── Dockerfile               # Docker image cho worker
├── renderers/
│   ├── __init__.py
│   ├── manim_renderer.py    # Render ManimGL headless qua Xvfb
│   ├── playwright_renderer.py # Record code typing qua headless browser
│   ├── static_renderer.py   # Image → video với Ken Burns effect
│   └── imagen_renderer.py   # Imagen 3 API → image → video
├── templates/                # Manim scene templates
│   ├── title_card.py        # Title card animated
│   ├── formula_scene.py     # LaTeX formula display
│   ├── graph_scene.py       # Function graph plotting
│   ├── code_display.py      # Code with line-by-line animation
│   ├── comparison_scene.py  # Side-by-side comparison
│   ├── diagram_scene.py     # Flowchart/architecture diagram
│   └── image_overlay.py     # Image with annotations + zoom
└── ide_templates/            # HTML templates cho Playwright
    ├── python_ide.html      # VS Code-style Python IDE
    └── terminal.html        # Bash terminal
```

### 2.2 NestJS Backend Module — `backend-module/` (8 files)

```
backend-module/
├── docker-compose.vid-worker.yml    # Docker snippet cho vid-worker service
└── video-gen/
    ├── schema.prisma                # Prisma models: VideoGeneration + VideoScene
    ├── dto/
    │   └── create-video.dto.ts      # Input validation DTO
    ├── video-gen.module.ts          # NestJS module registration
    ├── video-gen.controller.ts      # 9 REST endpoints
    ├── video-gen.service.ts         # Business logic + queue dispatch
    ├── video-gen.processor.ts       # Bull queue processor → Redis bridge
    └── video-gen.gateway.ts         # WebSocket gateway for realtime progress
```

### 2.3 React Frontend — `frontend-module/` (7 files)

```
frontend-module/
├── VideoGeneratorPage.tsx           # Main page component
├── VideoGeneratorPage.css           # Full CSS (dark theme, animations)
├── lib/
│   └── videoGenApi.ts               # API client + TypeScript types
└── components/
    ├── ConfigPanel.tsx              # 6 config dropdowns + generate button
    ├── ProgressTracker.tsx          # Progress bar + scene status list
    ├── VideoPreview.tsx             # HTML5 video player + download
    └── VideoHistory.tsx             # History table + delete
```

### 2.4 Docs & Plans — `docs/` + `plans/`

```
docs/
├── DESIGN.md                # Thiết kế chi tiết (DB schema, API, JSON schema)
├── BRIEF.md                 # Tài liệu kiến trúc pipeline hybrid
├── MANIM_GUIDE.md           # Hướng dẫn ManimGL trong pipeline
├── design-specs.md          # UI/UX design specs (dark theme)
└── specs/
    └── video_gen_spec.md    # Đặc tả kỹ thuật
plans/
├── plan.md                  # Kế hoạch tổng thể
└── 260430-1040-video-generation/
    └── plan.md              # Plan chi tiết 5 phases
```

---

## 3. Hướng dẫn tích hợp từng bước

### Bước 1: Copy Backend Module vào project

```bash
cd /home/trieuhoa/ai-teaching-assistant

# Copy video-gen module vào backend/src/
cp -r backend-module/video-gen/ backend/src/video-gen/

# Verify
ls backend/src/video-gen/
# → dto/ schema.prisma video-gen.controller.ts video-gen.service.ts ...
```

### Bước 2: Cập nhật Prisma Schema

```bash
# Mở file schema.prisma chính của project
# Thêm nội dung từ backend-module/video-gen/schema.prisma vào cuối

cat backend-module/video-gen/schema.prisma >> backend/prisma/schema.prisma

# QUAN TRỌNG: Mở file và review, đảm bảo:
# 1. Model Lesson đã có relation: videoGenerations VideoGeneration[]
# 2. Model User đã có relation tương ứng
# 3. Không duplicate model nào
nano backend/prisma/schema.prisma
```

### Bước 3: Thêm relation vào Lesson model

Mở `backend/prisma/schema.prisma`, tìm model `Lesson` và thêm:

```prisma
model Lesson {
  // ... existing fields ...
  videoGenerations VideoGeneration[]   // ← THÊM DÒNG NÀY
}

model User {
  // ... existing fields ...
  videoGenerations VideoGeneration[]   // ← THÊM DÒNG NÀY
}
```

### Bước 4: Chạy Prisma Migration

```bash
cd backend
npx prisma migrate dev --name add-video-generation
npx prisma generate
```

### Bước 5: Register VideoGenModule trong AppModule

Mở `backend/src/app.module.ts`, thêm:

```typescript
import { VideoGenModule } from './video-gen/video-gen.module';
// Thêm BullModule config nếu chưa có
import { BullModule } from '@nestjs/bull';

@Module({
  imports: [
    // ... existing imports ...
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    }),
    VideoGenModule,  // ← THÊM
  ],
})
```

### Bước 6: Cài thêm NestJS dependencies (nếu chưa có)

```bash
cd backend
npm install @nestjs/bull bull
npm install @nestjs/websockets @nestjs/platform-socket.io socket.io
npm install @nestjs-modules/ioredis ioredis
```

### Bước 7: Copy Frontend Components

```bash
cd /home/trieuhoa/ai-teaching-assistant

# Copy components
cp frontend-module/components/*.tsx frontend/src/components/
cp frontend-module/lib/videoGenApi.ts frontend/src/lib/

# Copy page
cp frontend-module/VideoGeneratorPage.tsx frontend/src/pages/
cp frontend-module/VideoGeneratorPage.css frontend/src/pages/
```

### Bước 8: Thêm Route cho Video Generator Page

Mở `frontend/src/App.tsx`, thêm route:

```tsx
import { VideoGeneratorPage } from './pages/VideoGeneratorPage';

// Trong Router:
<Route path="/lessons/:lessonId/video" element={<VideoGeneratorPage />} />
```

### Bước 9: Cài Frontend Dependencies (nếu chưa có)

```bash
cd frontend
npm install socket.io-client
```

### Bước 10: Thêm nút "Tạo Video" vào Lesson Page

Tìm file lesson detail page, thêm link đến Video Generator:

```tsx
<a href={`/lessons/${lessonId}/video`} className="btn">
  🎬 Tạo Video
</a>
```

---

## 4. Setup Python Worker (vid-worker)

### 4.1 Tạo Python Virtual Environment

```bash
cd /home/trieuhoa/ai-teaching-assistant/vid-worker

# Tạo venv
python3 -m venv venv
source venv/bin/activate

# Cài dependencies
pip install -r requirements.txt
```

### 4.2 Cài System Dependencies

```bash
# FFmpeg (bắt buộc)
sudo apt install -y ffmpeg

# Xvfb (cho Manim headless)
sudo apt install -y xvfb

# ManimGL dependencies
sudo apt install -y libcairo2-dev libpango1.0-dev texlive-latex-base texlive-fonts-recommended

# Cài ManimGL
pip install manimlib

# Cài Playwright + Chromium
pip install playwright
playwright install chromium --with-deps
```

### 4.3 Tạo file .env

```bash
cat > /home/trieuhoa/ai-teaching-assistant/vid-worker/.env << 'EOF'
REDIS_URL=redis://localhost:6379
GEMINI_API_KEY=your-gemini-api-key-here
VITTS_BASE_URL=https://vitts.hoclieu.id.vn
VITTS_API_KEY=your-vitts-api-key-here
MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=your-minio-password
MINIO_BUCKET=ai-teaching
IMAGEN_API_KEY=your-imagen-api-key-here
EOF
```

### 4.4 Chạy Worker (Dev mode)

```bash
cd vid-worker
source venv/bin/activate
python worker.py
# Output: 🚀 Video Generation Worker starting...
#         📡 Redis: redis://localhost:6379
#         ✅ Redis connected
#         👂 Waiting for jobs...
```

---

## 5. Chạy thử toàn bộ

### 5.1 Đảm bảo các service đang chạy

```bash
# Redis
redis-cli ping  # → PONG

# PostgreSQL (đã có từ docker-compose)
# MinIO (đã có từ docker-compose)

# Backend NestJS
cd backend && npm run start:dev

# Frontend React
cd frontend && npm run dev

# Python Worker
cd vid-worker && source venv/bin/activate && python worker.py
```

### 5.2 Test Flow

1. Đăng nhập vào app → chọn 1 lesson đã có outline
2. Vào `/lessons/{lessonId}/video`
3. Chọn config (resolution, ngôn ngữ, tốc độ...)
4. Bấm "🎬 Tạo Video"
5. Xem progress realtime trên UI
6. Khi xong → xem video + download

---

## 6. API Endpoints Reference

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `POST` | `/lessons/:lessonId/video/generate` | Bắt đầu tạo video |
| `GET` | `/lessons/:lessonId/video` | Lấy video mới nhất |
| `GET` | `/lessons/:lessonId/video/status` | Xem progress realtime |
| `GET` | `/lessons/:lessonId/video/scenes` | Chi tiết từng scene |
| `GET` | `/lessons/:lessonId/video/download` | Download MP4 |
| `GET` | `/lessons/:lessonId/video/subtitle` | Download SRT |
| `DELETE` | `/lessons/:lessonId/video/:videoId` | Xóa video |
| `GET` | `/video-gen/history` | Lịch sử video của user |
| `POST` | `/video-gen/retry/:sceneId` | Retry scene bị lỗi |

---

## 7. Docker Production

Khi deploy production, thêm vid-worker vào docker-compose:

```yaml
# Thêm vào docker-compose.yml
vid-worker:
  build: ./vid-worker
  container_name: ai-teaching-vid-worker
  depends_on:
    - redis
  environment:
    - REDIS_URL=redis://redis:6379
    - GEMINI_API_KEY=${GEMINI_API_KEY}
    - VITTS_API_KEY=${VITTS_API_KEY}
    - VITTS_BASE_URL=https://vitts.hoclieu.id.vn
    - MINIO_ENDPOINT=minio:9000
    - MINIO_ACCESS_KEY=${MINIO_ROOT_USER}
    - MINIO_SECRET_KEY=${MINIO_ROOT_PASSWORD}
    - MINIO_BUCKET=ai-teaching
    - IMAGEN_API_KEY=${IMAGEN_API_KEY}
  deploy:
    resources:
      limits:
        memory: 4G
        cpus: '2.0'
  restart: unless-stopped
  networks:
    - app-network
```

---

## 8. Kiến trúc tổng quan

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Frontend   │────▶│   Backend    │────▶│   Redis Queue   │
│   (React)    │◀────│   (NestJS)   │     │   (Bull)        │
│              │ WS  │              │     └────────┬────────┘
└─────────────┘     └──────┬───────┘              │
                           │                       ▼
                    ┌──────┴───────┐     ┌─────────────────┐
                    │  PostgreSQL  │     │  Python Worker   │
                    │  (Prisma)    │     │  ┌─────────────┐ │
                    └──────────────┘     │  │ Orchestrator │ │
                                        │  │  ┌─────────┐ │ │
                    ┌──────────────┐     │  │  │ Manim   │ │ │
                    │    MinIO     │◀────│  │  │Playwright│ │ │
                    │  (Storage)   │     │  │  │ Imagen  │ │ │
                    └──────────────┘     │  │  │ Static  │ │ │
                                        │  │  └─────────┘ │ │
                    ┌──────────────┐     │  │   FFmpeg     │ │
                    │    viTTS     │◀────│  │   + TTS      │ │
                    │  (Voice)     │     │  └─────────────┘ │
                    └──────────────┘     └─────────────────┘
```

---

## 9. Tài liệu tham khảo

| File | Nội dung |
|------|----------|
| `docs/DESIGN.md` | DB Schema, API Contract, JSON Schema chi tiết |
| `docs/BRIEF.md` | Kiến trúc pipeline hybrid đầy đủ |
| `docs/MANIM_GUIDE.md` | Hướng dẫn ManimGL trong pipeline |
| `docs/design-specs.md` | UI/UX Design Specs (Dark theme) |
| `docs/specs/video_gen_spec.md` | Đặc tả kỹ thuật resolution, TTS, storage |
| `plans/plan.md` | Kế hoạch triển khai tổng thể |

---

## 10. Lưu ý quan trọng

> ⚠️ **Không commit API keys** vào git. Sử dụng `.env` file.

> ⚠️ **ManimGL cần Xvfb** để render headless. Trong Docker đã cài sẵn.

> ⚠️ **Playwright cần Chromium** — chạy `playwright install chromium` sau khi cài pip.

> ⚠️ **Redis phải chạy** trước khi start worker. Worker sẽ exit nếu không kết nối được Redis.

> ⚠️ **File schema.prisma** trong `backend-module/` chỉ chứa phần bổ sung. Phải merge thủ công vào schema chính, KHÔNG replace.
