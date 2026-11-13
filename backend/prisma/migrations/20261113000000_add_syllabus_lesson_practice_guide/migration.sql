-- AlterTable: Add parallel Practice Guide fields to syllabus_lessons
ALTER TABLE "syllabus_lessons"
    ADD COLUMN IF NOT EXISTS "practice_content" TEXT,
    ADD COLUMN IF NOT EXISTS "practice_status" TEXT NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS "practice_phase" TEXT,
    ADD COLUMN IF NOT EXISTS "practice_plan" TEXT,
    ADD COLUMN IF NOT EXISTS "practice_images" JSONB;

