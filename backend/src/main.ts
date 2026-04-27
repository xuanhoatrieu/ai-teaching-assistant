import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { PromptsService } from './prompts/prompts.service';
import { CLIProxyProvider } from './ai/cliproxy.provider';
import { ModelConfigService } from './model-config/model-config.service';
import { join } from 'path';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Serve /uploads as static files (for legacy audio paths)
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads/' });

  // Enable validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Enable CORS for frontend
  app.enableCors();

  await app.listen(process.env.PORT ?? 3001);

  // Auto-seed prompts on startup to keep database in sync with code
  try {
    const promptsService = app.get(PromptsService);
    const result = await promptsService.seedV2();
    logger.log(`✅ Auto-seeded ${result.seeded} prompts on startup`);
  } catch (error) {
    logger.warn(`⚠️ Could not auto-seed prompts: ${error.message}`);
  }

  // Auto-detect CLIProxy models on startup (text, image, TTS) — non-blocking
  try {
    const cliproxy = app.get(CLIProxyProvider);
    const detected = await cliproxy.autoDetectModels();
    const parts: string[] = [];
    if (detected.text) parts.push(`text=${detected.text}`);
    if (detected.image) parts.push(`image=${detected.image}`);
    if (detected.tts) parts.push(`tts=${detected.tts}`);
    if (parts.length > 0) {
      logger.log(`🖼️ Auto-detected CLIProxy models: ${parts.join(', ')}`);
    }
  } catch (error) {
    logger.warn(`⚠️ CLIProxy auto-detect skipped: ${error.message}`);
  }

  // Auto-discover Gemini SDK models on startup — saves best model per category to DB
  // This ensures ImagenService and other services always have up-to-date model names
  try {
    const modelConfigService = app.get(ModelConfigService);
    // Pass sentinel userId — discoverGeminiModels internally calls getActiveKey
    // which falls back to system key when no user key exists
    const models = await modelConfigService.discoverGeminiModels('system-startup');
    const imageModels = models.filter(m => m.supportedTasks.includes('IMAGE'));
    const ttsModels = models.filter(m => m.supportedTasks.includes('TTS'));
    logger.log(`🔍 Gemini SDK discovery: ${models.length} models (${imageModels.length} image, ${ttsModels.length} TTS)`);
  } catch (error) {
    logger.warn(`⚠️ Gemini SDK discovery skipped: ${error.message}`);
  }
}
bootstrap();
