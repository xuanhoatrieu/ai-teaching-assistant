import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { PromptsService } from './prompts/prompts.service';
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
}
bootstrap();
