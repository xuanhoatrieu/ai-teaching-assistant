# 🎬 Hướng Dẫn Áp Dụng Manim Vào Dự Án Vid-Create

## 📌 Manim Là Gì & Dùng Như Thế Nào?

**Manim** = "Mathematical Animation" — một thư viện Python viết bởi Grant Sanderson (3Blue1Brown).

**Cách hoạt động đơn giản:**
```
Bạn viết code Python → Manim render ra video MP4
```

Mỗi video là một **Scene** (cảnh) — bạn định nghĩa:
- Đối tượng gì xuất hiện (text, công thức, đồ thị, hình...)
- Animation nào (hiện dần, biến đổi, di chuyển...)
- Thứ tự và thời gian

---

## 🔧 Workflow Thực Tế (Đã Test Thành Công)

### Bước 1: Viết Scene bằng Python

```python
from manimlib import *

class BaiHocDemo(Scene):
    def construct(self):
        # 1. Tạo tiêu đề
        title = Text("CROSS ENTROPY", font_size=72, color=YELLOW)
        self.play(Write(title))   # Animation: viết từng chữ

        # 2. Tạo công thức LaTeX
        formula = Tex(r"L = -\sum y_i \cdot \log(p_i)")
        self.play(Write(formula))  # Animation: viết công thức

        # 3. Tạo đồ thị
        axes = Axes(x_range=[0, 1], y_range=[0, 5])
        graph = axes.get_graph(lambda x: -np.log(max(x, 0.01)))
        self.play(ShowCreation(graph))  # Animation: vẽ đường cong

        # 4. Chờ để người xem đọc
        self.wait(2)
```

### Bước 2: Render thành video

```bash
# Kích hoạt môi trường
source venv/bin/activate

# Render video HD (headless, trên server)
xvfb-run -s "-screen 0 1920x1080x24" manimgl file.py SceneName -w --hd

# Output: videos/SceneName.mp4
```

### Bước 3: Ghép với audio (TTS)

```bash
# Gọi TTS API tạo voiceover
# Ghép bằng FFmpeg
ffmpeg -i video.mp4 -i voiceover.mp3 -c:v copy -c:a aac output.mp4
```

---

## 🏗️ Pipeline Tự Động Trong Dự Án

```
┌─────────────────────────────────────────────────────────┐
│                    PIPELINE OVERVIEW                     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  📝 INPUT: "Giải thích Cross Entropy cho sinh viên"     │
│       ↓                                                 │
│  🤖 AI SCRIPT GEN: LLM tạo kịch bản bài giảng         │
│       ↓                                                 │
│       ┌──────────────────────────────────┐              │
│       │  Script JSON (mỗi scene):       │              │
│       │  {                              │              │
│       │    "scene": "title",            │              │
│       │    "text": "CROSS ENTROPY",     │              │
│       │    "narration": "Hôm nay...",   │              │
│       │    "animation": "Write"         │              │
│       │  }                              │              │
│       └──────────────┬───────────────────┘              │
│                      ↓                                  │
│  🐍 MANIM CODE GEN: LLM → Python code cho từng scene   │
│       ↓                                                 │
│  ✅ VALIDATOR: Kiểm tra code chạy được không            │
│       ↓                                                 │
│  🎬 MANIM RENDER: xvfb-run manimgl ... -w --hd         │
│       ↓                                                 │
│  🗣️ TTS API: Gọi local TTS → audio.mp3                │
│       ↓                                                 │
│  🎞️ FFMPEG: Ghép video + audio + subtitle              │
│       ↓                                                 │
│  📹 OUTPUT: video_final.mp4                             │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 🎨 Manim Có Thể Tạo Gì?

### 1. Text & Typography (giống GlassBox AI)
```python
# Tiêu đề màu
title = Text("CROSS ENTROPY", color=YELLOW, font_size=72)
# Text tiếng Việt
desc = Text("Hàm mất mát", font_size=32, color=GREY_B)
```

### 2. Công thức LaTeX (animation đẹp)
```python
formula = Tex(r"L = -\log(P)")
self.play(Write(formula))            # Viết từng ký tự
self.play(TransformMatchingTex(...))  # Biến đổi công thức
```

### 3. Đồ thị & Biểu đồ
```python
# Đồ thị hàm số
axes = Axes(x_range=[0, 1], y_range=[0, 5])
graph = axes.get_graph(lambda x: -np.log(x))
self.play(ShowCreation(graph))  # Vẽ đường cong animated

# Bar chart
chart = BarChart(values=[0.2, 0.5, 0.3], bar_names=["Mèo", "Chó", "Cáo"])
```

### 4. Hình học & Vector
```python
circle = Circle(radius=2, color=BLUE)
arrow = Arrow(LEFT, RIGHT, color=RED)
self.play(ShowCreation(circle))
self.play(GrowArrow(arrow))
```

### 5. Animation Types
```python
# Xuất hiện
self.play(FadeIn(obj))           # Mờ → rõ
self.play(Write(text))           # Viết từng chữ
self.play(ShowCreation(shape))   # Vẽ hình

# Biến đổi
self.play(Transform(a, b))      # Biến a thành b
self.play(obj.animate.shift(RIGHT))  # Di chuyển
self.play(obj.animate.scale(2))      # Phóng to

# Biến mất
self.play(FadeOut(obj))
self.play(Uncreate(shape))

# Nhấn mạnh
self.play(Indicate(obj))        # Flash highlight
self.play(Flash(point))         # Tia sáng
```

---

## 📁 Cấu Trúc File Trong Pipeline

```
vid-create/
├── manim/                    ← Source ManimGL (đã clone)
│   └── manimlib/             ← Thư viện core (có thể mở rộng)
│
├── src/
│   ├── orchestrator.py       ← Điều phối toàn bộ pipeline
│   ├── script_gen.py         ← AI tạo kịch bản JSON
│   ├── manim_gen.py          ← AI sinh code Python Manim
│   ├── manim_validator.py    ← Kiểm tra code trước render
│   ├── renderer.py           ← Gọi Manim render video
│   ├── tts_client.py         ← Gọi API TTS local
│   └── compositor.py         ← FFmpeg ghép video+audio
│
├── templates/                ← Manim scene templates tái sử dụng
│   ├── title_card.py         ← Template: Title đầu video
│   ├── formula_scene.py      ← Template: Công thức LaTeX
│   ├── graph_scene.py        ← Template: Đồ thị hàm số
│   ├── comparison_scene.py   ← Template: So sánh 2 model
│   ├── bar_chart_scene.py    ← Template: Biểu đồ cột
│   └── ending_scene.py       ← Template: Kết thúc video
│
├── custom_manimlib/          ← MỞ RỘNG RIÊNG (build thêm)
│   ├── vietnamese_text.py    ← Hỗ trợ font tiếng Việt
│   ├── edu_animations.py     ← Animation giáo dục custom
│   ├── vertical_scene.py     ← Scene 9:16 (Shorts/Reels)
│   └── data_viz.py           ← Visualization nâng cao
│
├── venv/                     ← Python environment
├── videos/                   ← Output videos
├── output/                   ← Final composed videos
└── docs/
```

---

## 🔑 Các Bước Mở Rộng Manim

### Mở rộng 1: Scene Vertical (9:16) cho Shorts/Reels
```python
# custom_manimlib/vertical_scene.py
class VerticalScene(Scene):
    """Scene dạng dọc 1080x1920 cho TikTok/Reels"""
    CONFIG = {
        "camera_config": {
            "pixel_width": 1080,
            "pixel_height": 1920,
        }
    }
```

### Mở rộng 2: Font Tiếng Việt
```python
# Dùng font hỗ trợ Unicode
text = Text("Xin chào!", font="Roboto")
```

### Mở rộng 3: Template System
```python
# templates/title_card.py
class TitleCard(Scene):
    def __init__(self, title, subtitle, color=YELLOW):
        self.title_text = title
        self.subtitle_text = subtitle
        self.title_color = color
        super().__init__()

    def construct(self):
        title = Text(self.title_text, font_size=72, color=self.title_color)
        subtitle = Text(self.subtitle_text, font_size=32, color=GREY_B)
        subtitle.next_to(title, DOWN, buff=0.5)
        self.play(Write(title), run_time=1.5)
        self.play(FadeIn(subtitle, shift=UP * 0.3))
        self.wait(1)
```

### Mở rộng 4: Auto-render từ JSON
```python
# src/renderer.py
def render_scene(scene_file, scene_name, quality="hd"):
    """Render 1 scene thành video MP4"""
    cmd = f"xvfb-run -s '-screen 0 1920x1080x24' manimgl {scene_file} {scene_name} -w --{quality}"
    subprocess.run(cmd, shell=True, check=True)
```

---

## 📊 Demo Đã Chạy Thành Công

| Demo | File | Kết quả |
|------|------|---------|
| OpeningManimExample | `manim/example_scenes.py` | ✅ 1920×1080, 22s |
| **CrossEntropyDemo** | `demo_cross_entropy.py` | ✅ 1920×1080, 39.6s |

Video demo tại: `videos/CrossEntropyDemo.mp4`

---

## 🚀 Next Steps

1. **`/plan`** — Thiết kế chi tiết từng module (script_gen, manim_gen, tts_client...)
2. **`/code`** — Code từng module theo plan
3. Test pipeline end-to-end: Text → Video
