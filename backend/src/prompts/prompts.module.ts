import { Module } from '@nestjs/common';
import { PromptsController } from './prompts.controller';
import { PromptsService } from './prompts.service';
import { PromptComposerService } from './prompt-composer.service';
import { FidelityValidatorService } from './fidelity-validator.service';

@Module({
    controllers: [PromptsController],
    providers: [PromptsService, PromptComposerService, FidelityValidatorService],
    exports: [PromptsService, PromptComposerService, FidelityValidatorService],
})
export class PromptsModule { }


