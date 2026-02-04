import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    // Find bai03 lesson
    const lessons = await prisma.lesson.findMany({
        where: {
            OR: [
                { title: { contains: 'bai03' } },
                { title: { contains: 'bài 3' } },
                { title: { contains: '03' } }
            ]
        },
        select: {
            id: true,
            title: true,
            slideScript: true,
        }
    });

    console.log('\n=== LESSONS ===');
    for (const lesson of lessons) {
        console.log(`ID: ${lesson.id}, Title: ${lesson.title}`);
        console.log(`SlideScript: ${lesson.slideScript ? `${lesson.slideScript.length} chars` : 'NULL'}`);

        // Check slides
        const slides = await prisma.slide.findMany({
            where: { lessonId: lesson.id },
            select: {
                id: true,
                slideIndex: true,
                title: true,
                optimizedContentJson: true,
                imageUrl: true,
            }
        });

        console.log(`\nSlides for ${lesson.title}: ${slides.length} slides`);
        for (const slide of slides) {
            console.log(`  [${slide.slideIndex}] ${slide.title}`);
            console.log(`    - optimizedContentJson: ${slide.optimizedContentJson ? 'YES' : 'NULL'}`);
            console.log(`    - imageUrl: ${slide.imageUrl ? 'YES' : 'NULL'}`);
        }
        console.log('---');
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
