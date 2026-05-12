# Plan: Multi-Phase Textbook Generation
Created: 2026-05-12
Status: 🟡 In Progress
BRIEF: brief.md

## Overview
Nâng cấp textbook generation từ 1-shot → 5-step pipeline:
EXTRACT → PLAN → WRITE → ILLUSTRATE → REVIEW+FIX

**Nguyên tắc:** Additive-only. Không sửa logic cũ. Giữ `generateTextbook()` cũ làm fallback.

## Tech Stack (đã có + thêm mới)
- Backend: NestJS + Prisma + PostgreSQL (có sẵn)
- AI: Gemini/CLIProxy (có sẵn)
- Image: ImagenService + CLIProxy GPT Image (có sẵn)
- Export: Pandoc + reference.docx (có sẵn)
- **MỚI:** Mermaid CLI (`@mermaid-js/mermaid-cli`) cho diagram → PNG

## Phases

| Phase | Name | Status | Est. | Tasks |
|-------|------|--------|------|-------|
| 01 | Infrastructure (Mermaid + DB) | ✅ Complete | 0.5d | 5 |
| 02 | Reference Enhancement | ✅ Complete | 0.5d | 3 |
| 03 | Multi-Phase Pipeline Core | ✅ Complete | 1.5d | 6 |
| 04 | Illustrate Step | ✅ Complete | 1d | 5 |
| 05 | Frontend Progress + Preview | ✅ Complete | 0.5d | 4 |
| 06 | E2E Test + Polish | ⬜ Manual testing needed | 0.5d | 3 |

**Total:** 26 tasks | All code complete, E2E testing pending

## Quick Commands
- Start Phase 1: `/code phase-01`
- Check progress: `/next`
- Save context: `/save-brain`
