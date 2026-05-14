import { Module, forwardRef } from '@nestjs/common';
import { SlideAudioService } from './slide-audio.service';
import { SlideAudioController } from './slide-audio.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { TTSModule } from '../tts/tts.module';
import { ModelConfigModule } from '../model-config/model-config.module';
import { SlidesModule } from '../slides/slides.module';
import { GenerationJobModule } from '../generation-job/generation-job.module';

@Module({
    imports: [PrismaModule, TTSModule, ModelConfigModule, forwardRef(() => SlidesModule), GenerationJobModule],
    controllers: [SlideAudioController],
    providers: [SlideAudioService],
    exports: [SlideAudioService],
})
export class SlideAudioModule { }
