# US-009 Async Generation Jobs

## Status

planned

## Lane

normal

## Risk Classification

| Risk flag | Applies? | Reason |
| --- | --- | --- |
| Auth | No | |
| Authorization | No | |
| Data model | **Yes** | New `GenerationJob` table, Prisma migration |
| Audit/security | No | |
| External systems | No | Uses same AI providers, no new external deps |
| Public contracts | **Yes** | 4 API endpoints change response shape (return jobId instead of data) |
| Cross-platform | No | |
| Existing behavior | **Yes** | Modifies 4 existing endpoints that users actively use |
| Weak proof | Yes | No existing tests for these endpoints |
| Multi-domain | No | Single domain (content generation) |

**Flags: 4 → normal with stronger validation** (no hard gates triggered)

## Product Contract

When a user triggers AI content generation (review questions, speaker notes, optimize notes, append questions), the system must:
1. Return a job ID immediately (<1s) instead of blocking the HTTP connection
2. Process the AI generation in the background
3. Provide a polling endpoint for frontend to check job status/progress
4. Save results to the same DB tables as before (ReviewQuestion, Slide, SlideAudio)
5. Handle errors gracefully — mark job as failed with error message

## Relevant Product Docs

- `docs/BRIEF.md` — Original product spec
- `docs/ARCHITECTURE.md` — System architecture

## Acceptance Criteria

- POST `/review-questions/generate` returns `{ jobId, status: "pending" }` within 1 second
- POST `/review-questions/append` returns `{ jobId, status: "pending" }` within 1 second
- POST `/slide-audios/generate-speaker-notes` returns `{ jobId, status: "pending" }` within 1 second
- POST `/slide-audios/optimize-speaker-notes` returns `{ jobId, status: "pending" }` within 1 second
- GET `/generation-jobs/:id/status` returns `{ status, progress, message, error }`
- Frontend polls and displays progress bar for all 4 operations
- No Cloudflare 524 timeout errors on production
- Generated content (questions, speaker notes) saved correctly to DB
- Partial failure: job marked as error, previously saved data retained

## Design Notes

- Tables: `generation_jobs` (new)
- API: `GET /generation-jobs/:id/status` (new generic endpoint)
- API: 4 existing POST endpoints modified to return jobId
- Domain rules: Background processing via `setImmediate()` — no BullMQ needed (single instance)
- UI surfaces: Step4GenerateAudio, Step6QuestionBank — polling + progress bar

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | GenerationJobService CRUD operations |
| Integration | Background job completes and saves data to DB |
| E2E | User clicks generate → sees progress → gets results |
| Platform | No CF 524 timeout on production VPS |
| Release | Full pipeline: generate questions + speaker notes for 1 lesson |

## Harness Delta

- New story pattern: async job processing for long-running AI tasks
- Reusable `useJobPolling` hook pattern for frontend

## Evidence

Pending implementation.
