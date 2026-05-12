# 💡 Ideas — vid-create

## Ý tưởng chính
Tạo hệ thống tự động sinh video hướng dẫn bài học cho sinh viên, kết hợp:
1. **Manim** — Animation toán học/khoa học chất lượng cao (style 3Blue1Brown / GlassBox AI)
2. **AI Pipeline** — Tự động tạo script, sinh code, voiceover (style "Build Your Own AI Tutorial Video Generator")

## Nguồn cảm hứng
- Video "Cross Entropy" của GlassBox AI (Facebook) — animation giải thích ML concepts bằng tiếng Việt
- Bài viết "Build Your Own AI Tutorial Video Generator with Claude Code" (Substack)
- Các tool: Remotion, Motion Canvas, Topic2Manim, Math-To-Manim

## Hướng tiếp cận

### Approach 1: Manim + AI Script Generator
- Input: Chủ đề bài học (text)
- AI tạo script bài giảng (phân scene)
- AI sinh Manim Python code cho từng scene
- TTS tạo giọng đọc tiếng Việt
- FFmpeg ghép video + audio + subtitles

### Approach 2: Screen Recording + AI Narration (theo Substack article)
- Tự động hóa UI (browser/app) qua Playwright
- Quay màn hình bằng FFmpeg
- AI narration qua TTS (ElevenLabs/Edge TTS/Gemini TTS)
- Mix final video

### Approach 3: Hybrid
- Kết hợp cả 2: Manim cho phần animation, screen recording cho phần demo code/tool

## Tính năng mong muốn
- [ ] Input bằng text/markdown → Output video MP4
- [ ] Hỗ trợ tiếng Việt (script + voiceover)
- [ ] Vertical (9:16 Shorts) + Horizontal (16:9 YouTube)
- [ ] Template system cho nhiều môn học
- [ ] Công thức LaTeX animated
- [ ] Đồ thị/biểu đồ animated
- [ ] Subtitles tự động

## Công nghệ đã nghiên cứu
| Tool | Vai trò | Ghi chú |
|---|---|---|
| Manim (Python) | Animation engine | Phù hợp nhất với style GlassBox AI |
| Remotion (React) | Alternative animation | Tốt cho scale, web-based |
| Motion Canvas (TS) | Alternative animation | Hybrid Manim + web |
| ElevenLabs / Edge TTS | Voice synthesis | TTS tiếng Việt |
| Gemini TTS | Voice synthesis | Giọng Aoede chất lượng cao |
| FFmpeg | Video composition | Ghép audio + video + subs |
| GPT/Claude/Gemini | Script + Code generation | Tạo nội dung + Manim code |
| Playwright | Browser automation | Cho approach screen recording |
