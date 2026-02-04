import { Module } from '@nestjs/common';
import { PptxController } from './pptx.controller';
import { PptxService } from './pptx.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SlideDataModule } from '../slide-data/slide-data.module';
import { PromptsModule } from '../prompts/prompts.module';
import { ModelConfigModule } from '../model-config/model-config.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AIModule } from '../ai/ai.module';

@Module({
    imports: [
        PrismaModule,
        SlideDataModule,
        PromptsModule,
        ModelConfigModule,
        ApiKeysModule,
        AIModule,
    ],
    controllers: [PptxController],
    providers: [PptxService],
    exports: [PptxService],
})
export class PptxModule { }

