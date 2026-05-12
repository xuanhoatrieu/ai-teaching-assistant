# Phase 01: Python Worker Core
**Status:** ⬜ Pending
**Dependencies:** None (bắt đầu từ đây)
**Location:** `/home/moodle/vid_create/vid-worker/`

---

## Objective
Xây dựng khung Python Worker có khả năng nhận job từ Redis, điều phối xử lý,
và xuất video MP4 hoàn chỉnh. Đây là "bộ não" của hệ thống.

---

## Requirements

### Functional
- [ ] Nhận job từ Redis queue, parse config
- [ ] Gọi Gemini API tạo video script (KHÁC slideScript)
- [ ] Chia bài thành N scenes, chọn approach cho từng scene
- [ ] Gọi viTTS API tạo audio cho mỗi scene
- [ ] FFmpeg ghép clips + audio → video + subtitle
- [ ] Upload kết quả lên MinIO
- [ ] Báo cáo progress qua Redis pub/sub

### Non-Functional
- [ ] Retry logic: scene lỗi → retry 1x → skip & log
- [ ] Memory: < 4GB per video job
- [ ] Output: H.264 MP4, AAC audio

---

## Implementation Steps

1. [ ] **Tạo project structure vid-worker/**
   ```
   vid-worker/
   ├── Dockerfile
   ├── requirements.txt
   ├── config.py                # ENV vars, constants
   ├── worker.py                # Redis consumer main loop
   ├── orchestrator.py          # Job → Script → Scenes → Compose
   ├── script_gen.py            # Gemini → Video Script JSON
   ├── tts_client.py            # viTTS wrapper (copy từ vitts_client.py)
   ├── compositor.py            # FFmpeg compose + concat + subtitle
   ├── storage.py               # MinIO upload
   ├── renderers/
   │   ├── __init__.py
   │   ├── manim_renderer.py    # Xvfb + ManimGL render
   │   ├── playwright_renderer.py  # Headless browser record
   │   ├── static_renderer.py   # Image + Ken Burns → video
   │   └── imagen_renderer.py   # Imagen API → image → static_renderer
   └── templates/               # Manim scene templates (Phase 02)
   ```

2. [ ] **config.py** — Env vars & resolution mapping
   - REDIS_URL, GEMINI_API_KEY, VITTS_API_KEY, VITTS_BASE_URL
   - MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY
   - Resolution map: {480p, 720p, 1080p, 4K} → pixel sizes + Manim flags

3. [ ] **worker.py** — Redis queue consumer
   - Listen trên queue `video-gen:jobs`
   - Parse job payload: { lessonId, config, outlineData, slideScript }
   - Call orchestrator.process(job)
   - Publish progress qua `video-gen:progress:{jobId}`

4. [ ] **script_gen.py** — AI tạo Video Script
   - Input: slideScript (dài) + outline
   - Gemini prompt: "Tạo narration ngắn 50-80 từ/scene cho video"
   - Output: JSON array of scenes
   ```json
   [
     { "index": 0, "title": "Giới thiệu", "approach": "manim",
       "narration_vi": "...", "narration_en": "...",
       "visual_desc": "Title card with Python logo",
       "image_prompt": null },
     { "index": 1, "title": "Biến là gì", "approach": "imagen",
       "narration_vi": "...", "narration_en": "...",
       "visual_desc": "Box diagram showing variables",
       "image_prompt": "Colorful boxes labeled name, age, gpa..." }
   ]
   ```

5. [ ] **tts_client.py** — viTTS wrapper
   - Copy & adapt từ `vitts_client.py` có sẵn
   - Hàm chính: `synthesize(text, lang, speed) → WAV bytes + duration`
   - Hỗ trợ: male/female voice, speed 0.8-1.5

6. [ ] **compositor.py** — FFmpeg compose
   - `compose_scene(clip_path, audio_path, subtitle_text) → scene.mp4`
   - `concat_scenes(scene_paths[]) → final.mp4`
   - `burn_subtitle(video_path, srt_path, lang) → final_sub.mp4`
   - `generate_srt(scenes[]) → .srt file`
   - Resolution scaling: input any → output target resolution

7. [ ] **storage.py** — MinIO upload
   - `upload_video(file_path, bucket, object_name) → URL`
   - `upload_subtitle(srt_path, ...) → URL`

8. [ ] **orchestrator.py** — Main pipeline coordinator
   ```python
   def process(job):
       # 1. Generate video script from slide data
       scenes = script_gen.generate(job.outline, job.slideScript, job.config)
       
       # 2. For each scene: render + TTS
       for scene in scenes:
           clip = render_scene(scene)        # dispatch to correct renderer
           audio = tts_client.synthesize(scene.narration, speed=job.config.speed)
           scene.clip_path = clip
           scene.audio_path = audio
           report_progress(scene.index, len(scenes))
       
       # 3. Compose all scenes
       final = compositor.compose_all(scenes, job.config)
       
       # 4. Upload to MinIO
       url = storage.upload_video(final)
       return url
   ```

9. [ ] **renderers/manim_renderer.py** — ManimGL render
   - Input: Python Manim code string
   - Write to temp file → xvfb-run manimgl → output clip.mp4
   - Quality flag from resolution config

10. [ ] **renderers/playwright_renderer.py** — Screen record
    - Input: code lines[], language
    - Load IDE HTML template → type code → record → output clip.webm
    - Convert webm → mp4 via FFmpeg

11. [ ] **renderers/static_renderer.py** — Image → Video
    - Input: image path (local or URL)
    - FFmpeg Ken Burns effect (zoom/pan) → clip.mp4
    - Duration = matched to TTS audio duration

12. [ ] **renderers/imagen_renderer.py** — AI Image → Video
    - Input: image_prompt string
    - Call Imagen 3 API → save image
    - Pass to static_renderer → clip.mp4

---

## Files to Create/Modify
- `vid-worker/config.py`
- `vid-worker/worker.py`
- `vid-worker/orchestrator.py`
- `vid-worker/script_gen.py`
- `vid-worker/tts_client.py`
- `vid-worker/compositor.py`
- `vid-worker/storage.py`
- `vid-worker/renderers/*.py`

---

## Test Criteria
- [ ] worker.py connects to Redis and receives test job
- [ ] script_gen.py outputs valid JSON array from sample outline
- [ ] tts_client.py produces WAV audio from Vietnamese text
- [ ] compositor.py concatenates 3 test clips into 1 MP4 with subtitle
- [ ] orchestrator.py runs full pipeline with mock renderers

---

## Notes
- Dev tại `/home/moodle/vid_create/vid-worker/` rồi copy sang repo chính sau
- Manim đã cài tại `/home/moodle/vid_create/manim/`, venv tại `venv/`
- Playwright đã cài OK (headless Chromium)
- FFmpeg 6.1 đã có sẵn

---
**Next Phase:** [phase-02-manim-templates.md](./phase-02-manim-templates.md)
