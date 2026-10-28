-- CreateTable
CREATE TABLE IF NOT EXISTS "pptx_subjects" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "institution_type" TEXT DEFAULT 'Đại học',
    "expertise_area" TEXT,
    "course_name" TEXT,
    "target_audience" TEXT,
    "major_name" TEXT,
    "additional_context" TEXT,
    "language" TEXT NOT NULL DEFAULT 'vi',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pptx_subjects_pkey" PRIMARY KEY ("id")
);

-- AlterTable pptx_audio_sessions
ALTER TABLE "pptx_audio_sessions" ADD COLUMN IF NOT EXISTS "pptx_subject_id" TEXT;
ALTER TABLE "pptx_audio_sessions" ADD COLUMN IF NOT EXISTS "lesson_title" TEXT;
ALTER TABLE "pptx_audio_sessions" ADD COLUMN IF NOT EXISTS "context_text" TEXT;
ALTER TABLE "pptx_audio_sessions" ADD COLUMN IF NOT EXISTS "context_file_name" TEXT;

-- AddForeignKeys
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'pptx_subjects_user_id_fkey'
    ) THEN
        ALTER TABLE "pptx_subjects" ADD CONSTRAINT "pptx_subjects_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'pptx_audio_sessions_pptx_subject_id_fkey'
    ) THEN
        ALTER TABLE "pptx_audio_sessions" ADD CONSTRAINT "pptx_audio_sessions_pptx_subject_id_fkey"
        FOREIGN KEY ("pptx_subject_id") REFERENCES "pptx_subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateIndexes
CREATE INDEX IF NOT EXISTS "pptx_subjects_user_id_idx" ON "pptx_subjects"("user_id");
CREATE INDEX IF NOT EXISTS "pptx_audio_sessions_pptx_subject_id_idx" ON "pptx_audio_sessions"("pptx_subject_id");
