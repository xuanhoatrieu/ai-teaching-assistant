import { Module } from '@nestjs/common';
import { QuestionBankService } from './question-bank.service';
import { QuestionBankController } from './question-bank.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { ModelConfigModule } from '../model-config/model-config.module';
import { PromptsModule } from '../prompts/prompts.module';
import { AIModule } from '../ai/ai.module';

@Module({
    imports: [PrismaModule, ApiKeysModule, ModelConfigModule, PromptsModule, AIModule],
    controllers: [QuestionBankController],
    providers: [QuestionBankService],
    exports: [QuestionBankService],
})
export class QuestionBankModule { }


