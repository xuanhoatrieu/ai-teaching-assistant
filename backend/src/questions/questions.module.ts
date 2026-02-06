import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AIModule } from '../ai/ai.module';
import { PromptsModule } from '../prompts/prompts.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { ModelConfigModule } from '../model-config/model-config.module';
import { InteractiveQuestionService } from './interactive-question.service';
import { ReviewQuestionService } from './review-question.service';
import { QuestionsController } from './questions.controller';

@Module({
    imports: [PrismaModule, AIModule, PromptsModule, ApiKeysModule, ModelConfigModule],
    controllers: [QuestionsController],
    providers: [InteractiveQuestionService, ReviewQuestionService],
    exports: [InteractiveQuestionService, ReviewQuestionService],
})
export class QuestionsModule { }

