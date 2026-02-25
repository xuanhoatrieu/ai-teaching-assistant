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

        // Sync speaker notes to existing SlideAudio records (preserve audio files)
        try {
            await this.syncSpeakerNotesToSlideAudios(lessonId, slideScript);
        } catch (syncError) {
            this.logger.warn(`⚠️ Failed to sync speaker notes to SlideAudio: ${syncError.message}`);
        }

        return updatedLesson;
    }

    /**
     * Sync speaker notes from slideScript JSON to existing SlideAudio records.
     * Only updates records where the speaker note has actually changed.
     * Resets audio status to 'pending' for changed notes (audio is outdated).
     * Does NOT delete/recreate records — preserves existing audio files.
     */
    private async syncSpeakerNotesToSlideAudios(lessonId: string, slideScript: string) {
        // Check if SlideAudio records exist for this lesson
        const existingAudios = await this.prisma.slideAudio.findMany({
            where: { lessonId },
            orderBy: { slideIndex: 'asc' },
        });

        if (existingAudios.length === 0) {
            this.logger.debug(`No SlideAudio records for lesson ${lessonId}, skipping sync`);
            return;
        }

        // Parse speaker notes from the new slideScript
        const parsedNotes = this.parseSpeakerNotesFromSlideScript(slideScript);
        if (parsedNotes.length === 0) {
            this.logger.warn(`Could not parse speaker notes from slideScript for lesson ${lessonId}`);
            return;
        }

        let updatedCount = 0;
        for (const audio of existingAudios) {
            // Find matching parsed note by slideIndex
            const parsed = parsedNotes.find(p => p.slideIndex === audio.slideIndex);
            if (!parsed) continue;

            // Only update if the note actually changed
            if (parsed.speakerNote !== audio.speakerNote) {
                await this.prisma.slideAudio.update({
                    where: { id: audio.id },
                    data: {
                        speakerNote: parsed.speakerNote,
                        // Reset status to pending since note changed (audio is now outdated)
                        status: 'pending',
                    },
                });
                updatedCount++;
            }
        }

        if (updatedCount > 0) {
            this.logger.log(`✅ Synced ${updatedCount} speaker notes to SlideAudio for lesson ${lessonId}`);
        }
    }

    /**
     * Parse speaker notes from slideScript JSON string.
     * Returns array of { slideIndex, speakerNote } for matching.
     */
    private parseSpeakerNotesFromSlideScript(slideScript: string): Array<{ slideIndex: number; speakerNote: string }> {
        try {
            // Extract JSON from markdown code block if present
            let jsonStr = slideScript;
            const jsonStartTag = slideScript.indexOf('```json');
            if (jsonStartTag !== -1) {
                const contentStart = jsonStartTag + '```json'.length;
                const lastBackticks = slideScript.lastIndexOf('```');
                if (lastBackticks > contentStart) {
                    jsonStr = slideScript.substring(contentStart, lastBackticks);
                }
            }

            const data = JSON.parse(jsonStr.trim());
            const slidesArray = data.slides || data;

            if (!Array.isArray(slidesArray)) {
                return [];
            }

            return slidesArray
                .filter((s: any) => s.speakerNote !== undefined)
                .map((s: any) => ({
                    slideIndex: s.slideIndex ?? 0,
                    speakerNote: s.speakerNote || '',
                }));
        } catch {
            return [];
        }
    }

    /**
     * Generate speaker notes for all slides using AI (Step 4)
     * Uses the focused 'slides.speaker-notes' prompt with slide content as input.
     */
    async generateSpeakerNotes(lessonId: string, userId: string) {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
            include: { subject: true },
        });

        if (!lesson) {
            throw new NotFoundException(`Lesson ${lessonId} not found`);
        }

        // Get slides from DB (created by Step 3)
        const slides = await this.prisma.slide.findMany({
            where: { lessonId },
            orderBy: { slideIndex: 'asc' },
        });

        if (slides.length === 0) {
            throw new BadRequestException('No slides found. Complete Step 3 first.');
        }

        // Build slides_content string for the prompt
        const slidesContent = slides.map(s => {
            let content = '';
            if (s.content) {
                try {
                    const parsed = JSON.parse(s.content);
                    content = Array.isArray(parsed) ? parsed.join(', ') : s.content;
                } catch {
                    // Content is plain text, not JSON
                    content = s.content;
                }
            }
            return `--- Slide ${s.slideIndex} (${s.slideType}) ---\nTitle: ${s.title}\nContent: ${content}${s.visualIdea ? `\nVisual: ${s.visualIdea}` : ''}`;
        }).join('\n\n');

        // Get API key
        const apiKey = await this.apiKeysService.getActiveKey(userId, 'GEMINI');
        if (!apiKey) {
            throw new BadRequestException('Gemini API key not configured. Please add it in Settings.');
        }

        const modelConfig = await this.modelConfigService.getModelForTask(userId, 'SPEAKER_NOTES');

        // Build prompt using the new focused speaker-notes prompt
        const prompt = await this.promptComposer.buildFullPrompt(
            lesson.subjectId,
            'slides.speaker-notes',
            {
                title: lesson.title,
                slides_content: slidesContent,
            },
        );

        this.logger.debug(`Generated speaker notes prompt (${prompt.length} chars)`);

        // Generate using AI
        const aiResult = await this.aiProvider.generateText(prompt, modelConfig.modelName, apiKey);
        const result = aiResult.content;
        this.logger.log(`Speaker notes generated via ${aiResult.provider} (${aiResult.model})`);

        // Parse JSON response
        let speakerNotes: Array<{ slideIndex: number; speakerNote: string }> = [];
        try {
            let jsonStr = result;
            const jsonStartTag = result.indexOf('```json');
            if (jsonStartTag !== -1) {
                const contentStart = jsonStartTag + '```json'.length;
                const lastBackticks = result.lastIndexOf('```');
                if (lastBackticks > contentStart) {
                    jsonStr = result.substring(contentStart, lastBackticks);
                }
            }

            const data = JSON.parse(jsonStr.trim());
            speakerNotes = data.speakerNotes || data;

            if (!Array.isArray(speakerNotes)) {
                throw new Error('Response is not an array');
            }
        } catch (parseError) {
            this.logger.error(`Failed to parse speaker notes: ${parseError.message}`);
            throw new BadRequestException(`Failed to parse AI response: ${parseError.message}`);
        }

        // Update Slide.speakerNote in DB
        for (const note of speakerNotes) {
            const existingSlide = slides.find(s => s.slideIndex === note.slideIndex);
            if (existingSlide) {
                await this.prisma.slide.update({
                    where: { id: existingSlide.id },
                    data: { speakerNote: note.speakerNote },
                });
            }
        }

        // Also sync speakerNotes into slideScript JSON for backward compat
        if (lesson.slideScript) {
            try {
                let jsonStr = lesson.slideScript;
                const jsonStartTag = lesson.slideScript.indexOf('```json');
                if (jsonStartTag !== -1) {
                    const contentStart = jsonStartTag + '```json'.length;
                    const lastBackticks = lesson.slideScript.lastIndexOf('```');
                    if (lastBackticks > contentStart) {
                        jsonStr = lesson.slideScript.substring(contentStart, lastBackticks);
                    }
                }
                const scriptData = JSON.parse(jsonStr.trim());
                if (scriptData.slides && Array.isArray(scriptData.slides)) {
                    for (const note of speakerNotes) {
                        const slide = scriptData.slides.find((s: any) => s.slideIndex === note.slideIndex);
                        if (slide) {
                            slide.speakerNote = note.speakerNote;
                        }
                    }
                    await this.prisma.lesson.update({
                        where: { id: lessonId },
                        data: { slideScript: JSON.stringify(scriptData, null, 2) },
                    });
                }
            } catch (e) {
                this.logger.warn(`Could not sync speaker notes to slideScript: ${e.message}`);
            }
        }

        // Upsert SlideAudio records
        const slideAudios: any[] = [];
        for (const note of speakerNotes) {
            const existingAudio = await this.prisma.slideAudio.findUnique({
                where: { lessonId_slideIndex: { lessonId, slideIndex: note.slideIndex } },
            });

            if (existingAudio) {
                // Update speaker note, reset status if note changed
                const updated = await this.prisma.slideAudio.update({
                    where: { id: existingAudio.id },
                    data: {
                        speakerNote: note.speakerNote,
                        slideTitle: slides.find(s => s.slideIndex === note.slideIndex)?.title || existingAudio.slideTitle,
                        status: existingAudio.speakerNote !== note.speakerNote ? 'pending' : existingAudio.status,
                    },
                });
                slideAudios.push(updated);
            } else {
                // Create new record
                const created = await this.prisma.slideAudio.create({
                    data: {
                        lessonId,
                        slideIndex: note.slideIndex,
                        slideTitle: slides.find(s => s.slideIndex === note.slideIndex)?.title || `Slide ${note.slideIndex}`,
                        speakerNote: note.speakerNote,
                        status: 'pending',
                    },
                });
                slideAudios.push(created);
            }
        }

        this.logger.log(`✅ Generated ${speakerNotes.length} speaker notes for lesson ${lessonId}`);

        return slideAudios;
    }

    /**
     * Optimize & QA speaker notes (Step 4 - Button 2)
     * - Quality check: word count, idea coverage
     * - Language cleanup: remove figurative/dramatic language
     * - TTS optimization: convert code/symbols to speech
     */
    async optimizeSpeakerNotes(lessonId: string, userId: string) {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
            include: { subject: true },
        });

        if (!lesson) {
            throw new NotFoundException(`Lesson ${lessonId} not found`);
        }

        // Get slides from DB
        const slides = await this.prisma.slide.findMany({
            where: { lessonId },
            orderBy: { slideIndex: 'asc' },
        });

        if (slides.length === 0) {
            throw new BadRequestException('No slides found. Complete Step 3 first.');
        }

        // Check that speaker notes exist
        const slidesWithNotes = slides.filter(s => s.speakerNote?.trim());
        if (slidesWithNotes.length === 0) {
            throw new BadRequestException('No speaker notes found. Generate speaker notes first (Button 1).');
        }

        // Build slides_content string (same as generateSpeakerNotes)
        const slidesContent = slides.map(s => {
            let content = '';
            if (s.content) {
                try {
                    const parsed = JSON.parse(s.content);
                    content = Array.isArray(parsed) ? parsed.join(', ') : s.content;
                } catch {
                    content = s.content;
                }
            }
            return `--- Slide ${s.slideIndex} (${s.slideType}) ---\nTitle: ${s.title}\nContent: ${content}${s.visualIdea ? `\nVisual: ${s.visualIdea}` : ''}`;
        }).join('\n\n');

        // Build speaker_notes string from existing notes
        const speakerNotesContent = slides.map(s => {
            return `--- Slide ${s.slideIndex} ---\n${s.speakerNote || '(chưa có speaker note)'}`;
        }).join('\n\n');

        // Get API key
        const apiKey = await this.apiKeysService.getActiveKey(userId, 'GEMINI');
        if (!apiKey) {
            throw new BadRequestException('Gemini API key not configured. Please add it in Settings.');
        }

        const modelConfig = await this.modelConfigService.getModelForTask(userId, 'SPEAKER_NOTES');

        // Build prompt using the optimize-notes prompt
        const prompt = await this.promptComposer.buildFullPrompt(
            lesson.subjectId,
            'slides.optimize-notes',
            {
                slides_content: slidesContent,
                speaker_notes: speakerNotesContent,
            },
        );

        this.logger.debug(`Generated optimize notes prompt (${prompt.length} chars)`);

        // Generate using AI
        const aiResult = await this.aiProvider.generateText(prompt, modelConfig.modelName, apiKey);
        const result = aiResult.content;
        this.logger.log(`Speaker notes optimized via ${aiResult.provider} (${aiResult.model})`);

        // Parse JSON response (same logic as generateSpeakerNotes)
        let optimizedNotes: Array<{ slideIndex: number; speakerNote: string }> = [];
        try {
            let jsonStr = result;
            const jsonStartTag = result.indexOf('```json');
            if (jsonStartTag !== -1) {
                const contentStart = jsonStartTag + '```json'.length;
                const lastBackticks = result.lastIndexOf('```');
                if (lastBackticks > contentStart) {
                    jsonStr = result.substring(contentStart, lastBackticks);
                }
            }

            const data = JSON.parse(jsonStr.trim());
            optimizedNotes = data.speakerNotes || data;

            if (!Array.isArray(optimizedNotes)) {
                throw new Error('Response is not an array');
            }
        } catch (parseError) {
            this.logger.error(`Failed to parse optimized notes: ${parseError.message}`);
            throw new BadRequestException(`Failed to parse AI response: ${parseError.message}`);
        }

        // Update Slide.speakerNote in DB
        const slideAudios: any[] = [];
        for (const note of optimizedNotes) {
            const existingSlide = slides.find(s => s.slideIndex === note.slideIndex);
            // NOTE: Do NOT update Slide.speakerNote here - keep it as the raw version from Button 1
            // Only update SlideAudio.speakerNote with the optimized version

            // Also update SlideAudio if exists
            const existingAudio = await this.prisma.slideAudio.findFirst({
                where: { lessonId, slideIndex: note.slideIndex },
            });
            if (existingAudio) {
                const updated = await this.prisma.slideAudio.update({
                    where: { id: existingAudio.id },
                    data: {
                        speakerNote: note.speakerNote,
                        status: existingAudio.audioUrl ? 'stale' : 'pending',
                    },
                });
                slideAudios.push(updated);
            } else {
                const created = await this.prisma.slideAudio.create({
                    data: {
                        lessonId,
                        slideIndex: note.slideIndex,
                        slideTitle: existingSlide?.title || `Slide ${note.slideIndex}`,
                        speakerNote: note.speakerNote,
                        status: 'pending',
                    },
                });
                slideAudios.push(created);
            }
        }

        // Also sync into slideScript JSON for backward compat
        if (lesson.slideScript) {
            try {
                let jsonStr = lesson.slideScript;
                const jsonStartTag = lesson.slideScript.indexOf('```json');
                if (jsonStartTag !== -1) {
                    const contentStart = jsonStartTag + '```json'.length;
                    const lastBackticks = lesson.slideScript.lastIndexOf('```');
                    if (lastBackticks > contentStart) {
                        jsonStr = lesson.slideScript.substring(contentStart, lastBackticks);
                    }
                }
                const scriptData = JSON.parse(jsonStr.trim());
                if (scriptData.slides && Array.isArray(scriptData.slides)) {
                    for (const note of optimizedNotes) {
                        const slide = scriptData.slides.find((s: any) => s.slideIndex === note.slideIndex);
                        if (slide) {
                            slide.speakerNote = note.speakerNote;
                        }
                    }
                    await this.prisma.lesson.update({
                        where: { id: lessonId },
                        data: { slideScript: JSON.stringify(scriptData, null, 2) },
                    });
                }
            } catch (e) {
                this.logger.warn(`Could not sync optimized notes to slideScript: ${e.message}`);
            }
        }

        this.logger.log(`✅ Optimized ${optimizedNotes.length} speaker notes for lesson ${lessonId}`);

        return slideAudios;
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

