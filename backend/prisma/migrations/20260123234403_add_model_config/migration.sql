-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('OUTLINE', 'SLIDES', 'QUESTIONS', 'IMAGE', 'TTS');

-- CreateTable
CREATE TABLE "model_configs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "task_type" "TaskType" NOT NULL,
    "provider" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "model_configs_user_id_task_type_key" ON "model_configs"("user_id", "task_type");

-- AddForeignKey
ALTER TABLE "model_configs" ADD CONSTRAINT "model_configs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
