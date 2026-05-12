import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { RedisModule } from '@nestjs-modules/ioredis';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { ModelConfigModule } from '../model-config/model-config.module';
import { VideoGenController } from './video-gen.controller';
import { VideoGenService } from './video-gen.service';
import { VideoGenProcessor } from './video-gen.processor';
import { VideoGenGateway } from './video-gen.gateway';
import { TTSModule } from '../tts/tts.module';
import { FileStorageModule } from '../file-storage/file-storage.module';

@Module({
  imports: [
    PrismaModule,
    SettingsModule,
    ApiKeysModule,
    ModelConfigModule,
    TTSModule,
    FileStorageModule,
    RedisModule.forRoot({
      type: 'single',
      url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`,
    }),
    BullModule.registerQueue({
      name: 'video-gen',
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: true,
      },
    }),
  ],
  controllers: [VideoGenController],
  providers: [VideoGenService, VideoGenProcessor, VideoGenGateway],
  exports: [VideoGenService],
})
export class VideoGenModule {}

