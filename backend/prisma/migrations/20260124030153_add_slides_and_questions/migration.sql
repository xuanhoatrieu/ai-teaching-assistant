-- CreateTable
CREATE TABLE "slides" (
    "id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "slide_index" INTEGER NOT NULL,
    "slideType" TEXT NOT NULL DEFAULT 'content',
    "title" TEXT NOT NULL,
    "content" TEXT,
    "visual_idea" TEXT,
    "speaker_note" TEXT,
    "image_prompt" TEXT,
    "image_url" TEXT,
    "audio_url" TEXT,
    "audio_duration" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interactive_questions" (
    "id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "question_order" INTEGER NOT NULL DEFAULT 0,
    "question_type" TEXT NOT NULL DEFAULT 'MC',
    "question_text" TEXT NOT NULL,
    "image_url" TEXT,
    "video_url" TEXT,
    "audio_url" TEXT,
    "answer_1" TEXT,
    "answer_2" TEXT,
    "answer_3" TEXT,
    "answer_4" TEXT,
    "answer_5" TEXT,
    "answer_6" TEXT,
    "answer_7" TEXT,
    "answer_8" TEXT,
    "answer_9" TEXT,
    "answer_10" TEXT,
    "correct_feedback" TEXT,
    "incorrect_feedback" TEXT,
    "points" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interactive_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_questions" (
    "id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "question_order" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "question" TEXT NOT NULL,
    "correct_answer" TEXT NOT NULL,
    "option_b" TEXT NOT NULL,
    "option_c" TEXT NOT NULL,
    "option_d" TEXT NOT NULL,
    "explanation" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "slides_lesson_id_slide_index_key" ON "slides"("lesson_id", "slide_index");

-- CreateIndex
CREATE UNIQUE INDEX "review_questions_lesson_id_question_id_key" ON "review_questions"("lesson_id", "question_id");

-- AddForeignKey
ALTER TABLE "slides" ADD CONSTRAINT "slides_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactive_questions" ADD CONSTRAINT "interactive_questions_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_questions" ADD CONSTRAINT "review_questions_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
