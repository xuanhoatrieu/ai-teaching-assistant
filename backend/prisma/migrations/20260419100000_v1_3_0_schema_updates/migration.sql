-- Migration: v1.3.0 schema updates
-- 1. Drop unused text normalizer table
-- 2. Add language to subjects
-- 3. Create pptx_audio_sessions table for new tool

-- Drop unused dicts
DROP TABLE IF EXISTS "tts_dictionaries" CASCADE;

-- Add subject language if not exists, safely (Postgres doesn't have ADD COLUMN IF NOT EXISTS in all versions, but we can try DO blocks)
-- Actually, let's just use standard Prisma migration style (it will run once).
ALTER TABLE "subjects" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'vi';

-- Create table for new PPTX Tool
CREATE TABLE "pptx_audio_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "slides_json" TEXT,
    "content_json" TEXT,
    "questions_json" TEXT,
    "language" TEXT NOT NULL DEFAULT 'vi',
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pptx_audio_sessions_pkey" PRIMARY KEY ("id")
);

-- Add Foreign Key
ALTER TABLE "pptx_audio_sessions" ADD CONSTRAINT "pptx_audio_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

