# Phase 05: Integration & E2E Test
**Status:** ⬜ Pending
**Dependencies:** Phase 01-04

## Objective
Kết nối tất cả components, Docker deploy, và test end-to-end.

## Steps
1. [ ] Docker Compose: thêm `vid-worker` service (Manim + Playwright + FFmpeg)
2. [ ] E2E test: lesson outline → generate → wait → download MP4
3. [ ] Error handling: scene lỗi → retry → skip → partial video
4. [ ] Vertical video (9:16): test Manim + Playwright ở portrait mode
5. [ ] Performance: benchmark render time per scene type
6. [ ] Queue management: concurrent jobs limit, priority queue
7. [ ] Documentation: API docs, deployment guide, troubleshooting

## Docker vid-worker service
```yaml
vid-worker:
  build: ./vid-worker
  depends_on: [redis]
  environment:
    - REDIS_URL=redis://redis:6379
    - VITTS_API_KEY=${VITTS_API_KEY}
    - GEMINI_API_KEY=${GEMINI_API_KEY}
    - MINIO_ENDPOINT=minio:9000
  volumes:
    - vid-worker-cache:/app/cache
  deploy:
    resources:
      limits:
        memory: 4G
```

## Test Criteria
- [ ] Full pipeline: outline → video MP4 + SRT in < 10min (5 scenes)
- [ ] Docker build & run OK
- [ ] Multiple simultaneous jobs queued properly
- [ ] Partial video output when 1 scene fails
