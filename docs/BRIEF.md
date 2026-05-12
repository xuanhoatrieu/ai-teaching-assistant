# 💡 BRIEF: Vid-Create — Hệ Thống Tạo Video Bài Học Tự Động

**Ngày tạo:** 2026-04-30
**Brainstorm:** Nghiên cứu kỹ phương án, so sánh công nghệ

---

## 1. VẤN ĐỀ CẦN GIẢI QUYẾT

Giảng viên đại học cần tạo video hướng dẫn bài học cho sinh viên nhưng:
- Quay video + edit thủ công **tốn quá nhiều thời gian**
- Cần animation chuyên nghiệp (đồ thị, công thức, biểu đồ) nhưng **không biết dùng After Effects**
- Muốn style như GlassBox AI / 3Blue1Brown nhưng **không biết code Manim**
- Cần tạo **hàng loạt video** cho nhiều bài, nhiều môn

## 2. GIẢI PHÁP ĐỀ XUẤT

Hệ thống pipeline tự động:
**Input (text/markdown) → AI Script → Animation Code → TTS Voice → Final Video**

Kết hợp 2 approach:
- **Approach A (Manim):** Tạo video animation toán học/khoa học chất lượng cao
- **Approach B (Screen Recording):** Tạo video tutorial thao tác phần mềm

## 3. ĐỐI TƯỢNG SỬ DỤNG
- **Primary:** Giảng viên đại học — nhập nội dung bài, nhận video
- **Secondary:** Content creator giáo dục — tạo video cho YouTube/TikTok

---

## 4. NGHIÊN CỨU THỊ TRƯỜNG

### Đối thủ & công cụ tương tự:

| Tool | Điểm mạnh | Điểm yếu |
|------|-----------|----------|
| **Synthesia/HeyGen** | AI Avatar, dễ dùng | Không có animation toán học, tốn phí, cloud-only |
| **Pictory/InVideo** | Text→Video nhanh | Stock footage generic, không animation custom |
| **3Blue1Brown (Manim)** | Animation tuyệt đẹp | Cần code Python thủ công, không automation |
| **GlassBox AI** | Style rất đẹp, tiếng Việt | Làm thủ công bằng Manim, không scalable |
| **Topic2Manim** | Auto Manim từ topic | Chưa mature, chất lượng không ổn định |
| **Math-To-Manim** | Multi-agent pipeline | Chỉ cho toán, chưa hỗ trợ tiếng Việt |

### Điểm khác biệt của mình:
- **Tự động hóa** workflow Manim mà GlassBox AI đang làm thủ công
- **Tiếng Việt native** — hầu hết tool hiện tại chỉ hỗ trợ tiếng Anh
- **Self-hosted** — dùng TTS local, không phụ thuộc API bên ngoài
- **Multi-approach** — vừa animation (Manim) vừa screen recording (Playwright)

---

## 5. SO SÁNH CÔNG NGHỆ CHI TIẾT

### 5.1 Animation Engine

| Tiêu chí | Manim (Python) | Remotion (React) | Motion Canvas (TS) |
|----------|---------------|-----------------|-------------------|
| **Ngôn ngữ** | Python | TypeScript/React | TypeScript |
| **LaTeX/Công thức** | ⭐⭐⭐⭐⭐ Native | ⭐⭐⭐ (KaTeX plugin) | ⭐⭐⭐⭐ (KaTeX) |
| **Đồ thị toán** | ⭐⭐⭐⭐⭐ Built-in | ⭐⭐⭐ (D3.js/Chart.js) | ⭐⭐⭐⭐ Built-in |
| **Live Preview** | ❌ Render-and-check | ✅ Remotion Studio | ✅ Browser editor |
| **AI Code Gen** | ⭐⭐⭐⭐⭐ LLM rất giỏi Python | ⭐⭐⭐⭐ LLM ok với React | ⭐⭐⭐ Ít training data |
| **Scale/Template** | ⭐⭐⭐ Manual class | ⭐⭐⭐⭐⭐ Data-driven | ⭐⭐⭐ Manual |
| **Ecosystem** | ⭐⭐⭐⭐⭐ Mature, nhiều plugin | ⭐⭐⭐⭐⭐ React ecosystem | ⭐⭐⭐ Còn nhỏ |
| **Giống video GlassBox** | ⭐⭐⭐⭐⭐ Gần giống hệt | ⭐⭐⭐ Phải customize nhiều | ⭐⭐⭐⭐ Khá giống |
| **Open Source** | ✅ MIT | ⚠️ Source-available (paid commercial) | ✅ MIT |

### 5.2 Screen Recording Pipeline (Approach B)

| Tiêu chí | Playwright + FFmpeg | PyAutoGUI + OpenCV |
|----------|-------------------|--------------------|
| **Automation** | ⭐⭐⭐⭐⭐ Headless browser | ⭐⭐⭐ Desktop automation |
| **Cross-platform** | ✅ Linux/Mac/Win | ⚠️ Cần display server |
| **Headless** | ✅ Chạy không cần GUI | ❌ Cần desktop |
| **Web app tutorial** | ⭐⭐⭐⭐⭐ Perfect | ⭐⭐⭐ OK |

---

## 6. KIẾN TRÚC 2 PIPELINE

### Approach A: Manim Animation Pipeline

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Input Text  │────▶│  AI Script   │────▶│ Scene Planner│
│  (Markdown)  │     │  Generator   │     │  (JSON/YAML) │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
                     ┌──────────────┐     ┌───────▼───────┐
                     │  Manim Code  │◀────│  AI Code Gen  │
                     │  Validator   │     │  (LLM Agent)  │
                     └──────┬───────┘     └───────────────┘
                            │
              ┌─────────────▼─────────────┐
              │   Manim Render Engine     │
              │   (Python + FFmpeg)       │
              └─────────────┬─────────────┘
                            │
┌──────────────┐   ┌────────▼────────┐     ┌──────────────┐
│  Local TTS   │──▶│  FFmpeg Mixer   │────▶│  Final Video │
│  (Voiceover) │   │  (video+audio)  │     │  (MP4)       │
└──────────────┘   └─────────────────┘     └──────────────┘
```

### Approach B: Screen Recording Pipeline

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Input Text  │────▶│  AI Script   │────▶│  Playwright  │
│  (Tutorial)  │     │  + Actions   │     │  Automation  │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
                                          ┌───────▼───────┐
                                          │  FFmpeg Screen│
                                          │  Recording    │
                                          └───────┬───────┘
                                                  │
┌──────────────┐   ┌─────────────────┐   ┌────────▼───────┐
│  Local TTS   │──▶│  FFmpeg Mixer   │──▶│  Final Video   │
│  (Narration) │   │  (+ subtitles)  │   │  (MP4)         │
└──────────────┘   └─────────────────┘   └────────────────┘
```

---

## 7. QUYẾT ĐỊNH CÔNG NGHỆ

| Thành phần | Công nghệ | Lý do |
|-----------|----------|-------|
| **Animation Engine** | Manim Community (Python) | Phù hợp nhất với style mong muốn |
| **Screen Recording** | Playwright + FFmpeg | Headless, cross-platform |
| **AI Orchestrator** | Python + LLM API | Tạo script, sinh Manim code |
| **TTS** | Local TTS (đã có) | Self-hosted, không tốn API |
| **Video Composition** | FFmpeg | Industry standard, free |
| **Subtitle** | FFmpeg ASS/SRT | Tự động từ script |

---

## 8. TÍNH NĂNG

### 🚀 MVP (Phase 1):
- [ ] CLI Pipeline — nhập text → xuất video MP4
- [ ] AI Script Generator — tạo bài giảng có phân scene từ topic
- [ ] Manim Code Generator — LLM sinh Manim Python code cho từng scene
- [ ] Manim Renderer — render animation từ code
- [ ] Local TTS Integration — tạo voiceover tiếng Việt từ script
- [ ] FFmpeg Compositor — ghép video + audio + subtitle
- [ ] Template System — vài template cơ bản (title card, graph, formula, bar chart)
- [ ] Vertical (9:16) + Horizontal (16:9) output

### 🎁 Phase 2:
- [ ] Screen Recording Pipeline — Playwright automation cho tutorial
- [ ] Web UI — giao diện web cho giảng viên
- [ ] Batch Processing — tạo nhiều video cùng lúc
- [ ] Template Marketplace — nhiều style visual khác nhau
- [ ] Auto Subtitle — sync subtitle với audio timeline
- [ ] Multi-language — hỗ trợ nhiều ngôn ngữ

### 💭 Backlog:
- [ ] AI Avatar — kết hợp talking head
- [ ] Interactive Quiz — embedded quiz trong video
- [ ] LMS Integration — tích hợp Moodle/Canvas
- [ ] Video Analytics — theo dõi sinh viên xem video

---

## 9. ƯỚC TÍNH SƠ BỘ

| Phase | Phạm vi | Độ phức tạp | Thời gian |
|-------|---------|-------------|-----------|
| **MVP** | CLI Pipeline: text → video | 🟡 Trung bình | 2-3 tuần |
| **Phase 2** | Web UI + Screen Recording | 🟡 Trung bình | 2-3 tuần |
| **Phase 3** | Polish + Scale | 🟢 Dễ | 1-2 tuần |

### Rủi ro:
1. **LLM sinh Manim code sai** → validation loop + fallback templates
2. **Manim setup phức tạp** → Docker container giải quyết
3. **TTS chất lượng** → phụ thuộc vào TTS engine hiện có
4. **Sync audio-video** → cần tính duration chính xác

---

## 10. CẤU TRÚC DỰ ÁN DỰ KIẾN

```
vid-create/
├── src/
│   ├── orchestrator/      # AI điều phối pipeline
│   ├── scriptgen/         # AI tạo script bài giảng
│   ├── manimgen/          # AI sinh Manim code
│   ├── tts/               # TTS integration
│   ├── renderer/          # Manim rendering
│   ├── compositor/        # FFmpeg video assembly
│   └── recorder/          # Screen recording (Phase 2)
├── templates/             # Manim scene templates
├── output/                # Generated videos
├── docs/
└── README.md
```

---

## 11. BƯỚC TIẾP THEO

→ Chạy `/plan` để tạo thiết kế kỹ thuật chi tiết
