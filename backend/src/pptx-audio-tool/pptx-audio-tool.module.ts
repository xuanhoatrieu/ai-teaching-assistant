import { Module } from '@nestjs/common';
import { PptxAudioToolController } from './pptx-audio-tool.controller';
import { PptxAudioToolService } from './pptx-audio-tool.service';
import { PrismaModule } from '../prisma/prisma.module';
import { TTSModule } from '../tts/tts.module';
import { ModelConfigModule } from '../model-config/model-config.module';
import { AIModule } from '../ai/ai.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';

@Module({
    imports: [PrismaModule, TTSModule, ModelConfigModule, AIModule, ApiKeysModule],
    controllers: [PptxAudioToolController],
    providers: [PptxAudioToolService],
})
export class PptxAudioToolModule {}
