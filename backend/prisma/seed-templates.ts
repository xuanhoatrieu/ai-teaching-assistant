import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * TUAF Green Template Styling (from pptx_creator.py)
 * 
 * Slide Size: 10" x 5.625" (16:9)
 * Font: Arial
 * 
 * Title Slide:
 * - Title: 44pt, bold, white (#FFFFFF)
 * - Subtitle: 22pt, white (#FFFFFF)
 * 
 * Content Slides:
 * - Header: 28pt, white (#FFFFFF)
 * - Bullet Point: 22-24pt, bold, green (#3A664D)
 * - Description: 18pt, green (#3A664D)
 */
const TUAF_GREEN_STYLING = {
    slideWidth: 10,      // inches
    slideHeight: 5.625,  // inches (16:9 ratio)
    font: {
        family: 'Arial',
    },
    titleSlide: {
        title: {
            size: 44,
            bold: true,
            color: '#FFFFFF',
            align: 'center',
        },
        subtitle: {
            size: 22,
            bold: false,
            color: '#FFFFFF',
            align: 'center',
        },
    },
    contentSlide: {
        header: {
            size: 28,
            bold: false,
            color: '#FFFFFF',
            align: 'center',
        },
        bulletPoint: {
            size: 22,
            bold: true,
            color: '#3A664D',  // Green from TUAF
        },
        bulletDescription: {
            size: 18,
            bold: false,
            color: '#3A664D',
        },
        agendaItem: {
            size: 24,
            bold: false,
            color: '#3A664D',
        },
    },
};

async function seedTemplates() {
    console.log('🌱 Seeding PPTX Templates...');

    // Check if TUAF Green already exists
    const existing = await prisma.pPTXTemplate.findFirst({
        where: { name: 'TUAF Green' },
    });

    if (existing) {
        console.log('✅ TUAF Green template already exists');
        return;
    }

    // Create TUAF Green template
    const template = await prisma.pPTXTemplate.create({
        data: {
            name: 'TUAF Green',
            description: 'Template xanh lá của Đại học Nông Lâm Thái Nguyên',
            titleBgUrl: '/templates/tuaf/1.png',
            contentBgUrl: '/templates/tuaf/2.png',
            thumbnailUrl: '/templates/tuaf/thumbnail.png',
            stylingJson: JSON.stringify(TUAF_GREEN_STYLING),
            isSystem: true,
            isDefault: true,
            isActive: true,
        },
    });

    console.log(`✅ Created template: ${template.name} (${template.id})`);
}

async function main() {
    try {
        await seedTemplates();
    } catch (error) {
        console.error('❌ Error seeding templates:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

main();
