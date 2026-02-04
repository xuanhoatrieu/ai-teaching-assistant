import { Module } from '@nestjs/common';
import { SlidesService } from './slides.service';
import { SlidesController } from './slides.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { ModelConfigModule } from '../model-config/model-config.module';
import { SlideDataModule } from '../slide-data/slide-data.module';
import { PromptsModule } from '../prompts/prompts.module';
import { AIModule } from '../ai/ai.module';

@Module({
    imports: [PrismaModule, ApiKeysModule, ModelConfigModule, SlideDataModule, PromptsModule, AIModule],
    controllers: [SlidesController],
    providers: [SlidesService],
    exports: [SlidesService],
})
export class SlidesModule { }


