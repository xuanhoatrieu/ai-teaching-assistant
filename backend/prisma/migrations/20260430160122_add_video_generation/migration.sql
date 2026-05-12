-- CreateTable
CREATE TABLE "VideoGeneration" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'horizontal',
    "resolution" TEXT NOT NULL DEFAULT '1080p',
    "style" TEXT NOT NULL DEFAULT 'auto',
    "narrationLang" TEXT NOT NULL DEFAULT 'vi',
    "subtitleLang" TEXT NOT NULL DEFAULT 'vi',
    "narrationSpeed" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentStep" TEXT,
    "totalScenes" INTEGER NOT NULL DEFAULT 0,
    "doneScenes" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "videoUrl" TEXT,
    "subtitleUrl" TEXT,
    "thumbnailUrl" TEXT,
    "duration" DOUBLE PRECISION,
    "fileSize" INTEGER,
    "videoScript" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoScene" (
    "id" TEXT NOT NULL,
    "videoGenId" TEXT NOT NULL,
    "sceneIndex" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "approach" TEXT NOT NULL,
    "narrationText" TEXT NOT NULL,
    "subtitleText" TEXT,
    "visualDesc" TEXT,
    "imagePrompt" TEXT,
    "imageUrl" TEXT,
    "manimCode" TEXT,
    "codeLines" JSONB,
    "clipUrl" TEXT,
    "audioUrl" TEXT,
    "duration" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoScene_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VideoGeneration_lessonId_idx" ON "VideoGeneration"("lessonId");

-- CreateIndex
CREATE INDEX "VideoGeneration_userId_idx" ON "VideoGeneration"("userId");

-- CreateIndex
CREATE INDEX "VideoGeneration_status_idx" ON "VideoGeneration"("status");

-- CreateIndex
CREATE INDEX "VideoScene_videoGenId_idx" ON "VideoScene"("videoGenId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoScene_videoGenId_sceneIndex_key" ON "VideoScene"("videoGenId", "sceneIndex");

-- AddForeignKey
ALTER TABLE "VideoGeneration" ADD CONSTRAINT "VideoGeneration_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoGeneration" ADD CONSTRAINT "VideoGeneration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoScene" ADD CONSTRAINT "VideoScene_videoGenId_fkey" FOREIGN KEY ("videoGenId") REFERENCES "VideoGeneration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
