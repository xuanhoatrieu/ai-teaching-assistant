-- CreateTable
CREATE TABLE IF NOT EXISTS "english_questions" (
    "id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "question_order" INTEGER NOT NULL DEFAULT 0,
    "question_type" TEXT NOT NULL,
    "sub_discipline" TEXT,
    "difficulty" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT,
    "question_text" TEXT NOT NULL,
    "data_json" TEXT NOT NULL,
    "explanation" TEXT,
    "points" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "english_questions_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'english_questions_lesson_id_fkey'
    ) THEN
        ALTER TABLE "english_questions" ADD CONSTRAINT "english_questions_lesson_id_fkey" 
        FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "english_questions_lesson_id_idx" ON "english_questions"("lesson_id");
