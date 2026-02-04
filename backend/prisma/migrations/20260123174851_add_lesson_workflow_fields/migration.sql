-- AlterTable
ALTER TABLE "lessons" ADD COLUMN     "current_step" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "detailed_outline" TEXT,
ADD COLUMN     "slide_script" TEXT;

-- CreateTable
CREATE TABLE "question_banks" (
    "id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "questions_json" TEXT NOT NULL,
    "level_counts" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_banks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "question_banks_lesson_id_key" ON "question_banks"("lesson_id");

-- AddForeignKey
ALTER TABLE "question_banks" ADD CONSTRAINT "question_banks_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
