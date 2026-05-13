#!/usr/bin/env node
/**
 * Seed admin configs into system_configs table.
 * This script runs after `prisma db push` during Docker startup.
 * Uses upsert to safely add missing configs without overwriting existing data.
 */
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

async function seedConfigs() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    console.log('🔧 Seeding admin configs...');

    // ViTTS admin config
    const vittsConfigs = [
      { key: 'vitts.enabled', value: 'true' },
      { key: 'vitts.baseUrl', value: 'http://117.0.36.6:8888' },
      { key: 'vitts.apiKey', value: 'vneu_SqSvHWYLuHEc9cp4kRNYAxOUv73J39vXG8ywp6igQRo' },
      { key: 'vitts.defaultVoice', value: 'vitts:design' },
      { key: 'vitts.designInstruct', value: 'male, middle-aged' },
    ];

    for (const config of vittsConfigs) {
      await prisma.systemConfig.upsert({
        where: { key: config.key },
        update: {}, // Don't overwrite if already exists
        create: config,
      });
    }
    console.log('  ✅ ViTTS admin config');

    // CLIProxy default image model
    await prisma.systemConfig.upsert({
      where: { key: 'cliproxy.defaultImageModel' },
      update: { value: 'gpt-image-2' },
      create: { key: 'cliproxy.defaultImageModel', value: 'gpt-image-2' },
    });
    console.log('  ✅ CLIProxy defaultImageModel = gpt-image-2');

    // CLIProxy URL (force update to correct IP)
    await prisma.systemConfig.upsert({
      where: { key: 'cliproxy.url' },
      update: { value: 'http://152.67.112.145:8317' },
      create: { key: 'cliproxy.url', value: 'http://152.67.112.145:8317' },
    });
    console.log('  ✅ CLIProxy URL = http://152.67.112.145:8317');

    console.log('🎉 Admin configs seeded successfully!');
  } catch (error) {
    console.error('⚠️ Seed configs warning:', error.message);
    // Don't crash the container if seed fails
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

seedConfigs();
