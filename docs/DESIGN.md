# 🎨 DESIGN: Video Generation Module

**Ngày tạo:** 2026-04-30
**Dựa trên:** [SPECS](specs/video_gen_spec.md) | [Plan](../plans/260430-1040-video-generation/plan.md)

---

## 1. Cách Lưu Thông Tin (Database)

### Sơ Đồ Quan Hệ

```
┌──────────────────────────────────────────────────────────┐
│  👤 USER (đã có)                                         │
│  ├── id, email, role                                     │
│  └── apiKeys[], modelConfigs[]                           │
└────────────────────┬─────────────────────────────────────┘
                     │ 1 user có nhiều subjects
                     ▼
┌──────────────────────────────────────────────────────────┐
│  📚 SUBJECT (đã có)                                      │
│  └── lessons[]                                           │
└────────────────────┬─────────────────────────────────────┘
                     │ 1 subject có nhiều lessons
                     ▼
┌──────────────────────────────────────────────────────────┐
│  📝 LESSON (đã có)                                       │
│  ├── outlineRaw, detailedOutline, slideScript            │
│  ├── slideAudios[]                                       │
│  └── videoGenerations[]  ◄── MỚI                        │
└────────────────────┬─────────────────────────────────────┘
                     │ 1 lesson có nhiều lần tạo video
                     ▼
┌──────────────────────────────────────────────────────────┐
│  📹 VIDEO GENERATION (MỚI)                               │
│  ├── Config: format, resolution, narrationLang,          │
│  │          subtitleLang, narrationSpeed, style           │
│  ├── Status: pending → processing → done/error           │
│  ├── Progress: progress%, currentStep, totalScenes       │
│  ├── Output: videoUrl, subtitleUrl, duration, fileSize   │
│  ├── videoScript: JSON (narration ngắn, KHÁC slideScript)│
│  └── scenes[]                                            │
└────────────────────┬─────────────────────────────────────┘
                     │ 1 video có N scenes
                     ▼
┌──────────────────────────────────────────────────────────┐
│  🎬 VIDEO SCENE (MỚI)                                    │
│  ├── sceneIndex, title                                   │
│  ├── approach: manim | static | screen_record | imagen   │
│  ├── narrationText (VI), subtitleText (EN)               │
│  ├── imagePrompt (cho Imagen), imageUrl (cho upload)     │
│  ├── Output: clipUrl, audioUrl, duration                 │
│  └── status: pending → rendering → done/error            │
└──────────────────────────────────────────────────────────┘
```

### Prisma Schema Chi Tiết

```prisma
// Thêm vào Lesson model hiện có
model Lesson {
  // ... existing fields ...
  videoGenerations VideoGeneration[]
}

model VideoGeneration {
  id              String   @id @default(uuid())
  lessonId        String
  lesson          Lesson   @relation(fields: [lessonId], references: [id], onDelete: Cascade)
  userId          String
  user            User     @relation(fields: [userId], references: [id])

  // ── Config ──
  format          String   @default("horizontal")  // horizontal | vertical
  resolution      String   @default("1080p")       // 480p | 720p | 1080p | 4k
  style           String   @default("auto")        // auto | manim | static | hybrid
  narrationLang   String   @default("vi")          // vi | en
  subtitleLang    String   @default("vi")          // vi | en | both | none
  narrationSpeed  Float    @default(1.0)           // 0.8 | 1.0 | 1.2 | 1.5

  // ── Status ──
  status          String   @default("pending")     // pending | script | rendering | composing | done | error
  progress        Int      @default(0)             // 0-100
  currentStep     String?                          // mô tả bước hiện tại
  totalScenes     Int      @default(0)
  doneScenes      Int      @default(0)
  errorMessage    String?

  // ── Output ──
  videoUrl        String?                          // MinIO presigned URL
  subtitleUrl     String?                          // SRT file URL
  thumbnailUrl    String?                          // Preview image
  duration        Float?                           // tổng seconds
  fileSize        Int?                             // bytes

  // ── Metadata ──
  videoScript     Json?                            // Scene script array (xem JSON schema bên dưới)

  // ── Relations ──
  scenes          VideoScene[]

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([lessonId])
  @@index([userId])
  @@index([status])
}

model VideoScene {
  id              String   @id @default(uuid())
  videoGenId      String
  videoGen        VideoGeneration @relation(fields: [videoGenId], references: [id], onDelete: Cascade)

  sceneIndex      Int
  title           String
  approach        String                           // manim | static | screen_record | imagen
  narrationText   String   @db.Text               // Script đọc (ngôn ngữ chính)
  subtitleText    String?  @db.Text               // Subtitle (ngôn ngữ phụ)
  visualDesc      String?  @db.Text               // Mô tả hình ảnh cho renderer
  imagePrompt     String?  @db.Text               // Prompt cho Imagen 3
  imageUrl        String?                          // URL ảnh (user upload hoặc AI gen)
  manimCode       String?  @db.Text               // Generated Manim Python code
  codeLines       Json?                            // Code lines cho Playwright [{line, lang}]

  // ── Output ──
  clipUrl         String?
  audioUrl        String?
  duration        Float?
  status          String   @default("pending")     // pending | rendering | tts | done | error
  errorMessage    String?
  retryCount      Int      @default(0)

  createdAt       DateTime @default(now())

  @@index([videoGenId])
  @@unique([videoGenId, sceneIndex])
}
```

---

## 2. Scene Script JSON Schema

Đây là cấu trúc dữ liệu **cốt lõi** — Gemini sinh ra, Worker đọc để render:

```json
{
  "title": "Giới thiệu Python cơ bản",
  "total_duration_est": 300,
  "scenes": [
    {
      "index": 0,
      "title": "Title Card",
      "approach": "manim",
      "duration_est": 8,
      "narration_vi": "Chào mừng bạn đến với bài giảng giới thiệu Python cơ bản.",
      "narration_en": "Welcome to the introduction to Python basics.",
      "visual_desc": "Animated title 'Python Cơ Bản' with snake emoji, dark background",
      "manim_template": "title_card",
      "manim_params": {
        "title": "PYTHON CƠ BẢN",
        "subtitle": "Ngôn ngữ lập trình dễ học nhất",
        "color": "YELLOW"
      }
    },
    {
      "index": 1,
      "title": "Python là gì?",
      "approach": "imagen",
      "duration_est": 45,
      "narration_vi": "Python là ngôn ngữ lập trình được tạo bởi Guido van Rossum...",
      "narration_en": "Python is a programming language created by Guido van Rossum...",
      "visual_desc": "Infographic showing Python use cases",
      "image_prompt": "Clean infographic showing Python programming language use cases: web development, AI, data science, automation. Modern flat design, blue and yellow color scheme, white background",
      "ken_burns": "zoom_in"
    },
    {
      "index": 2,
      "title": "Hello World",
      "approach": "screen_record",
      "duration_est": 30,
      "narration_vi": "Hãy viết chương trình đầu tiên...",
      "narration_en": "Let's write our first program...",
      "visual_desc": "IDE showing Python code being typed",
      "code_lines": [
        "# Chương trình đầu tiên",
        "print('Xin chào Python!')"
      ],
      "code_language": "python",
      "ide_template": "python_ide"
    },
    {
      "index": 3,
      "title": "Biến và kiểu dữ liệu",
      "approach": "manim",
      "duration_est": 60,
      "narration_vi": "Biến giống như một chiếc hộp, bạn đặt tên và cho dữ liệu vào...",
      "narration_en": "A variable is like a box where you store data...",
      "visual_desc": "Animated box diagram showing variable types",
      "manim_template": null,
      "manim_code_hint": "Tạo 3 hộp: name='An' (str, blue), age=20 (int, green), gpa=3.5 (float, red)"
    },
    {
      "index": 4,
      "title": "Ảnh minh họa từ user",
      "approach": "static",
      "duration_est": 20,
      "narration_vi": "Đây là sơ đồ kiến trúc hệ thống...",
      "visual_desc": "User uploaded architecture diagram",
      "image_url": "https://minio.example.com/lessons/123/diagram.png",
      "ken_burns": "pan_right"
    }
  ]
}
```

---

## 3. API Contract

### 3.1 REST Endpoints

```
POST   /lessons/:id/video/generate     Tạo video mới
GET    /lessons/:id/video              Lấy video mới nhất của lesson
GET    /lessons/:id/video/status       Trạng thái + progress chi tiết
GET    /lessons/:id/video/scenes       Danh sách scenes + status
GET    /lessons/:id/video/download     Download MP4 (redirect MinIO)
GET    /lessons/:id/video/subtitle     Download SRT
DELETE /lessons/:id/video/:videoId     Xóa video
GET    /video-gen/history              Lịch sử video của user
POST   /video-gen/retry/:sceneId      Retry 1 scene lỗi
```

### 3.2 Request/Response

**POST /lessons/:id/video/generate**
```json
// Request
{
  "format": "horizontal",
  "resolution": "1080p",
  "narrationLang": "vi",
  "subtitleLang": "both",
  "narrationSpeed": 1.2,
  "style": "auto"
}

// Response 202 Accepted
{
  "id": "uuid-xxx",
  "status": "pending",
  "message": "Video generation started. Use GET /status to track progress."
}
```

**GET /lessons/:id/video/status**
```json
{
  "id": "uuid-xxx",
  "status": "rendering",
  "progress": 40,
  "currentStep": "Đang render scene 3/8: Hello World (Playwright)",
  "totalScenes": 8,
  "doneScenes": 2,
  "scenes": [
    {"index": 0, "title": "Title Card", "approach": "manim", "status": "done", "duration": 8.2},
    {"index": 1, "title": "Python là gì", "approach": "imagen", "status": "done", "duration": 42.5},
    {"index": 2, "title": "Hello World", "approach": "screen_record", "status": "rendering"},
    {"index": 3, "title": "Biến", "approach": "manim", "status": "pending"}
  ],
  "config": {
    "format": "horizontal",
    "resolution": "1080p",
    "subtitleLang": "both",
    "narrationSpeed": 1.2
  }
}
```

---

## 4. Redis Message Protocol

### 4.1 Job Queue (NestJS → Worker)

```
Queue: video-gen:jobs
Message format:
{
  "jobId": "uuid-xxx",
  "lessonId": "lesson-uuid",
  "userId": "user-uuid",
  "config": {
    "format": "horizontal",
    "resolution": "1080p",
    "narrationLang": "vi",
    "subtitleLang": "both",
    "narrationSpeed": 1.2,
    "style": "auto"
  },
  "input": {
    "detailedOutline": "...(text)...",
    "slideScript": "...(text/json)...",
    "existingAudioUrls": ["url1", "url2"],
    "userImages": ["url1", "url2"]
  },
  "geminiApiKey": "encrypted-key",
  "vittsApiKey": "encrypted-key",
  "minioConfig": { "endpoint": "...", "bucket": "..." }
}
```

### 4.2 Progress Updates (Worker → NestJS)

```
Channel: video-gen:progress:{jobId}
Message format:
{
  "jobId": "uuid-xxx",
  "status": "rendering",
  "progress": 40,
  "currentStep": "Rendering scene 3/8",
  "doneScenes": 2,
  "totalScenes": 8,
  "sceneUpdates": [
    {"sceneIndex": 2, "status": "rendering"}
  ]
}
```

### 4.3 Completion (Worker → NestJS)

```
Channel: video-gen:done:{jobId}
{
  "jobId": "uuid-xxx",
  "status": "done",
  "videoUrl": "minio://bucket/videos/uuid-xxx/final.mp4",
  "subtitleUrl": "minio://bucket/videos/uuid-xxx/subtitle.srt",
  "thumbnailUrl": "minio://bucket/videos/uuid-xxx/thumb.jpg",
  "duration": 312.5,
  "fileSize": 52428800
}
```

---

## 5. Luồng Hoạt Động

### 5.1 User Journey: Tạo Video

```
1️⃣ Giảng viên mở bài giảng (đã có Outline + Slide Script + Audio)
2️⃣ Bấm tab "📹 Tạo Video" (hoặc Step 7)
3️⃣ Chọn config:
   - Định dạng: Ngang (YouTube) / Dọc (TikTok)
   - Chất lượng: 720p / 1080p / 4K
   - Ngôn ngữ đọc: Tiếng Việt
   - Phụ đề: Cả hai (VI + EN)
   - Tốc độ: 1.2x
4️⃣ Bấm [🎬 Tạo Video]
5️⃣ Xem progress real-time:
   "Scene 1/8: Title Card ✅ (8s)"
   "Scene 2/8: Python là gì ✅ (42s)"
   "Scene 3/8: Hello World 🔄 rendering..."
6️⃣ Khi xong → xem preview video ngay trong browser
7️⃣ Bấm [⬇️ Download MP4] hoặc [📝 Download SRT]
```

### 5.2 Worker Internal Flow

```
nhận job từ Redis
    │
    ▼
STEP 1: Script Generation ─────────────────────────
    │  Gọi Gemini: outline + slideScript → video script JSON
    │  Output: scenes[] với narration ngắn 50-80 từ/scene
    │  Lưu scenes vào DB qua Redis callback
    ▼
STEP 2: Render Scenes (tuần tự) ────────────────────
    │  For each scene:
    │    ├── approach=manim → template hoặc AI code → xvfb-run manimgl → clip.mp4
    │    ├── approach=screen_record → Playwright + IDE → clip.webm → convert mp4
    │    ├── approach=imagen → Imagen API → image → FFmpeg Ken Burns → clip.mp4
    │    ├── approach=static → image_url → FFmpeg Ken Burns → clip.mp4
    │    └── Nếu lỗi → retry 1 lần → nếu vẫn lỗi → skip (log error)
    │  Update progress sau mỗi scene
    ▼
STEP 3: TTS Audio ─────────────────────────────────
    │  For each scene:
    │    viTTS.synthesize(narration_text, speed=config.speed) → audio.wav
    │    Lưu duration thực tế
    ▼
STEP 4: Compose ────────────────────────────────────
    │  For each scene:
    │    FFmpeg: clip + audio → scene_final.mp4 (scale to target resolution)
    │  Concat: scene_01.mp4 + scene_02.mp4 + ... → full_video.mp4
    │  Subtitle: generate .srt → burn (optional) hoặc soft sub
    │  Thumbnail: extract frame tại 5s → thumb.jpg
    ▼
STEP 5: Upload ─────────────────────────────────────
    │  Upload full_video.mp4 → MinIO
    │  Upload subtitle.srt → MinIO
    │  Upload thumb.jpg → MinIO
    │  Publish done message → Redis
    ▼
DONE
```

---

## 6. Tình Huống Đặc Biệt

| Tình huống | Xử lý |
|-----------|-------|
| Manim render lỗi (LaTeX, shader) | Retry 1x → nếu vẫn lỗi → fallback sang static (hiện text + background) |
| viTTS API down | Queue retry 3x, interval 5s → nếu fail → skip audio (video chỉ có hình) |
| Imagen API fail | Fallback: dùng placeholder image hoặc Manim text scene |
| Scene quá dài (>120s) | Tự động chia thành sub-scenes |
| Bài không có slideScript | Sinh trực tiếp từ detailedOutline |
| User hủy giữa chừng | Worker check cancel flag mỗi scene → cleanup temp files |
| Concurrent requests | 1 lesson chỉ 1 video đang xử lý → queue nếu trùng |

---

## 7. File Storage Structure (MinIO)

```
bucket: ai-teaching/
  └── videos/
      └── {userId}/
          └── {videoGenId}/
              ├── final.mp4           # Video hoàn chỉnh
              ├── subtitle_vi.srt     # Phụ đề tiếng Việt
              ├── subtitle_en.srt     # Phụ đề tiếng Anh
              ├── thumbnail.jpg       # Ảnh preview
              └── scenes/             # Clips từng scene (tạm, xóa sau)
                  ├── scene_00.mp4
                  ├── scene_01.mp4
                  └── ...
```

---

## 8. Checklist Kiểm Tra

### Tính năng: Tạo Video
- [ ] Bấm "Tạo Video" → Job được tạo, status = pending
- [ ] Worker nhận job → sinh script → chia scenes
- [ ] Mỗi scene render đúng approach
- [ ] TTS tạo audio đúng tốc độ, đúng ngôn ngữ
- [ ] FFmpeg ghép đúng thứ tự, đúng resolution
- [ ] Subtitle hiển thị đúng ngôn ngữ (VI/EN/Both)
- [ ] Upload MinIO thành công, URL accessible
- [ ] Frontend hiển thị progress real-time
- [ ] Video player phát được sau khi done
- [ ] Download MP4 + SRT hoạt động

### Tính năng: Error Handling
- [ ] Scene lỗi → retry → fallback → video vẫn xuất (bỏ scene lỗi)
- [ ] User hủy → worker dừng, cleanup temp
- [ ] Duplicate request → queue, không tạo 2 video song song

---

## 9. Gemini Prompt Template (Video Script Generation)

```
Bạn là chuyên gia tạo kịch bản video giảng dạy. Từ nội dung bài giảng dưới đây,
hãy tạo kịch bản video với các scene ngắn gọn.

### QUY TẮC:
- Mỗi scene tối đa 50-80 từ narration (người xem cần theo kịp)
- Chọn approach phù hợp cho từng scene:
  * "manim": công thức toán, đồ thị, diagram, so sánh
  * "screen_record": demo code, gõ lệnh terminal
  * "imagen": cần ảnh minh họa concept trừu tượng
  * "static": text-heavy, liệt kê, timeline
- Luôn có scene đầu (title) và scene cuối (summary)
- Output JSON theo schema đã cho

### NỘI DUNG BÀI GIẢNG:
{detailed_outline}

### SLIDE SCRIPT (tham khảo):
{slide_script}

### NGÔN NGỮ: {narration_lang}
### OUTPUT: JSON array of scenes
```

---

*Tạo bởi AWF 2.1 — Design Phase | 2026-04-30*
