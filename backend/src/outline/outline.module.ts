import { Module } from '@nestjs/common';
import { OutlineService } from './outline.service';
import { OutlineController } from './outline.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { ModelConfigModule } from '../model-config/model-config.module';
import { PromptsModule } from '../prompts/prompts.module';
import { AIModule } from '../ai/ai.module';

@Module({
    imports: [PrismaModule, ApiKeysModule, ModelConfigModule, PromptsModule, AIModule],
    controllers: [OutlineController],
    providers: [OutlineService],
    exports: [OutlineService],
})
export class OutlineModule { }


