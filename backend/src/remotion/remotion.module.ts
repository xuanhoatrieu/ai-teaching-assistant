import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ModelConfigModule } from '../model-config/model-config.module';
import { AIModule } from '../ai/ai.module';
import { TTSModule } from '../tts/tts.module';
import { FileStorageModule } from '../file-storage/file-storage.module';
import { RemotionController } from './remotion.controller';
import { RemotionService } from './remotion.service';
import { RemotionRenderService } from './remotion-render.service';

@Module({
  imports: [
    PrismaModule,
    ModelConfigModule,
    AIModule,
    TTSModule,
    FileStorageModule,
  ],
  controllers: [RemotionController],
  providers: [RemotionService, RemotionRenderService],
  exports: [RemotionService, RemotionRenderService],
})
export class RemotionModule {}
