# 0004 Async Generation Pattern for Long-Running AI Tasks

## Status

accepted

## Date

2026-05-14

## Context

Four AI generation endpoints consistently trigger Cloudflare 524 timeout errors
because they take 90-240 seconds to complete. Cloudflare's proxy has a fixed 100s
timeout that cannot be changed. The affected endpoints are:

- `POST /review-questions/generate` (50 questions, 120-240s)
- `POST /review-questions/append` (50 questions, 120-240s)
- `POST /slide-audios/generate-speaker-notes` (20-30 slides, 90-180s)
- `POST /slide-audios/optimize-speaker-notes` (20-30 slides, 90-180s)

Two approaches were considered:

1. **Chunked/Batched** — split prompts into smaller requests (5-10 items each),
   frontend loops through batches sequentially.
2. **Async + Polling** — POST returns job ID immediately, backend processes in
   background, frontend polls for status.

## Decision

Use the **Async + Polling** pattern with DB-persisted job state.

## Rationale

- **Quality**: AI generates better content when seeing the full context in one
  prompt. Chunked approach risks duplicate questions and inconsistent tone.
- **Token efficiency**: One large prompt vs 5 repeated prompts saves 3-5x tokens.
- **Reusability**: Generic `GenerationJob` model can be reused for any future
  long-running task.
- **Resilience**: DB-persisted jobs survive backend restarts (unlike in-memory).

Chunked approach was rejected because:
- Speaker notes require consistent tone across all slides
- Review questions need Bloom level distribution awareness across entire question set
- Token cost multiplies with each batch sending the same context

## Consequences

- New `generation_jobs` table in PostgreSQL
- 4 endpoints change their response contract (breaking change for frontend)
- Frontend must implement polling logic (new `useJobPolling` hook)
- Slightly more complex error handling (job failure vs HTTP failure)
