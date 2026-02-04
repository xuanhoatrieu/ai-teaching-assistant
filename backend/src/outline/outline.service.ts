import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { ModelConfigService } from '../model-config/model-config.service';
import { PromptComposerService } from '../prompts/prompt-composer.service';
import { FidelityValidatorService } from '../prompts/fidelity-validator.service';
import { AiProviderService } from '../ai/ai-provider.service';
import { Lesson } from '@prisma/client';

export interface GenerateOutlineResult {
    content: string;
    coveragePercent: number;
    warnings: string[];
}

@Injectable()
export class OutlineService {
    private readonly logger = new Logger(OutlineService.name);

    constructor(
        private prisma: PrismaService,
        private apiKeysService: ApiKeysService,
        private modelConfigService: ModelConfigService,
        private promptComposer: PromptComposerService,
        private fidelityValidator: FidelityValidatorService,
        private aiProvider: AiProviderService,
    ) { }

    // Get lesson with outline data
    async getOutlineData(lessonId: string): Promise<{
        rawOutline: string | null;
        detailedOutline: string | null;
        currentStep: number;
        title: string;
    }> {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
            select: {
                title: true,
                outlineRaw: true,
                detailedOutline: true,
                currentStep: true,
            },
        });

        if (!lesson) {
            throw new NotFoundException(`Lesson ${lessonId} not found`);
        }

        return {
            title: lesson.title,
            rawOutline: lesson.outlineRaw,
            detailedOutline: lesson.detailedOutline,
            currentStep: lesson.currentStep,
        };
    }

    // Save raw outline (Step 1)
    async saveRawOutline(lessonId: string, rawOutline: string): Promise<Lesson> {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
        });

        if (!lesson) {
            throw new NotFoundException(`Lesson ${lessonId} not found`);
        }

        return this.prisma.lesson.update({
            where: { id: lessonId },
            data: {
                outlineRaw: rawOutline,
                currentStep: 1,
            },
        });
    }

    // Generate detailed outline using Gemini (Step 2)
    async generateDetailedOutline(lessonId: string, userId: string): Promise<GenerateOutlineResult> {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
            include: { subject: true },
        });

        if (!lesson) {
            throw new NotFoundException(`Lesson ${lessonId} not found`);
        }

        if (!lesson.outlineRaw) {
            throw new BadRequestException('Raw outline is required before generating detailed outline');
        }

        // Get API key
        const apiKey = await this.apiKeysService.getActiveKey(userId, 'GEMINI');
        if (!apiKey) {
            throw new BadRequestException('Gemini API key not configured. Please add it in Settings.');
        }

        // Get configured model for OUTLINE task
        const modelConfig = await this.modelConfigService.getModelForTask(userId, 'OUTLINE');

        // Build prompt using PromptComposer (Role + Task)
        const prompt = await this.promptComposer.buildFullPrompt(
            lesson.subjectId,
            'outline.detailed',
            {
                title: lesson.title,
                raw_outline: lesson.outlineRaw,
            },
        );

        this.logger.debug(`Generated prompt for outline (${prompt.length} chars)`);

        // Use AiProviderService (CLIProxy → Gemini SDK fallback)
        const aiResult = await this.aiProvider.generateText(prompt, modelConfig.modelName, apiKey);
        const result = aiResult.content;
        this.logger.log(`Outline generated via ${aiResult.provider} (${aiResult.model})`);

        // Validate coverage: check if all input sections are covered
        const validation = this.fidelityValidator.validateOutline(lesson.outlineRaw, result);
        this.logger.debug(`Outline coverage: ${validation.coveragePercent}%, missing: ${validation.missingSections.length}`);

        // Save result
        await this.prisma.lesson.update({
            where: { id: lessonId },
            data: {
                detailedOutline: result,
                currentStep: 2,
            },
        });

        return {
            content: result,
            coveragePercent: validation.coveragePercent,
            warnings: validation.warnings,
        };
    }

    // Update detailed outline after user edit
    async updateDetailedOutline(lessonId: string, detailedOutline: string): Promise<Lesson> {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
        });

        if (!lesson) {
            throw new NotFoundException(`Lesson ${lessonId} not found`);
        }

        return this.prisma.lesson.update({
            where: { id: lessonId },
            data: { detailedOutline },
        });
    }
}
