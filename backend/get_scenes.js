const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const scenes = await prisma.videoScene.findMany({
    where: { videoId: '4061de5e-f792-4e22-8e43-1bebb9e0319d' },
    orderBy: { sceneIndex: 'asc' }
  });
  
  for (const scene of scenes) {
    console.log(`\n=== Scene ${scene.sceneIndex}: ${scene.title} ===`);
    console.log(`Approach: ${scene.approach}`);
    if (scene.manimCode) {
      console.log(scene.manimCode);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
