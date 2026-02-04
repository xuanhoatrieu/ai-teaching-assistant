import { Module } from '@nestjs/common';
import { SlideAudioService } from './slide-audio.service';
import { SlideAudioController } from './slide-audio.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { TTSModule } from '../tts/tts.module';
import { ModelConfigModule } from '../model-config/model-config.module';

@Module({
    imports: [PrismaModule, TTSModule, ModelConfigModule],
    controllers: [SlideAudioController],
    providers: [SlideAudioService],
    exports: [SlideAudioService],
})
export class SlideAudioModule { }
