import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { ModelConfigService } from '../model-config/model-config.service';
import { SlideDataService } from '../slide-data/slide-data.service';
import { PromptComposerService } from '../prompts/prompt-composer.service';
import { FidelityValidatorService } from '../prompts/fidelity-validator.service';
import { AiProviderService } from '../ai/ai-provider.service';
import { Lesson } from '@prisma/client';

export interface GenerateSlideResult {
    content: string;
    coveragePercent: number;
    warnings: string[];
}

@Injectable()
export class SlidesService {
    private readonly logger = new Logger(SlidesService.name);

    constructor(
        private prisma: PrismaService,
        private apiKeysService: ApiKeysService,
        private modelConfigService: ModelConfigService,
        private slideDataService: SlideDataService,
        private promptComposer: PromptComposerService,
        private fidelityValidator: FidelityValidatorService,
        private aiProvider: AiProviderService,
    ) { }
    // Get all Slide entities from database (for Step 5)
    async getSlides(lessonId: string) {
        const slides = await this.prisma.slide.findMany({
            where: { lessonId },
            orderBy: { slideIndex: 'asc' },
        });

        this.logger.log(`[getSlides] lessonId: ${lessonId} -> Found ${slides.length} slides`);
        return slides;
    }

    // Get slide script data
    async getSlideScriptData(lessonId: string): Promise<{
        slideScript: string | null;
        detailedOutline: string | null;
        currentStep: number;
        title: string;
    }> {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
            select: {
                title: true,
                detailedOutline: true,
                slideScript: true,
                currentStep: true,
            },
        });

        if (!lesson) {
            throw new NotFoundException(`Lesson ${lessonId} not found`);
        }

        return {
            title: lesson.title,
            detailedOutline: lesson.detailedOutline,
            slideScript: lesson.slideScript,
            currentStep: lesson.currentStep,
        };
    }

    // Generate slide script using Gemini (Step 3)
    async generateSlideScript(lessonId: string, userId: string): Promise<GenerateSlideResult> {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
            include: { subject: true },
        });

        if (!lesson) {
            throw new NotFoundException(`Lesson ${lessonId} not found`);
        }

        if (!lesson.detailedOutline) {
            throw new BadRequestException('Detailed outline is required before generating slide script');
        }

        // Get API key
        const apiKey = await this.apiKeysService.getActiveKey(userId, 'GEMINI');
        if (!apiKey) {
            throw new BadRequestException('Gemini API key not configured. Please add it in Settings.');
        }

        // Get configured model for SLIDES task
        const modelConfig = await this.modelConfigService.getModelForTask(userId, 'SLIDES');

        // Build prompt using PromptComposer (Role + Task)
        const prompt = await this.promptComposer.buildFullPrompt(
            lesson.subjectId,
            'slides.script',
            {
                title: lesson.title,
                detailed_outline: lesson.detailedOutline,
            },
        );

        this.logger.debug(`Generated prompt for slides (${prompt.length} chars)`);

        // Use AiProviderService (CLIProxy → Gemini SDK fallback)
        const aiResult = await this.aiProvider.generateText(prompt, modelConfig.modelName, apiKey);
        const result = aiResult.content;
        this.logger.log(`Slides generated via ${aiResult.provider} (${aiResult.model})`);

        // Validate coverage: check if all outline sections are covered
        const validation = this.fidelityValidator.validateSlides(lesson.detailedOutline, result);
        this.logger.debug(`Slides coverage: ${validation.coveragePercent}%, missing: ${validation.missingSections.length}`);

        // Save result to lesson.slideScript (backward compatibility)
        await this.prisma.lesson.update({
            where: { id: lessonId },
            data: {
                slideScript: result,
                currentStep: 3,
            },
        });

        // Auto-parse into structured Slide records
        let parseSuccessful = false;
        let slidesCount = 0;
        try {
            this.logger.log(`Attempting to parse slides for lesson ${lessonId}...`);
            this.logger.debug(`Slide script length: ${result.length} chars`);
            this.logger.debug(`Slide script preview: ${result.substring(0, 300)}`);
            const parsedSlides = await this.slideDataService.parseAndSaveSlides(lessonId, result);
            slidesCount = parsedSlides.length;
            parseSuccessful = true;
            this.logger.log(`✅ Successfully parsed and saved ${slidesCount} slides for lesson ${lessonId}`);
        } catch (parseError) {
            this.logger.error(`❌ Failed to parse slides for lesson ${lessonId}`);
            this.logger.error(`Error: ${parseError.message}`);
            this.logger.error(`Stack: ${parseError.stack}`);
            this.logger.error(`Slide script (first 1000 chars): ${result.substring(0, 1000)}...`);
            // Add warning to response so frontend knows
            validation.warnings.push(`Slide parsing failed: ${parseError.message}. Slides not saved to database.`);
        }

        return {
            content: result,
            coveragePercent: validation.coveragePercent,
            warnings: validation.warnings,
        };
    }

    // Update slide script after user edit
    async updateSlideScript(lessonId: string, slideScript: string): Promise<Lesson> {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
        });

        if (!lesson) {
            throw new NotFoundException(`Lesson ${lessonId} not found`);
        }

        // Update the slideScript field
        const updatedLesson = await this.prisma.lesson.update({
            where: { id: lessonId },
            data: { slideScript },
        });

        // Check if slides already have AI-generated content
        const existingSlides = await this.prisma.slide.findMany({
            where: { lessonId },
            select: { optimizedContentJson: true, imageUrl: true },
        });

        const hasAIContent = existingSlides.some(
            s => s.optimizedContentJson !== null || s.imageUrl !== null
        );

        if (hasAIContent) {
            // SKIP re-parsing if slides already have AI-generated content
            // This preserves Step 5 PPTX generation data
            this.logger.log(`⏭️ Skipping slide re-parse for lesson ${lessonId} - AI content already exists (${existingSlides.length} slides with optimizedContentJson or imageUrl)`);
        } else {
            // No AI content yet, safe to sync to Slide table
            try {
                const parsedSlides = await this.slideDataService.parseAndSaveSlides(lessonId, slideScript);
                this.logger.log(`✅ Synced ${parsedSlides.length} slides to Slide table for lesson ${lessonId}`);
            } catch (parseError) {
                this.logger.warn(`⚠️ Failed to sync slides to database: ${parseError.message}`);
                // Don't throw - still return the updated lesson
            }
        }

        return updatedLesson;
    }

    /**
     * Regenerate optimized content for a single slide
     */
    async regenerateSlideContent(lessonId: string, slideIndex: number, userId: string) {
        const slide = await this.prisma.slide.findFirst({
            where: { lessonId, slideIndex },
            include: { lesson: { include: { subject: true } } },
        });

        if (!slide) {
            throw new NotFoundException(`Slide ${slideIndex} not found for lesson ${lessonId}`);
        }

        // Get API key
        const apiKey = await this.apiKeysService.getActiveKey(userId, 'GEMINI');
        if (!apiKey) {
            throw new BadRequestException('Gemini API key not configured');
        }

        const modelConfig = await this.modelConfigService.getModelForTask(userId, 'SLIDES');

        // Build prompt for content optimization
        const prompt = await this.promptComposer.buildFullPrompt(
            slide.lesson.subjectId,
            'slides.optimize_content',
            {
                title: slide.title,
                content: slide.content || '',
                lesson_title: slide.lesson.title,
            },
        );

        // Use AiProviderService for content optimization
        const aiResult = await this.aiProvider.generateText(prompt, modelConfig.modelName, apiKey);
        const result = aiResult.content;

        // Parse JSON result
        let optimizedContent;
        try {
            // Try to extract JSON from response
            const jsonMatch = result.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                optimizedContent = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('No JSON array found in response');
            }
        } catch {
            this.logger.warn('Failed to parse optimized content JSON, using raw bullets');
            optimizedContent = slide.content?.split('\n').filter(b => b.trim()).map(b => ({
                emoji: '📌',
                point: b.replace(/^[-•*]\s*/, ''),
                description: '',
            })) || [];
        }

        // Update slide
        const updated = await this.prisma.slide.update({
            where: { id: slide.id },
            data: {
                optimizedContentJson: JSON.stringify(optimizedContent),
            },
        });

        return {
            ...updated,
            optimizedContentJson: optimizedContent,
        };
    }

    /**
     * Regenerate AI image for a single slide
     */
    async regenerateSlideImage(lessonId: string, slideIndex: number, userId: string) {
        const slide = await this.prisma.slide.findFirst({
            where: { lessonId, slideIndex },
            include: { lesson: true },
        });

        if (!slide) {
            throw new NotFoundException(`Slide ${slideIndex} not found for lesson ${lessonId}`);
        }

        // Get API key for image generation
        const apiKey = await this.apiKeysService.getActiveKey(userId, 'GEMINI');
        if (!apiKey) {
            throw new BadRequestException('Gemini API key not configured');
        }

        const modelConfig = await this.modelConfigService.getModelForTask(userId, 'IMAGE');

        // Build image prompt
        const prompt = await this.promptComposer.buildFullPrompt(
            slide.lesson.subjectId,
            'slides.image_prompt',
            {
                title: slide.title,
                content: slide.content || '',
                lesson_title: slide.lesson.title,
            },
        );

        try {
            // Note: Full image generation requires ImageGeneratorService integration
            // For text-based image prompt generation, use aiProvider
            const aiResult = await this.aiProvider.generateText(prompt, modelConfig.modelName, apiKey);
            this.logger.log(`Generated image prompt response for slide ${slideIndex} via ${aiResult.provider}`);

            // This is a placeholder that will be enhanced with actual image generation
            return {
                ...slide,
                imageUrl: slide.imageUrl, // Keep existing for now
                message: 'Image regeneration requires ImageGeneratorService integration',
            };
        } catch (error) {
            this.logger.error(`Failed to regenerate image for slide ${slideIndex}: ${error.message}`);
            throw new BadRequestException(`Failed to regenerate image: ${error.message}`);
        }
    }
}

