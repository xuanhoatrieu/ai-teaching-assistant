import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const scenes = await prisma.videoScene.findMany({
    where: { audioUrl: { not: null } },
    select: { sceneIndex: true, audioUrl: true, duration: true },
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log(JSON.stringify(scenes, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
