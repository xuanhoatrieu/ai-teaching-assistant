import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AIModule } from '../ai/ai.module';
import { PromptsModule } from '../prompts/prompts.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { ModelConfigModule } from '../model-config/model-config.module';
import { GenerationJobModule } from '../generation-job/generation-job.module';
import { InteractiveQuestionService } from './interactive-question.service';
import { ReviewQuestionService } from './review-question.service';
import { EnglishQuestionService } from './english-question.service';
import { ExamSetService } from './exam-set.service';
import { QuestionsController } from './questions.controller';
import { ExamSetController } from './exam-set.controller';

@Module({
    imports: [PrismaModule, AIModule, PromptsModule, ApiKeysModule, ModelConfigModule, GenerationJobModule],
    controllers: [QuestionsController, ExamSetController],
    providers: [InteractiveQuestionService, ReviewQuestionService, EnglishQuestionService, ExamSetService],
    exports: [InteractiveQuestionService, ReviewQuestionService, EnglishQuestionService, ExamSetService],
})
export class QuestionsModule { }

