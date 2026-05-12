import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { VideoGenController } from './video-gen.controller';
import { VideoGenService } from './video-gen.service';
import { VideoGenProcessor } from './video-gen.processor';
import { VideoGenGateway } from './video-gen.gateway';

@Module({
  imports: [
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
