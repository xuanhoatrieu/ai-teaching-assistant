# SPECS: Video Generation Module

## 1. Executive Summary
Module tạo video bài giảng tự động cho AI Teaching Assistant.
Pipeline hybrid 4 approaches: Manim Animation, Playwright Screen Record,
Static Media (Ken Burns), AI Image (Imagen 3).

## 2. User Stories
- Giảng viên mở bài giảng → bấm "Tạo Video" → chọn config → đợi → xem + download
- Giảng viên chọn ngôn ngữ subtitle (VI/EN/Both) và tốc độ đọc
- Hệ thống tự phân tích nội dung → chọn approach phù hợp cho từng đoạn
- Video dài được chia scene, render song song, ghép lại

## 3. Architecture
```
Frontend (React) → NestJS API → Redis Queue → Python Worker → MinIO
                                                  ├── ManimGL (math/diagram)
                                                  ├── Playwright (code/IDE)
                                                  ├── FFmpeg (static/Ken Burns)
                                                  └── Imagen 3 (AI images)
```

## 4. Video Script vs Slide Script
| | Slide Script (Step 3) | Video Script (Step 7) |
|---|---|---|
| Mục đích | Speaker notes cho GV | Narration cho video |
| Độ dài | 200-500 từ/slide | 50-80 từ/scene |
| Ngôn ngữ | Chỉ VI | VI + EN (chọn) |
| Sinh bởi | Gemini (prompt PPTX) | Gemini (prompt VIDEO) |

## 5. Config Options
| Config | Options | Default |
|--------|---------|---------|
| format | horizontal / vertical | horizontal |
| resolution | 480p / 720p / 1080p / 4K | 1080p |
| narrationLang | vi / en | vi |
| subtitleLang | vi / en / both / none | vi |
| narrationSpeed | 0.8 / 1.0 / 1.2 / 1.5 | 1.0 |
| style | auto / manim / static / hybrid | auto |

## 6. Image Sources
- **User upload:** Ảnh đã upload trong lesson → URL từ MinIO
- **AI generated:** Imagen 3 tạo ảnh từ prompt do Gemini sinh ra
- **Manim rendered:** ImageMobject chèn ảnh vào scene Manim

## 7. Resolution Map
| Option | 16:9 | 9:16 | Manim Flag |
|--------|------|------|-----------|
| 480p | 854×480 | 480×854 | -l |
| 720p | 1280×720 | 720×1280 | -m |
| 1080p | 1920×1080 | 1080×1920 | --hd |
| 4K | 3840×2160 | 2160×3840 | --uhd |

## 8. Tech Stack
- Python Worker: Python 3.12, ManimGL, Playwright, FFmpeg
- Backend: NestJS, Prisma, Bull, Redis
- Frontend: React 18, TypeScript, Vite
- AI: Gemini 2.5 Pro, Imagen 3
- TTS: viTTS (vitts.hoclieu.id.vn)
- Storage: MinIO
- Deploy: Docker Compose

## 9. Proven Technologies (đã test OK)
- ✅ ManimGL headless render (Xvfb) → CrossEntropyDemo.mp4, PythonBasicsIntro.mp4
- ✅ Playwright headless record → ScreenRecordDemo.webm
- ✅ viTTS SDK → vitts_client.py
- ✅ FFmpeg Ken Burns → zoompan filter
