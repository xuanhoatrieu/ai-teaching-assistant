# Phase 04: React Frontend Page
**Status:** ⬜ Pending
**Dependencies:** Phase 03 (Backend API)
**Location:** `ai-teaching-assistant/frontend/src/`

## Objective
Thêm trang Video Generator vào frontend React (Step 7 workflow).

## Steps
1. [ ] Route: `/lessons/:id/video` → VideoGeneratorPage
2. [ ] VideoGeneratorPage.tsx — Main layout
3. [ ] ConfigPanel.tsx — format, resolution, lang, speed, style
4. [ ] ProgressTracker.tsx — WebSocket real-time scene progress
5. [ ] VideoPreview.tsx — HTML5 player + subtitle toggle
6. [ ] VideoHistory.tsx — Past videos list
7. [ ] API client: `lib/videoGenApi.ts`
8. [ ] Navigation: Button "Tạo Video" trên lesson page

## Test Criteria
- [ ] Config → API call → progress → preview → download
- [ ] WebSocket scene-by-scene updates
- [ ] Delete video works

---
Next Phase: phase-05-integration.md
