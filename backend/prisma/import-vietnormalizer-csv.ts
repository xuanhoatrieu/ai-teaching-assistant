/**
 * Import all vietnormalizer CSV entries into the TTSDictionary DB table.
 * Replaces the old seed-tts-dictionaries.ts with FULL import from repo CSVs.
 *
 * Run: npx ts-node prisma/import-vietnormalizer-csv.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const CSV_BASE = path.join(
    __dirname,
    '..',
    'utils',
    'pptx_generator',
    'vietnormalizer',
    'vietnormalizer',
    'data',
);

function parseCsv(filePath: string): Array<{ original: string; replacement: string }> {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    // Skip header
    const entries: Array<{ original: string; replacement: string }> = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        // Split only on first comma (value may contain commas)
        const commaIdx = line.indexOf(',');
        if (commaIdx === -1) continue;
        const original = line.substring(0, commaIdx).trim();
        const replacement = line.substring(commaIdx + 1).trim();
        if (original && replacement) {
            entries.push({ original, replacement });
        }
    }
    return entries;
}

async function main() {
    console.log('📖 Importing vietnormalizer CSV dictionaries into DB...');
    console.log(`   CSV path: ${CSV_BASE}`);

    // 1. Clear existing system entries (fresh import)
    const deleted = await prisma.tTSDictionary.deleteMany({
        where: { scope: 'system', userId: null },
    });
    console.log(`   🗑️  Cleared ${deleted.count} existing system entries`);

    // 2. Parse CSV files
    const acronymsFile = path.join(CSV_BASE, 'acronyms.csv');
    const wordsFile = path.join(CSV_BASE, 'non-vietnamese-words.csv');

    const acronyms = parseCsv(acronymsFile);
    const words = parseCsv(wordsFile);

    console.log(`   📄 Parsed: ${acronyms.length} acronyms, ${words.length} words`);

    // 3. Batch insert acronyms
    let created = 0;
    const BATCH_SIZE = 500;

    // Insert acronyms
    for (let i = 0; i < acronyms.length; i += BATCH_SIZE) {
        const batch = acronyms.slice(i, i + BATCH_SIZE);
        await prisma.tTSDictionary.createMany({
            data: batch.map((e) => ({
                type: 'acronym',
                original: e.original,
                replacement: e.replacement,
                scope: 'system',
                userId: null,
            })),
            skipDuplicates: true,
        });
        created += batch.length;
    }
    console.log(`   ✅ Acronyms inserted: ${acronyms.length}`);

    // Insert words in batches
    for (let i = 0; i < words.length; i += BATCH_SIZE) {
        const batch = words.slice(i, i + BATCH_SIZE);
        await prisma.tTSDictionary.createMany({
            data: batch.map((e) => ({
                type: 'word',
                original: e.original,
                replacement: e.replacement,
                scope: 'system',
                userId: null,
            })),
            skipDuplicates: true,
        });
        created += batch.length;
        if ((i + BATCH_SIZE) % 5000 === 0 || i + BATCH_SIZE >= words.length) {
            console.log(`   📝 Words progress: ${Math.min(i + BATCH_SIZE, words.length)}/${words.length}`);
        }
    }

    const total = await prisma.tTSDictionary.count({ where: { scope: 'system' } });
    console.log(`\n✅ Import complete! Total system entries in DB: ${total}`);
}

main()
    .catch((e) => {
        console.error('❌ Import failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
