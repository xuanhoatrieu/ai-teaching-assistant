const { PrismaClient } = require('@prisma/client');

async function debug() {
    const prisma = new PrismaClient();

    const lessonId = '8cfa0d22-76cb-46d8-90ef-58df17ea70c4';

    console.log('=== CHECKING SLIDES ===');
    const slides = await prisma.slide.findMany({
        where: { lessonId },
        select: {
            slideIndex: true,
            title: true,
            imageUrl: true,
            imagePrompt: true,
            visualIdea: true,
            status: true
        },
        orderBy: { slideIndex: 'asc' }
    });
    console.log('Total slides:', slides.length);
    slides.forEach(s => {
        console.log(`Slide ${s.slideIndex}: "${s.title}" | status=${s.status} | imageUrl=${s.imageUrl ? 'YES' : 'NO'} | visualIdea=${s.visualIdea ? 'YES' : 'NO'}`);
    });

    console.log('\n=== CHECKING AUDIO ===');
    const audios = await prisma.slideAudio.findMany({
        where: { lessonId },
        select: {
            slideIndex: true,
            audioUrl: true
        },
        orderBy: { slideIndex: 'asc' }
    });
    console.log('Total audios:', audios.length);
    audios.forEach(a => {
        console.log(`Audio ${a.slideIndex}: ${a.audioUrl || 'NO URL'}`);
    });

    await prisma.$disconnect();
}

debug().catch(console.error);
