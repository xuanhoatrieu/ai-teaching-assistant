# Design Specifications — Video Generator Page

**Dựa trên:** Mockup approved | Consistent với AI Teaching Assistant app

---

## 🎨 Color Palette

| Name | Hex | Usage |
|------|-----|-------|
| Primary | `#6366f1` | Buttons, active states, progress bar |
| Primary Hover | `#4f46e5` | Button hover |
| Primary Light | `#818cf8` | Badges, links |
| Success | `#22c55e` | Done scenes ✅ |
| Warning | `#f59e0b` | Rendering scenes 🔄 |
| Error | `#ef4444` | Failed scenes, delete buttons |
| Background | `#0f172a` | Page background |
| Surface | `#1e293b` | Cards, panels |
| Surface Light | `#334155` | Dropdowns, inputs |
| Border | `#475569` | Card borders, dividers |
| Text Primary | `#f1f5f9` | Headings, main text |
| Text Secondary | `#94a3b8` | Labels, subtitles |
| Text Muted | `#64748b` | Placeholders, disabled |

## 📝 Typography

| Element | Font | Size | Weight |
|---------|------|------|--------|
| Page Title | Inter | 28px | 700 |
| Subtitle | Inter | 14px | 400 |
| Panel Title | Inter | 18px | 600 |
| Label | Inter | 13px | 500 |
| Body | Inter | 14px | 400 |
| Badge | Inter | 12px | 500 |
| Button | Inter | 14px | 600 |

## 📐 Layout

| Property | Value |
|----------|-------|
| Max width | 1200px |
| Page padding | 24px |
| Card padding | 20px |
| Card border-radius | 12px |
| Card border | 1px solid #334155 |
| Card background | #1e293b |
| Gap between cards | 20px |

## 🧩 Component Specs

### Config Panel
- Grid: 3 columns × 2 rows for dropdowns
- Dropdown: height 40px, bg #334155, border-radius 8px
- "Tạo Video" button: full height of panel, bg #6366f1, border-radius 12px

### Progress Panel
- Progress bar: height 8px, border-radius 4px, bg track #334155, fill #6366f1
- Scene list: vertical stack, gap 8px
- Status badges: padding 2px 8px, border-radius 4px, font 12px
  - Manim: bg #6366f1/20%, text #818cf8
  - Playwright: bg #f59e0b/20%, text #fbbf24
  - AI Image: bg #22c55e/20%, text #4ade80
  - Static: bg #94a3b8/20%, text #cbd5e1

### Video Preview
- Aspect ratio: 16:9
- Border-radius: 8px
- Download buttons: side by side, gap 12px
  - MP4: bg #6366f1
  - SRT: bg transparent, border 1px #6366f1

### History Table
- Header: text #94a3b8, uppercase, font 12px
- Rows: border-bottom 1px #334155
- Action buttons: icon only, 32×32px

## ✨ Animations
| Element | Trigger | Duration | Effect |
|---------|---------|----------|--------|
| Progress bar | update | 500ms | width transition ease-out |
| Scene status | change | 300ms | fade + color change |
| Cards | mount | 300ms | fadeIn + translateY(8px) |
| Buttons | hover | 150ms | brightness(1.1) |

## 📱 Responsive
| Breakpoint | Changes |
|-----------|---------|
| < 768px | Config grid → 2 columns, "Tạo Video" full width below |
| < 640px | Config grid → 1 column, scene list + preview stacked |
