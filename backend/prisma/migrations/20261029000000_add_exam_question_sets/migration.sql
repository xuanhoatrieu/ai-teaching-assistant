-- CreateTable
CREATE TABLE IF NOT EXISTS "exam_question_sets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "subject_id" TEXT,
    "pptx_subject_id" TEXT,
    "title" TEXT NOT NULL,
    "category_name" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'REVIEW',
    "lesson_ids_json" TEXT NOT NULL DEFAULT '[]',
    "config_json" TEXT NOT NULL DEFAULT '{}',
    "questions_json" TEXT NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_question_sets_pkey" PRIMARY KEY ("id")
);

-- AddForeignKeys
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'exam_question_sets_user_id_fkey'
    ) THEN
        ALTER TABLE "exam_question_sets" ADD CONSTRAINT "exam_question_sets_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'exam_question_sets_subject_id_fkey'
    ) THEN
        ALTER TABLE "exam_question_sets" ADD CONSTRAINT "exam_question_sets_subject_id_fkey"
        FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'exam_question_sets_pptx_subject_id_fkey'
    ) THEN
        ALTER TABLE "exam_question_sets" ADD CONSTRAINT "exam_question_sets_pptx_subject_id_fkey"
        FOREIGN KEY ("pptx_subject_id") REFERENCES "pptx_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateIndexes
CREATE INDEX IF NOT EXISTS "exam_question_sets_user_id_idx" ON "exam_question_sets"("user_id");
CREATE INDEX IF NOT EXISTS "exam_question_sets_subject_id_idx" ON "exam_question_sets"("subject_id");
CREATE INDEX IF NOT EXISTS "exam_question_sets_pptx_subject_id_idx" ON "exam_question_sets"("pptx_subject_id");
