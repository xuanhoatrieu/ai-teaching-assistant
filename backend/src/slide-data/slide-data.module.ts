import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TTSModule } from '../tts/tts.module';
import { FileStorageModule } from '../file-storage/file-storage.module';
import { AIModule } from '../ai/ai.module';
import { ModelConfigModule } from '../model-config/model-config.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { SlideDataService } from './slide-data.service';
import { SlideDataController } from './slide-data.controller';
import { SlideAudioGeneratorService } from './slide-audio-generator.service';
import { SlideImageGeneratorService } from './slide-image-generator.service';

@Module({
    imports: [PrismaModule, TTSModule, FileStorageModule, AIModule, ModelConfigModule, ApiKeysModule],
    controllers: [SlideDataController],
    providers: [SlideDataService, SlideAudioGeneratorService, SlideImageGeneratorService],
    exports: [SlideDataService, SlideAudioGeneratorService, SlideImageGeneratorService],
})
export class SlideDataModule { }
