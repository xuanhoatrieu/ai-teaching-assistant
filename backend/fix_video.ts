import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  await prisma.videoGeneration.update({
    where: { id: '6a4353be-8c95-42b8-87ef-9d9a5728e50f' },
    data: {
      status: 'done',
      progress: 100,
      totalScenes: 13,
      doneScenes: 13,
      videoUrl: 'videos/5dd99626-66c3-4bce-8856-4d13a8f4b073/6a4353be-8c95-42b8-87ef-9d9a5728e50f/final.mp4',
      subtitleUrl: 'videos/5dd99626-66c3-4bce-8856-4d13a8f4b073/6a4353be-8c95-42b8-87ef-9d9a5728e50f/subtitle_vi.srt',
      duration: 221.6,
      fileSize: 10684766
    }
  });
  console.log('Fixed video generation status!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
