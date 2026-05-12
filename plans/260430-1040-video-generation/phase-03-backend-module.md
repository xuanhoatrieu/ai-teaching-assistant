# Phase 03: NestJS Backend Module
**Status:** ⬜ Pending
**Dependencies:** Phase 01 + 02 (Worker phải chạy trước)
**Location:** `ai-teaching-assistant/backend/src/video-gen/`

---

## Objective
Thêm module `video-gen` vào NestJS backend hiện tại. Module này quản lý:
- API endpoints cho frontend
- Database models (Prisma)
- Job dispatch qua Redis/Bull queue
- Progress tracking qua WebSocket/SSE

---

## Requirements

### Functional
- [ ] Prisma schema: VideoGeneration + VideoScene models
- [ ] REST API: generate, status, download, delete, history
- [ ] Bull queue: dispatch job → Redis → Python worker nhận
- [ ] Progress: real-time updates (WebSocket hoặc SSE polling)
- [ ] MinIO: serve video URL cho download/stream

### Non-Functional
- [ ] Auth: JWT guard (chỉ owner lesson mới tạo video)
- [ ] Rate limit: 1 video/lesson đang process tại 1 thời điểm
- [ ] Cleanup: auto-delete old videos sau 30 ngày (optional)

---

## Implementation Steps

1. [ ] **Prisma Schema** — Thêm vào `schema.prisma`
   ```prisma
   model VideoGeneration {
     id              String   @id @default(uuid())
     lessonId        String
     lesson          Lesson   @relation(fields: [lessonId], references: [id])
     userId          String
     user            User     @relation(fields: [userId], references: [id])
     format          String   @default("horizontal")
     resolution      String   @default("1080p")
     style           String   @default("auto")
     narrationLang   String   @default("vi")
     subtitleLang    String   @default("vi")
     narrationSpeed  Float    @default(1.0)
     status          String   @default("pending")
     progress        Int      @default(0)
     currentStep     String?
     totalScenes     Int?
     doneScenes      Int      @default(0)
     errorMessage    String?
     videoUrl        String?
     subtitleUrl     String?
     duration        Float?
     fileSize        Int?
     videoScript     Json?
     sceneData       Json?
     scenes          VideoScene[]
     createdAt       DateTime @default(now())
     updatedAt       DateTime @updatedAt
   }

   model VideoScene {
     id             String   @id @default(uuid())
     videoGenId     String
     videoGen       VideoGeneration @relation(fields: [videoGenId], references: [id])
     sceneIndex     Int
     title          String
     approach       String
     narrationText  String
     subtitleText   String?
     clipUrl        String?
     audioUrl       String?
     duration       Float?
     status         String   @default("pending")
     errorMessage   String?
     createdAt      DateTime @default(now())
   }
   ```

2. [ ] **Migration** — `npx prisma migrate dev --name add-video-gen`

3. [ ] **DTOs** — `dto/create-video.dto.ts`
   ```typescript
   export class CreateVideoDto {
     format?: 'horizontal' | 'vertical' = 'horizontal';
     resolution?: '480p' | '720p' | '1080p' | '4k' = '1080p';
     narrationLang?: 'vi' | 'en' = 'vi';
     subtitleLang?: 'vi' | 'en' | 'both' | 'none' = 'vi';
     narrationSpeed?: number = 1.0;
     style?: 'auto' | 'manim' | 'static' | 'hybrid' = 'auto';
   }
   ```

4. [ ] **Controller** — `video-gen.controller.ts`
   ```
   POST   /lessons/:id/video/generate    → Bắt đầu tạo video
   GET    /lessons/:id/video/status      → Trạng thái + progress
   GET    /lessons/:id/video/scenes      → Chi tiết từng scene
   GET    /lessons/:id/video/download    → Download MP4
   GET    /lessons/:id/video/subtitle    → Download SRT
   DELETE /lessons/:id/video/:videoId    → Xóa video
   GET    /video-gen/history             → Lịch sử tạo video (user)
   ```

5. [ ] **Service** — `video-gen.service.ts`
   - `createVideoJob(lessonId, userId, config)` → DB + queue
   - `getStatus(lessonId)` → VideoGeneration + scenes
   - `getHistory(userId)` → past videos
   - `deleteVideo(videoId)` → remove from DB + MinIO

6. [ ] **Queue Processor** — `video-gen.processor.ts`
   - Bull queue: listen `video-gen`
   - On job → push to Redis list `video-gen:jobs` (Python worker reads)
   - Poll Redis `video-gen:progress:{jobId}` → update DB

7. [ ] **WebSocket/SSE Gateway** — `video-gen.gateway.ts`
   - Subscribe Redis pub/sub `video-gen:progress:{jobId}`
   - Forward to frontend via WebSocket

8. [ ] **Module** — `video-gen.module.ts`
   - Import: PrismaModule, BullModule, MinIOModule
   - Register: Controller, Service, Processor, Gateway

9. [ ] **Update Lesson relation** — Add `videoGenerations` to Lesson model

---

## API Response Examples

**POST /lessons/:id/video/generate**
```json
{
  "id": "uuid",
  "status": "pending",
  "message": "Video generation started"
}
```

**GET /lessons/:id/video/status**
```json
{
  "id": "uuid",
  "status": "processing",
  "progress": 45,
  "currentStep": "render",
  "totalScenes": 12,
  "doneScenes": 5,
  "scenes": [
    { "index": 0, "title": "Intro", "status": "done", "approach": "manim" },
    { "index": 1, "title": "Variables", "status": "done", "approach": "imagen" },
    { "index": 2, "title": "Code demo", "status": "rendering", "approach": "playwright" }
  ]
}
```

---

## Test Criteria
- [ ] POST generate → creates DB record + dispatches job
- [ ] GET status → returns progress with scene details
- [ ] WebSocket → receives real-time progress updates
- [ ] GET download → streams MP4 from MinIO
- [ ] DELETE → removes DB record + MinIO file
- [ ] Auth guard → 403 if not lesson owner

---
**Next Phase:** [phase-04-frontend-page.md](./phase-04-frontend-page.md)
