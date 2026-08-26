import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { ModelConfigService } from '../model-config/model-config.service';
import { SlideDataService } from '../slide-data/slide-data.service';
import { PromptComposerService } from '../prompts/prompt-composer.service';
import { FidelityValidatorService } from '../prompts/fidelity-validator.service';
import { AiProviderService } from '../ai/ai-provider.service';
import { SlideImageGeneratorService } from '../slide-data/slide-image-generator.service';
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
        private slideImageGenerator: SlideImageGeneratorService,
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
        const aiResult = await this.aiProvider.generateText(prompt, modelConfig.modelName, userId);
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
     * Helper to clean AI cliché expressions and normalize formatting for spoken lecture
     */
    private cleanAntiAIPhrases(text: string): string {
        if (!text) return '';
        let cleaned = text;

        const replacements: Array<[RegExp, string]> = [
            // AI Clichés & Metaphors
            [/\b(?:hãy\s+cùng\s+(?:tôi|chúng\s+ta)\s+khám\s+phá|bước\s+vào\s+hành\s+trình\s+khám\s+phá)\b/gi, 'bây giờ chúng ta sẽ tìm hiểu'],
            [/\b(?:chào\s+mừng\s+(?:các\s+bạn|quý\s+vị|mọi\s+người)\s+đến\s+với\s+slide\s+(?:tiếp\s+theo|này))\b[,\.\:\s]*/gi, ''],
            [/\b(?:cung\s+cấp\s+(?:một\s+)?cái\s+nhìn\s+sâu\s+sắc|mang\s+lại\s+cái\s+nhìn\s+toàn\s+diện)\b/gi, 'giúp chúng ta hiểu rõ'],
            [/\b(?:chiếc\s+)?chìa\s+khóa\s+vàng\b/gi, 'yếu tố then chốt'],
            [/\b(?:vũ\s+khí\s+đắc\s+lực|công\s+cụ\s+vạn\s+năng)\b/gi, 'công cụ hiệu quả'],
            [/\b(?:bức\s+tranh\s+toàn\s+cảnh|bức\s+tranh\s+tổng\s+thể)\b/gi, 'tổng quan toàn bộ'],
            [/\b(?:đóng\s+vai\s+trò\s+(?:vô\s+cùng|hết\s+sức|cực\s+kỳ)\s+(?:quan\s+trọng|then\s+chốt|quan\s+yếu))\b/gi, 'rất quan trọng'],
            [/\b(?:không\s+chỉ\s+dừng\s+lại\s+ở\s+đó|chưa\s+dừng\s+lại\s+ở\s+đó)[,\s]*/gi, 'Bên cạnh đó, '],
            [/\b(?:mở\s+ra\s+(?:một\s+)?cánh\s+cửa|mở\s+ra\s+chân\s+trời\s+mới)\b/gi, 'tạo điều kiện'],
            [/\b(?:vô\s+cùng\s+thú\s+vị|hết\s+sức\s+tuyệt\s+vời|đầy\s+hứa\s+hẹn)\b/gi, 'đáng chú ý'],
            [/\b(?:như\s+chúng\s+ta\s+đã\s+biết|như\s+ai\s+cũng\s+biết)[,\s]*/gi, ''],
            [/\b(?:trải\s+nghiệm\s+tuyệt\s+vời|sức\s+mạnh\s+kỳ\s+diệu)\b/gi, 'hiệu quả thực tế'],
            [/\b(?:kinh\s+điển)\b/gi, 'thường gặp'],
            [/\b(?:chí\s+mạng)\b/gi, 'lớn'],
            [/\b(?:vô\s+cùng|hết\s+sức|cực\s+kỳ)\s+/gi, ''],
        ];

        for (const [pattern, replacement] of replacements) {
            cleaned = cleaned.replace(pattern, replacement);
        }

        // Clean Markdown markers and bracketed slide tags that degrade TTS
        cleaned = cleaned
            .replace(/[*#_~`]/g, '')
            .replace(/\[\s*slide\s*\d+\s*\]/gi, '')
            .replace(/\s{2,}/g, ' ')
            .trim();

        return cleaned;
    }

    /**
     * Helper to safely parse AI speaker notes JSON response for a batch
     */
    private parseSpeakerNotesJSON(
        rawResult: string,
        fallbackSlides: Array<{ slideIndex: number; title: string; content?: string | null }>,
    ): Array<{ slideIndex: number; speakerNote: string }> {
        let speakerNotes: Array<{ slideIndex: number; speakerNote: string }> = [];
        try {
            let jsonStr = rawResult;
            const jsonStartTag = rawResult.indexOf('```json');
            if (jsonStartTag !== -1) {
                const contentStart = jsonStartTag + '```json'.length;
                const lastBackticks = rawResult.lastIndexOf('```');
                if (lastBackticks > contentStart) {
                    jsonStr = rawResult.substring(contentStart, lastBackticks);
                }
            } else {
                const firstOpenBrace = rawResult.indexOf('{');
                const lastCloseBrace = rawResult.lastIndexOf('}');
                if (firstOpenBrace !== -1 && lastCloseBrace > firstOpenBrace) {
                    jsonStr = rawResult.substring(firstOpenBrace, lastCloseBrace + 1);
                }
            }

            const data = JSON.parse(jsonStr.trim());
            const parsedArray = Array.isArray(data) ? data : (data.speakerNotes || data.slides || []);
            if (Array.isArray(parsedArray) && parsedArray.length > 0) {
                speakerNotes = parsedArray.map((item: any, idx: number) => ({
                    slideIndex: item.slideIndex !== undefined ? Number(item.slideIndex) : (fallbackSlides[idx]?.slideIndex ?? (idx + 1)),
                    speakerNote: this.cleanAntiAIPhrases(item.speakerNote || item.note || item.content || ''),
                })).filter(n => n.speakerNote.trim().length > 0);
            }
        } catch (e) {
            this.logger.warn(`Failed to parse batch speaker notes JSON: ${e.message}. Raw snippet: ${rawResult.substring(0, 200)}...`);
        }

        // Fill in missing slides with safe fallback if any slide was skipped
        for (const slide of fallbackSlides) {
            if (!speakerNotes.some(n => n.slideIndex === slide.slideIndex)) {
                speakerNotes.push({
                    slideIndex: slide.slideIndex,
                    speakerNote: this.cleanAntiAIPhrases(slide.content || `Nội dung slide ${slide.slideIndex}: ${slide.title}`),
                });
            }
        }

        return speakerNotes;
    }

    /**
     * Generate speaker notes for all slides using AI (Step 4 - Button 1)
     * Uses slide chunking (micro-batches of 4 slides) for uniform high quality,
     * rolling narrative continuity, and anti-AI pedagogical voice.
     */
    async generateSpeakerNotes(
        lessonId: string,
        userId: string,
        onProgress?: (percent: number, message: string) => Promise<void>,
    ) {
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

        const modelConfig = await this.modelConfigService.getModelForTask(userId, 'SPEAKER_NOTES');
        const BATCH_SIZE = 4;
        const allSpeakerNotes: Array<{ slideIndex: number; speakerNote: string }> = [];
        let previousSlideBridge = '';

        this.logger.log(`Generating speaker notes for ${slides.length} slides in batches of ${BATCH_SIZE} using model ${modelConfig.modelName}`);

        for (let i = 0; i < slides.length; i += BATCH_SIZE) {
            const batch = slides.slice(i, i + BATCH_SIZE);
            const batchStartIndex = i + 1;
            const batchEndIndex = Math.min(i + BATCH_SIZE, slides.length);

            if (onProgress) {
                const percent = Math.round((i / slides.length) * 100);
                await onProgress(percent, `Đang tạo lời giảng (Slide ${batchStartIndex} - ${batchEndIndex} / ${slides.length})...`);
            }

            // Build slides_content string for this specific batch
            const slidesContent = batch.map(s => {
                let content = '';
                if (s.content) {
                    try {
                        const parsed = JSON.parse(s.content);
                        content = Array.isArray(parsed) ? parsed.join(', ') : s.content;
                    } catch {
                        content = s.content;
                    }
                }
                return `--- Slide ${s.slideIndex} (${s.slideType}) ---\nTitle: ${s.title}\nContent: ${content}${s.visualIdea ? `\nVisual Idea: ${s.visualIdea}` : ''}`;
            }).join('\n\n');

            const promptContent = previousSlideBridge
                ? `[Ý chính slide trước để nối mạch tự nhiên: "${previousSlideBridge}"]\n\n${slidesContent}`
                : slidesContent;

            // Build prompt
            const prompt = await this.promptComposer.buildFullPrompt(
                lesson.subjectId,
                'slides.speaker-notes',
                {
                    title: lesson.title,
                    slides_content: promptContent,
                },
            );

            // Generate using AI
            const aiResult = await this.aiProvider.generateText(prompt, modelConfig.modelName, userId);
            const batchNotes = this.parseSpeakerNotesJSON(aiResult.content, batch);
            allSpeakerNotes.push(...batchNotes);

            // Update rolling narrative bridge
            if (batchNotes.length > 0) {
                const lastNote = batchNotes[batchNotes.length - 1];
                previousSlideBridge = lastNote.speakerNote.substring(0, 140);
            }
        }

        if (onProgress) {
            await onProgress(95, 'Đang lưu trữ lời giảng...');
        }

        // Update Slide.speakerNote in DB
        for (const note of allSpeakerNotes) {
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
                    for (const note of allSpeakerNotes) {
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
        for (const note of allSpeakerNotes) {
            const existingAudio = await this.prisma.slideAudio.findUnique({
                where: { lessonId_slideIndex: { lessonId, slideIndex: note.slideIndex } },
            });

            if (existingAudio) {
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

        this.logger.log(`✅ Generated ${allSpeakerNotes.length} speaker notes for lesson ${lessonId}`);

        return slideAudios;
    }

    /**
     * Optimize & QA speaker notes (Step 4 - Button 2)
     * Micro-batch processing for spoken rhythm, TTS pauses, and anti-AI phrase sanitization.
     */
    async optimizeSpeakerNotes(
        lessonId: string,
        userId: string,
        onProgress?: (percent: number, message: string) => Promise<void>,
    ) {
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

        const modelConfig = await this.modelConfigService.getModelForTask(userId, 'SPEAKER_NOTES');
        const BATCH_SIZE = 4;
        const allOptimizedNotes: Array<{ slideIndex: number; speakerNote: string }> = [];

        this.logger.log(`Optimizing speaker notes for ${slides.length} slides in batches of ${BATCH_SIZE} using model ${modelConfig.modelName}`);

        for (let i = 0; i < slides.length; i += BATCH_SIZE) {
            const batch = slides.slice(i, i + BATCH_SIZE);
            const batchStartIndex = i + 1;
            const batchEndIndex = Math.min(i + BATCH_SIZE, slides.length);

            if (onProgress) {
                const percent = Math.round((i / slides.length) * 100);
                await onProgress(percent, `Đang tối ưu lời giảng (Slide ${batchStartIndex} - ${batchEndIndex} / ${slides.length})...`);
            }

            // Build slides_content string for this batch
            const slidesContent = batch.map(s => {
                let content = '';
                if (s.content) {
                    try {
                        const parsed = JSON.parse(s.content);
                        content = Array.isArray(parsed) ? parsed.join(', ') : s.content;
                    } catch {
                        content = s.content;
                    }
                }
                return `--- Slide ${s.slideIndex} (${s.slideType}) ---\nTitle: ${s.title}\nContent: ${content}${s.visualIdea ? `\nVisual Idea: ${s.visualIdea}` : ''}`;
            }).join('\n\n');

            // Build speaker_notes string for this batch
            const speakerNotesContent = batch.map(s => {
                return `--- Slide ${s.slideIndex} ---\n${s.speakerNote || '(chưa có speaker note)'}`;
            }).join('\n\n');

            // Build prompt
            const prompt = await this.promptComposer.buildFullPrompt(
                lesson.subjectId,
                'slides.optimize-notes',
                {
                    slides_content: slidesContent,
                    speaker_notes: speakerNotesContent,
                },
            );

            // Generate using AI
            const aiResult = await this.aiProvider.generateText(prompt, modelConfig.modelName, userId);
            const batchNotes = this.parseSpeakerNotesJSON(aiResult.content, batch);
            allOptimizedNotes.push(...batchNotes);
        }

        if (onProgress) {
            await onProgress(95, 'Đang cập nhật lời giảng đã tối ưu...');
        }

        // Update SlideAudio in DB
        const slideAudios: any[] = [];
        for (const note of allOptimizedNotes) {
            const existingSlide = slides.find(s => s.slideIndex === note.slideIndex);

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
                    for (const note of allOptimizedNotes) {
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
                this.logger.warn(`Could not sync optimized speaker notes to slideScript: ${e.message}`);
            }
        }

        this.logger.log(`✅ Optimized ${allOptimizedNotes.length} speaker notes for lesson ${lessonId}`);

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

        const modelConfig = await this.modelConfigService.getModelForTask(userId, 'SLIDES');

        // Build prompt for content optimization (same prompt as Step 5 generation)
        const prompt = await this.promptComposer.buildFullPrompt(
            slide.lesson.subjectId,
            'slides.design',
            {
                title: slide.title,
                content: slide.content || '',
            },
        );

        // Use AiProviderService for content optimization
        const aiResult = await this.aiProvider.generateText(prompt, modelConfig.modelName, userId);
        const result = aiResult.content;

        // Parse JSON result (same cleaning logic as PptxService)
        let optimizedContent;
        try {
            let cleaned = result.trim();
            const jsonStartTag = cleaned.indexOf('```json');
            if (jsonStartTag !== -1) {
                const contentStart = jsonStartTag + '```json'.length;
                const lastBackticks = cleaned.lastIndexOf('```');
                if (lastBackticks > contentStart) {
                    cleaned = cleaned.substring(contentStart, lastBackticks).trim();
                }
            }
            const parsed = JSON.parse(cleaned);
            optimizedContent = parsed.bullets || parsed;
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

        try {
            // Call the actual image generator service
            const updatedSlide = await this.slideImageGenerator.generateImageForSlide(
                lessonId,
                slideIndex,
                userId
            );
            
            this.logger.log(`Successfully regenerated image for slide ${slideIndex}`);
            return updatedSlide;
        } catch (error) {
            this.logger.error(`Failed to regenerate image for slide ${slideIndex}: ${error.message}`);
            throw new BadRequestException(`Failed to regenerate image: ${error.message}`);
        }
    }
    /**
     * Generate optimized content AND image for a single slide (combined operation).
     * Used by the new sequential frontend pattern (like audio generation).
     */
    async generateContentAndImage(lessonId: string, slideIndex: number, userId: string) {
        const slide = await this.prisma.slide.findFirst({
            where: { lessonId, slideIndex },
            include: { lesson: { include: { subject: true } } },
        });

        if (!slide) {
            throw new NotFoundException(`Slide ${slideIndex} not found for lesson ${lessonId}`);
        }

        const result: {
            slideIndex: number;
            optimizedContent: any[] | null;
            imageUrl: string | null;
            title: string;
            contentError?: string;
            imageError?: string;
        } = {
            slideIndex,
            optimizedContent: null,
            imageUrl: slide.imageUrl,
            title: slide.title,
        };

        // Phase 1: Optimize content
        try {
            const modelConfig = await this.modelConfigService.getModelForTask(userId, 'SLIDES');

            const prompt = await this.promptComposer.buildFullPrompt(
                slide.lesson.subjectId,
                'slides.design',
                {
                    title: slide.title,
                    content: slide.content || '',
                },
            );

            const aiResult = await this.aiProvider.generateText(prompt, modelConfig.modelName, userId);
            const rawResult = aiResult.content;

            // Parse JSON
            let optimizedContent;
            let cleaned = rawResult.trim();
            const jsonStartTag = cleaned.indexOf('```json');
            if (jsonStartTag !== -1) {
                const contentStart = jsonStartTag + '```json'.length;
                const lastBackticks = cleaned.lastIndexOf('```');
                if (lastBackticks > contentStart) {
                    cleaned = cleaned.substring(contentStart, lastBackticks).trim();
                }
            } else {
                const plainStart = cleaned.indexOf('```');
                if (plainStart !== -1 && plainStart < 10) {
                    const contentStart = cleaned.indexOf('\n', plainStart) + 1;
                    const lastBackticks = cleaned.lastIndexOf('```');
                    if (lastBackticks > contentStart) {
                        cleaned = cleaned.substring(contentStart, lastBackticks).trim();
                    }
                }
            }
            const parsed = JSON.parse(cleaned);
            optimizedContent = parsed.bullets || parsed;

            // Save to DB
            await this.prisma.slide.update({
                where: { lessonId_slideIndex: { lessonId, slideIndex } },
                data: { optimizedContentJson: JSON.stringify(optimizedContent) },
            });

            result.optimizedContent = optimizedContent;
            this.logger.log(`[generateContentAndImage] Slide ${slideIndex}: optimized ${optimizedContent.length} bullets`);
        } catch (error) {
            this.logger.error(`[generateContentAndImage] Content optimization failed for slide ${slideIndex}: ${error.message}`);
            result.contentError = error.message;
        }

        // Phase 2: Generate image
        try {
            const updatedSlide = await this.slideImageGenerator.generateImageForSlide(
                lessonId,
                slideIndex,
                userId,
            );
            result.imageUrl = updatedSlide.imageUrl || null;
            this.logger.log(`[generateContentAndImage] Slide ${slideIndex}: image generated`);
        } catch (error) {
            this.logger.error(`[generateContentAndImage] Image generation failed for slide ${slideIndex}: ${error.message}`);
            result.imageError = error.message;
        }

        return result;
    }

    /**
     * Clear generated content (optimizedContentJson + imageUrl) for all slides in a lesson.
     * Used when user wants to regenerate everything from scratch.
     */
    async clearGeneratedContent(lessonId: string) {
        const result = await this.prisma.slide.updateMany({
            where: { lessonId },
            data: {
                optimizedContentJson: null,
                imageUrl: null,
            },
        });

        this.logger.log(`[clearGeneratedContent] Cleared content for ${result.count} slides in lesson ${lessonId}`);
        return { cleared: result.count };
    }
}

