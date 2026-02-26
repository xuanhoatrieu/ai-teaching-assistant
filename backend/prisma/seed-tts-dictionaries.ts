import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/**
 * Seed TTS dictionaries with common IT acronyms and non-Vietnamese words.
 * These are SYSTEM-scope entries (admin-managed, available to all users).
 */
async function main() {
    console.log('🔤 Seeding TTS dictionaries...');

    const acronyms = [
        { original: 'CPU', replacement: 'xê pê u' },
        { original: 'GPU', replacement: 'giê pê u' },
        { original: 'RAM', replacement: 'ram' },
        { original: 'ROM', replacement: 'rom' },
        { original: 'SSD', replacement: 'ét ét đê' },
        { original: 'HDD', replacement: 'hát đê đê' },
        { original: 'API', replacement: 'a pê i' },
        { original: 'JSON', replacement: 'jay-son' },
        { original: 'HTML', replacement: 'hát tê mê eo' },
        { original: 'CSS', replacement: 'xê ét ét' },
        { original: 'SQL', replacement: 'ét cờ eo' },
        { original: 'IDE', replacement: 'ai đi i' },
        { original: 'CLI', replacement: 'xê eo ai' },
        { original: 'GUI', replacement: 'gieo ai' },
        { original: 'URL', replacement: 'u eo eo' },
        { original: 'USB', replacement: 'u ét bê' },
        { original: 'PDF', replacement: 'pê đê ép' },
        { original: 'AI', replacement: 'trí tuệ nhân tạo' },
        { original: 'IoT', replacement: 'ai ô ti' },
        { original: 'HTTP', replacement: 'hát tê tê pê' },
        { original: 'HTTPS', replacement: 'hát tê tê pê ét' },
        { original: 'DNS', replacement: 'đê en ét' },
        { original: 'IP', replacement: 'ai pê' },
        { original: 'TCP', replacement: 'tê xê pê' },
        { original: 'UDP', replacement: 'u đê pê' },
        { original: 'WiFi', replacement: 'oai-phai' },
        { original: 'LAN', replacement: 'lăn' },
        { original: 'WAN', replacement: 'oăn' },
        { original: 'OS', replacement: 'ô ét' },
        { original: 'UI', replacement: 'u ai' },
        { original: 'UX', replacement: 'u ét' },
        { original: 'SDK', replacement: 'ét đê kây' },
        { original: 'NPM', replacement: 'en pê em' },
        { original: 'VPS', replacement: 'vê pê ét' },
    ];

    const nonVietnameseWords = [
        { original: 'file', replacement: 'phai' },
        { original: 'server', replacement: 'xơ-vơ' },
        { original: 'database', replacement: 'đa-ta-bê' },
        { original: 'driver', replacement: 'đrai-vơ' },
        { original: 'software', replacement: 'xóp-queo' },
        { original: 'hardware', replacement: 'hát-queo' },
        { original: 'download', replacement: 'đao-lốt' },
        { original: 'upload', replacement: 'ắp-lốt' },
        { original: 'update', replacement: 'ắp-đết' },
        { original: 'backup', replacement: 'bé-ắp' },
        { original: 'click', replacement: 'kích' },
        { original: 'email', replacement: 'i-meo' },
        { original: 'online', replacement: 'on-lai' },
        { original: 'offline', replacement: 'óp-lai' },
        { original: 'website', replacement: 'uếp-xai' },
    ];

    let created = 0;
    let skipped = 0;

    // Seed acronyms
    for (const entry of acronyms) {
        try {
            await prisma.tTSDictionary.upsert({
                where: {
                    type_original_scope_userId: {
                        type: 'acronym',
                        original: entry.original,
                        scope: 'system',
                        userId: '',  // Prisma requires non-null for unique
                    },
                },
                create: {
                    type: 'acronym',
                    original: entry.original,
                    replacement: entry.replacement,
                    scope: 'system',
                    userId: null,
                },
                update: {
                    replacement: entry.replacement,
                },
            });
            created++;
        } catch {
            // Unique constraint — try without userId in where
            try {
                const existing = await prisma.tTSDictionary.findFirst({
                    where: {
                        type: 'acronym',
                        original: entry.original,
                        scope: 'system',
                        userId: null,
                    },
                });
                if (existing) {
                    await prisma.tTSDictionary.update({
                        where: { id: existing.id },
                        data: { replacement: entry.replacement },
                    });
                } else {
                    await prisma.tTSDictionary.create({
                        data: {
                            type: 'acronym',
                            original: entry.original,
                            replacement: entry.replacement,
                            scope: 'system',
                            userId: null,
                        },
                    });
                }
                created++;
            } catch (e2) {
                console.warn(`  ⚠️ Skip acronym ${entry.original}: ${(e2 as Error).message}`);
                skipped++;
            }
        }
    }

    // Seed non-Vietnamese words
    for (const entry of nonVietnameseWords) {
        try {
            const existing = await prisma.tTSDictionary.findFirst({
                where: {
                    type: 'word',
                    original: entry.original,
                    scope: 'system',
                    userId: null,
                },
            });
            if (existing) {
                await prisma.tTSDictionary.update({
                    where: { id: existing.id },
                    data: { replacement: entry.replacement },
                });
            } else {
                await prisma.tTSDictionary.create({
                    data: {
                        type: 'word',
                        original: entry.original,
                        replacement: entry.replacement,
                        scope: 'system',
                        userId: null,
                    },
                });
            }
            created++;
        } catch (e) {
            console.warn(`  ⚠️ Skip word ${entry.original}: ${(e as Error).message}`);
            skipped++;
        }
    }

    console.log(`✅ TTS Dictionaries seeded: ${created} entries created/updated, ${skipped} skipped`);
}

main()
    .catch((e) => {
        console.error('❌ Seeding TTS dictionaries failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
