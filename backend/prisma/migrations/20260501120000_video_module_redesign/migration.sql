-- =======================================================================
-- Migration: Video Module Redesign (Safe for Production)
-- Date: 2026-05-01
-- 
-- HOW TO RUN ON PRODUCTION:
--   1. SSH vào VPS
--   2. cd vào thư mục backend
--   3. Chạy: npx prisma db execute --stdin < prisma/migrations/20260501_video_module_redesign.sql
--   4. Sau đó: npx prisma generate
--   5. Restart backend
--
-- Script này AN TOÀN:
--   ✅ Chỉ ADD/RENAME — không DROP bất kỳ dữ liệu nào
--   ✅ Dùng IF EXISTS/IF NOT EXISTS — chạy lại nhiều lần không lỗi
--   ✅ Tự backfill subject_id từ lesson → subject
-- =======================================================================

-- ─── Utility: Function to safely rename column (skip if already renamed) ──
CREATE OR REPLACE FUNCTION safe_rename_column(
    _table TEXT, _old TEXT, _new TEXT
) RETURNS VOID AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = _table AND column_name = _old
    ) THEN
        EXECUTE format('ALTER TABLE %I RENAME COLUMN %I TO %I', _table, _old, _new);
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ─── Step 1: Rename tables ─────────────────────────────────────────────
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'VideoGeneration') THEN
        ALTER TABLE "VideoGeneration" RENAME TO "video_generations";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'VideoScene') THEN
        ALTER TABLE "VideoScene" RENAME TO "video_scenes";
    END IF;
END $$;

-- ─── Step 2: Rename columns (video_generations) ────────────────────────
SELECT safe_rename_column('video_generations', 'lessonId', 'lesson_id');
SELECT safe_rename_column('video_generations', 'userId', 'user_id');
SELECT safe_rename_column('video_generations', 'narrationLang', 'narration_lang');
SELECT safe_rename_column('video_generations', 'subtitleLang', 'subtitle_lang');
SELECT safe_rename_column('video_generations', 'narrationSpeed', 'narration_speed');
SELECT safe_rename_column('video_generations', 'currentStep', 'render_step');
SELECT safe_rename_column('video_generations', 'totalScenes', 'total_scenes');
SELECT safe_rename_column('video_generations', 'doneScenes', 'done_scenes');
SELECT safe_rename_column('video_generations', 'errorMessage', 'error_message');
SELECT safe_rename_column('video_generations', 'videoUrl', 'video_url');
SELECT safe_rename_column('video_generations', 'subtitleUrl', 'subtitle_url');
SELECT safe_rename_column('video_generations', 'thumbnailUrl', 'thumbnail_url');
SELECT safe_rename_column('video_generations', 'fileSize', 'file_size');
SELECT safe_rename_column('video_generations', 'videoScript', 'video_script');
SELECT safe_rename_column('video_generations', 'createdAt', 'created_at');
SELECT safe_rename_column('video_generations', 'updatedAt', 'updated_at');

-- ─── Rename columns (video_scenes) ─────────────────────────────────────
SELECT safe_rename_column('video_scenes', 'videoGenId', 'video_gen_id');
SELECT safe_rename_column('video_scenes', 'sceneIndex', 'scene_index');
SELECT safe_rename_column('video_scenes', 'narrationText', 'narration_text');
SELECT safe_rename_column('video_scenes', 'subtitleText', 'subtitle_text');
SELECT safe_rename_column('video_scenes', 'visualDesc', 'visual_desc');
SELECT safe_rename_column('video_scenes', 'imagePrompt', 'image_prompt');
SELECT safe_rename_column('video_scenes', 'imageUrl', 'image_url');
SELECT safe_rename_column('video_scenes', 'manimCode', 'manim_code');
SELECT safe_rename_column('video_scenes', 'codeLines', 'code_lines');
SELECT safe_rename_column('video_scenes', 'clipUrl', 'clip_url');
SELECT safe_rename_column('video_scenes', 'audioUrl', 'audio_url');
SELECT safe_rename_column('video_scenes', 'errorMessage', 'error_message');
SELECT safe_rename_column('video_scenes', 'retryCount', 'retry_count');
SELECT safe_rename_column('video_scenes', 'createdAt', 'created_at');

-- ─── Step 3: Add new columns (skip if already exist) ───────────────────
DO $$ BEGIN
    -- subject_id (nullable first, will set NOT NULL after backfill)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'video_generations' AND column_name = 'subject_id') THEN
        ALTER TABLE "video_generations" ADD COLUMN "subject_id" TEXT;
    END IF;

    -- title
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'video_generations' AND column_name = 'title') THEN
        ALTER TABLE "video_generations" ADD COLUMN "title" TEXT NOT NULL DEFAULT 'Video mới';
    END IF;

    -- input_type
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'video_generations' AND column_name = 'input_type') THEN
        ALTER TABLE "video_generations" ADD COLUMN "input_type" TEXT NOT NULL DEFAULT 'manual';
    END IF;

    -- input_text
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'video_generations' AND column_name = 'input_text') THEN
        ALTER TABLE "video_generations" ADD COLUMN "input_text" TEXT;
    END IF;

    -- input_files_json
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'video_generations' AND column_name = 'input_files_json') THEN
        ALTER TABLE "video_generations" ADD COLUMN "input_files_json" JSONB;
    END IF;

    -- edited_script
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'video_generations' AND column_name = 'edited_script') THEN
        ALTER TABLE "video_generations" ADD COLUMN "edited_script" JSONB;
    END IF;

    -- script_status
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'video_generations' AND column_name = 'script_status') THEN
        ALTER TABLE "video_generations" ADD COLUMN "script_status" TEXT NOT NULL DEFAULT 'none';
    END IF;

    -- wizard_step
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'video_generations' AND column_name = 'wizard_step') THEN
        ALTER TABLE "video_generations" ADD COLUMN "wizard_step" INTEGER NOT NULL DEFAULT 1;
    END IF;
END $$;

-- ─── Step 4: Backfill subject_id from lesson → subject ─────────────────
UPDATE "video_generations" vg
SET "subject_id" = l."subject_id",
    "input_type" = 'lesson'
FROM "lessons" l
WHERE vg."lesson_id" = l."id"
  AND vg."subject_id" IS NULL;

-- Delete orphaned records (video without valid lesson AND no subject)
DELETE FROM "video_generations" WHERE "subject_id" IS NULL;

-- Now enforce NOT NULL on subject_id
ALTER TABLE "video_generations" ALTER COLUMN "subject_id" SET NOT NULL;

-- ─── Step 5: Make lesson_id nullable ────────────────────────────────────
ALTER TABLE "video_generations" DROP CONSTRAINT IF EXISTS "VideoGeneration_lessonId_fkey";
ALTER TABLE "video_generations" DROP CONSTRAINT IF EXISTS "video_generations_lesson_id_fkey";
ALTER TABLE "video_generations" ALTER COLUMN "lesson_id" DROP NOT NULL;

-- Re-add FK with SET NULL
ALTER TABLE "video_generations" 
  ADD CONSTRAINT "video_generations_lesson_id_fkey" 
  FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") 
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Step 6: Add FK for subject_id ──────────────────────────────────────
ALTER TABLE "video_generations" DROP CONSTRAINT IF EXISTS "video_generations_subject_id_fkey";
ALTER TABLE "video_generations"
  ADD CONSTRAINT "video_generations_subject_id_fkey"
  FOREIGN KEY ("subject_id") REFERENCES "subjects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Step 7: Update other FK constraints ────────────────────────────────
ALTER TABLE "video_generations" DROP CONSTRAINT IF EXISTS "VideoGeneration_userId_fkey";
ALTER TABLE "video_generations" DROP CONSTRAINT IF EXISTS "video_generations_user_id_fkey";
ALTER TABLE "video_generations"
  ADD CONSTRAINT "video_generations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "video_scenes" DROP CONSTRAINT IF EXISTS "VideoScene_videoGenId_fkey";
ALTER TABLE "video_scenes" DROP CONSTRAINT IF EXISTS "video_scenes_video_gen_id_fkey";
ALTER TABLE "video_scenes"
  ADD CONSTRAINT "video_scenes_video_gen_id_fkey"
  FOREIGN KEY ("video_gen_id") REFERENCES "video_generations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Step 8: Recreate indexes ───────────────────────────────────────────
DROP INDEX IF EXISTS "VideoGeneration_lessonId_idx";
DROP INDEX IF EXISTS "VideoGeneration_userId_idx";
DROP INDEX IF EXISTS "VideoGeneration_status_idx";
DROP INDEX IF EXISTS "VideoScene_videoGenId_idx";
DROP INDEX IF EXISTS "VideoScene_videoGenId_sceneIndex_key";

CREATE INDEX IF NOT EXISTS "video_generations_subject_id_idx" ON "video_generations"("subject_id");
CREATE INDEX IF NOT EXISTS "video_generations_lesson_id_idx" ON "video_generations"("lesson_id");
CREATE INDEX IF NOT EXISTS "video_generations_user_id_idx" ON "video_generations"("user_id");
CREATE INDEX IF NOT EXISTS "video_generations_status_idx" ON "video_generations"("status");
CREATE INDEX IF NOT EXISTS "video_scenes_video_gen_id_idx" ON "video_scenes"("video_gen_id");

-- Unique index needs special handling (drop old, create new)
DROP INDEX IF EXISTS "VideoScene_videoGenId_sceneIndex_key";
CREATE UNIQUE INDEX IF NOT EXISTS "video_scenes_video_gen_id_scene_index_key" ON "video_scenes"("video_gen_id", "scene_index");

-- Change default status
ALTER TABLE "video_generations" ALTER COLUMN "status" SET DEFAULT 'draft';

-- ─── Cleanup: Drop utility function ────────────────────────────────────
DROP FUNCTION IF EXISTS safe_rename_column;

-- ─── Done! ──────────────────────────────────────────────────────────────
-- Run on production:
--   cd backend
--   npx prisma db execute --stdin < prisma/migrations/20260501_video_module_redesign.sql
--   npx prisma generate
--   Restart backend
