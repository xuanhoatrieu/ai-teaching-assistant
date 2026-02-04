-- CreateTable
CREATE TABLE "slide_audios" (
    "id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "slide_index" INTEGER NOT NULL,
    "slide_title" TEXT,
    "speakerNote" TEXT NOT NULL,
    "audio_file_name" TEXT,
    "audio_url" TEXT,
    "audio_duration" DOUBLE PRECISION,
    "voice_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slide_audios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "slide_audios_lesson_id_slide_index_key" ON "slide_audios"("lesson_id", "slide_index");

-- AddForeignKey
ALTER TABLE "slide_audios" ADD CONSTRAINT "slide_audios_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
