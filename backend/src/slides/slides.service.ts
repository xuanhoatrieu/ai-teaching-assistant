import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { ModelConfigService } from '../model-config/model-config.service';
import { SlideDataService } from '../slide-data/slide-data.service';
import { PromptComposerService } from '../prompts/prompt-composer.service';
import { FidelityValidatorService } from '../prompts/fidelity-validator.service';
import { AiProviderService } from '../ai/ai-provider.service';
import { SlideImageGeneratorService } from '../slide-data/slide-image-generator.service';
import { FileStorageService } from '../file-storage/file-storage.service';
import { Lesson } from '@prisma/client';
import { packageScormZip } from './scorm-export.helper';
import { packageH5pZip } from './h5p-export.helper';

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
        private fileStorageService: FileStorageService,
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
     * Helper to clean AI cliché expressions, eliminate meta-references to 'slide',
     * and normalize formatting for spoken lecture
     */
    private cleanAntiAIPhrases(text: string): string {
        if (!text) return '';
        let cleaned = text;

        const replacements: Array<[RegExp, string]> = [
            // Meta-slide & Presentation references (purge 'slide', 'infographic trên slide', 'slide trước')
            [/\b(?:chào\s+mừng\s+(?:các\s+bạn|quý\s+vị|mọi\s+người)\s+đến\s+với\s+(?:slide|bài\s+học)\s+(?:tiếp\s+theo|này|hôm\s+nay))\b[,\.\:\s]*/gi, ''],
            [/\b(?:tiếp\s+nối\s+(?:lưu\s+đồ|sơ\s+đồ|nội\s+dung|ý\s+chính)?\s*(?:ở|tại)?\s*slide\s+trước)[,\s]*/gi, 'Tiếp theo, '],
            [/\b(?:ở|tại|trong|trên)\s+slide\s+(?:trước|vừa\s+rồi|vừa\s+qua)[,\s]*/gi, 'ở phần trước, '],
            [/\b(?:slide\s+tiếp\s+theo|ở\s+slide\s+sau|trong\s+slide\s+kế\s+tiếp)\s+(?:chúng\s+ta\s+sẽ|chúng\s+mình\s+sẽ)?/gi, 'tiếp theo chúng ta sẽ'],
            [/\b(?:trên|trong|ở|tại)\s+slide\s+(?:này|đây|hiện\s+tại)?[,\s]*/gi, 'ở đây, '],
            [/\b(?:infographic|lưu\s+đồ|hình\s+ảnh)\s+trên\s+slide\b/gi, 'sơ đồ minh họa'],
            [/\b(?:quan\s+sát\s+)?infographic\s+(?:ở\s+đây|này)?\b/gi, 'sơ đồ này'],
            [/\btrên\s+slide\b/gi, 'ở đây'],
            [/\bslide\s+này\b/gi, 'phần này'],

            // Repetitive cookie-cutter hooks
            [/\bcác\s+bạn\s+hãy\s+quan\s+sát\b/gi, 'quan sát'],
            [/\bcác\s+bạn\s+hãy\s+nhìn\s+vào\b/gi, 'nhìn vào'],
            [/\bcác\s+bạn\s+hãy\s+chú\s+ý\b/gi, 'hãy chú ý'],
            [/\bcác\s+bạn\s+hãy\b/gi, 'hãy'],

            // AI Clichés & Metaphors
            [/\b(?:hãy\s+cùng\s+(?:tôi|chúng\s+ta)\s+khám\s+phá|bước\s+vào\s+hành\s+trình\s+khám\s+phá)\b/gi, 'bây giờ chúng ta sẽ tìm hiểu'],
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

        // Deduplicate excessive "các bạn" (keep max 1 per note, replace subsequent with "chúng ta")
        cleaned = this.deduplicatePronouns(cleaned);

        // Clean Markdown markers and bracketed slide tags that degrade TTS
        cleaned = cleaned
            .replace(/[*#_~`]/g, '')
            .replace(/\[\s*slide\s*\d+\s*\]/gi, '')
            .replace(/\s{2,}/g, ' ')
            .trim();

        return cleaned;
    }

    /**
     * Deduplicate excessive "các bạn" within a single speaker note.
     * Leaves the 1st occurrence if appropriate, and converts subsequent ones to "chúng ta".
     */
    private deduplicatePronouns(text: string): string {
        if (!text) return '';
        let count = 0;
        return text.replace(/\b([Cc]ác\s+bạn)\b/g, (match) => {
            count++;
            if (count === 1) {
                return match;
            }
            const isCapital = match[0] === 'C';
            return isCapital ? 'Chúng ta' : 'chúng ta';
        });
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
        isCancelled?: () => Promise<boolean>,
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
            if (isCancelled && await isCancelled()) {
                this.logger.log(`[generateSpeakerNotes] Job cancelled by user at batch starting at slide ${i + 1}`);
                break;
            }

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
                ? `[Chủ đề vừa giải thích ở phần trước để nối mạch tự nhiên: "${previousSlideBridge}"]\n(Lưu ý: Tuyệt đối KHÔNG dùng từ "slide trước" hay "slide", hãy nối mạch kiến thức tự nhiên)\n\n${slidesContent}`
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
        isCancelled?: () => Promise<boolean>,
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
            if (isCancelled && await isCancelled()) {
                this.logger.log(`[optimizeSpeakerNotes] Job cancelled by user at batch starting at slide ${i + 1}`);
                break;
            }

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
     * Generate speaker note for a single slide using AI
     */
    async generateSingleSlideSpeakerNote(lessonId: string, slideIndex: number, userId: string) {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
            include: { subject: true },
        });

        if (!lesson) {
            throw new NotFoundException(`Lesson ${lessonId} not found`);
        }

        const slide = await this.prisma.slide.findUnique({
            where: { lessonId_slideIndex: { lessonId, slideIndex } },
        });

        if (!slide) {
            throw new NotFoundException(`Slide ${slideIndex} not found in lesson ${lessonId}`);
        }

        // Check if there is a previous slide for bridge context
        let previousBridge = '';
        if (slideIndex > 1) {
            const prevAudio = await this.prisma.slideAudio.findUnique({
                where: { lessonId_slideIndex: { lessonId, slideIndex: slideIndex - 1 } },
            });
            if (prevAudio?.speakerNote) {
                previousBridge = prevAudio.speakerNote.substring(0, 140);
            }
        }

        let content = '';
        if (slide.optimizedContentJson) {
            try {
                const parsed = JSON.parse(slide.optimizedContentJson);
                if (Array.isArray(parsed)) {
                    content = parsed.map((p: any) => `${p.emoji || '•'} ${p.point}: ${p.description || ''}`).join('\n');
                }
            } catch {
                content = slide.content || '';
            }
        } else {
            content = slide.content || '';
        }

        const slidePromptText = `--- Slide ${slide.slideIndex} (${slide.slideType || 'content'}) ---\nTitle: ${slide.title}\nContent: ${content || slide.title}${slide.visualIdea ? `\nVisual Idea: ${slide.visualIdea}` : ''}`;
        const promptContent = previousBridge
            ? `[Chủ đề vừa giải thích ở phần trước để nối mạch tự nhiên: "${previousBridge}"]\n(Lưu ý: Tuyệt đối KHÔNG dùng từ "slide trước" hay "slide", hãy nối mạch kiến thức tự nhiên)\n\n${slidePromptText}`
            : slidePromptText;

        const modelConfig = await this.modelConfigService.getModelForTask(userId, 'SPEAKER_NOTES');
        const prompt = await this.promptComposer.buildFullPrompt(
            lesson.subjectId,
            'slides.speaker-notes',
            {
                title: lesson.title,
                slides_content: promptContent,
            },
        );

        const aiResult = await this.aiProvider.generateText(prompt, modelConfig.modelName, userId);
        const parsedNotes = this.parseSpeakerNotesJSON(aiResult.content, [slide]);
        const generatedNote = parsedNotes.length > 0 && parsedNotes[0].speakerNote
            ? parsedNotes[0].speakerNote
            : this.cleanAntiAIPhrases(aiResult.content.trim());

        // Save to Slide.speakerNote (raw note)
        await this.prisma.slide.update({
            where: { id: slide.id },
            data: { speakerNote: generatedNote },
        });

        // Save/upsert SlideAudio record (active note ready for TTS)
        const updatedAudio = await this.prisma.slideAudio.upsert({
            where: { lessonId_slideIndex: { lessonId, slideIndex } },
            update: {
                speakerNote: generatedNote,
                slideTitle: slide.title,
                status: 'pending',
            },
            create: {
                lessonId,
                slideIndex,
                slideTitle: slide.title,
                speakerNote: generatedNote,
                status: 'pending',
            },
        });

        // Also sync into slideScript JSON
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
                    const s = scriptData.slides.find((item: any) => item.slideIndex === slideIndex);
                    if (s) {
                        s.speakerNote = generatedNote;
                        await this.prisma.lesson.update({
                            where: { id: lessonId },
                            data: { slideScript: JSON.stringify(scriptData, null, 2) },
                        });
                    }
                }
            } catch (e: any) {
                this.logger.warn(`Could not sync single speaker note to slideScript: ${e.message}`);
            }
        }

        this.logger.log(`[generateSingleSlideSpeakerNote] Successfully generated note for slide ${slideIndex} in lesson ${lessonId}`);

        return {
            slideIndex,
            speakerNote: generatedNote,
            slideAudio: updatedAudio,
        };
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

    /**
     * Update slide content (title and/or optimized bullets) manually
     */
    async updateSlideContent(
        lessonId: string,
        slideIndex: number,
        title?: string,
        optimizedContent?: any[],
        content?: string,
        speakerNote?: string,
        slideType?: string,
        interactiveData?: any,
        layoutType?: string,
    ) {
        const slide = await this.prisma.slide.findFirst({
            where: { lessonId, slideIndex },
        });

        if (!slide) {
            throw new NotFoundException(`Slide ${slideIndex} not found for lesson ${lessonId}`);
        }

        const updateData: any = {};
        if (title !== undefined && title !== null) {
            updateData.title = title.trim();
        }
        if (optimizedContent !== undefined && optimizedContent !== null) {
            updateData.optimizedContentJson = JSON.stringify(optimizedContent);
        }
        if (content !== undefined && content !== null) {
            updateData.content = content.trim();
        }
        if (speakerNote !== undefined && speakerNote !== null) {
            updateData.speakerNote = speakerNote.trim();
        }
        if (slideType !== undefined && slideType !== null) {
            updateData.slideType = slideType.trim();
        }
        if (layoutType !== undefined && layoutType !== null) {
            updateData.layoutType = layoutType.trim();
        }
        if (interactiveData !== undefined) {
            updateData.interactiveData = interactiveData === null ? null : (typeof interactiveData === 'string' ? interactiveData : JSON.stringify(interactiveData));
        }

        const updatedSlide = await this.prisma.slide.update({
            where: {
                lessonId_slideIndex: { lessonId, slideIndex },
            },
            data: updateData,
        });

        if (speakerNote !== undefined && speakerNote !== null) {
            const existingAudio = await this.prisma.slideAudio.findUnique({
                where: { lessonId_slideIndex: { lessonId, slideIndex } },
            });
            if (existingAudio) {
                await this.prisma.slideAudio.update({
                    where: { id: existingAudio.id },
                    data: { speakerNote: speakerNote.trim() },
                });
            }
        }

        this.logger.log(`[updateSlideContent] Slide ${slideIndex} updated for lesson ${lessonId}`);
        return updatedSlide;
    }

    /**
     * Generate interactive activity for a slide (Listening quiz, dictation, checkpoint quiz, etc.)
     */
    async generateSlideInteractions(
        lessonId: string,
        slideIndex: number,
        userId: string,
        requestedType?: string,
        options?: {
            mode?: 'generate_new' | 'extract_existing';
            sourceType?: 'slide_range' | 'custom_text' | 'current_slide' | 'audio' | 'image';
            fromSlideIndex?: number;
            toSlideIndex?: number;
            customContent?: string;
            imageBase64?: string;
            selectedQuestionTypes?: string[];
            questionCount?: number;
            passScore?: number;
            fallbackSlideIndex?: number;
            allowContinueWithoutPass?: boolean;
        },
    ) {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
            include: { subject: true },
        });

        if (!lesson) {
            throw new NotFoundException(`Lesson ${lessonId} not found`);
        }

        const slide = await this.prisma.slide.findUnique({
            where: { lessonId_slideIndex: { lessonId, slideIndex } },
        });

        if (!slide) {
            throw new NotFoundException(`Slide ${slideIndex} not found in lesson ${lessonId}`);
        }

        let content = '';
        const isExtractMode = options?.mode === 'extract_existing';
        const sourceType = options?.sourceType || (isExtractMode ? 'custom_text' : 'current_slide');

        if (sourceType === 'slide_range' && options?.fromSlideIndex && options?.toSlideIndex && !isExtractMode) {
            const fromIdx = Math.min(Number(options.fromSlideIndex), Number(options.toSlideIndex));
            const toIdx = Math.max(Number(options.fromSlideIndex), Number(options.toSlideIndex));
            const rangeSlides = await this.prisma.slide.findMany({
                where: {
                    lessonId,
                    slideIndex: { gte: fromIdx, lte: toIdx },
                },
                orderBy: { slideIndex: 'asc' },
            });
            content = rangeSlides.map(s => {
                let sBody = s.content || '';
                if (s.optimizedContentJson) {
                    try {
                        const parsed = JSON.parse(s.optimizedContentJson);
                        if (Array.isArray(parsed)) {
                            sBody = parsed.map((p: any) => `${p.emoji || '•'} ${p.point}: ${p.description || ''}`).join('\n');
                        }
                    } catch {}
                }
                return `[Slide ${s.slideIndex}: ${s.title}]\n${sBody}\n${s.speakerNote ? `Lời giảng: ${s.speakerNote}\n` : ''}`;
            }).join('\n\n');
        } else if ((sourceType === 'custom_text' || isExtractMode || sourceType === 'audio' || sourceType === 'image') && options?.customContent) {
            content = `[Nội dung tài liệu/đề bài do giáo viên cung cấp]:\n${options.customContent}`;
        } else {
            if (slide.optimizedContentJson) {
                try {
                    const parsed = JSON.parse(slide.optimizedContentJson);
                    if (Array.isArray(parsed)) {
                        content = parsed.map((p: any) => `${p.emoji || '•'} ${p.point}: ${p.description || ''}`).join('\n');
                    }
                } catch {
                    content = slide.content || '';
                }
            } else {
                content = slide.content || '';
            }
        }

        const hasAudioSample = !!(slide.extraAudioUrl || slide.extraAudioName);
        const subjectName = lesson.subject?.name || '';
        const courseName = lesson.subject?.courseName || '';
        const targetAudience = lesson.subject?.targetAudience || 'Sinh viên đại học';

        const selectedTypes = (options?.selectedQuestionTypes && options.selectedQuestionTypes.length > 0)
            ? options.selectedQuestionTypes
            : ['MC', 'TF', 'MR', 'FIB', 'MATCH', 'ORDER', 'CLOZE'];

        const typeLabels: Record<string, string> = {
            MC: 'Trắc nghiệm đơn 1 đáp án đúng (type: "MC", options: 4 lựa chọn A, B, C, D, correctAnswer: "chuỗi đáp án đúng")',
            TF: 'Đúng hay Sai (type: "TF", options: ["Đúng", "Sai"], correctAnswer: "Đúng" hoặc "Sai")',
            MR: 'Nhiều lựa chọn đúng (type: "MR", options: 4 lựa chọn, correctAnswers: [mảng chứa các đáp án đúng])',
            FIB: 'Điền khuyết thuật ngữ vào chỗ trống (type: "FIB", question: câu hỏi chứa ký hiệu [.....], correctAnswer: "từ hoặc thuật ngữ cần điền")',
            MATCH: 'Nối cặp tương ứng hai vế A và B (type: "MATCH", question: "Yêu cầu nối...", pairs: [ { "left": "Khái niệm/Thuật ngữ vế A", "right": "Định nghĩa/Ý nghĩa vế B tương ứng" }, ... ])',
            ORDER: 'Sắp xếp thứ tự từ trong câu (type: "ORDER", question: "Sắp xếp các từ sau thành câu hoàn chỉnh:", words: ["mảng", "từ", "bị", "xáo", "trộn"], correctSentence: "Câu hoàn chỉnh đúng chuẩn ngữ pháp")',
            CLOZE: 'Điền từ vào chỗ trống trong đoạn văn hoặc hội thoại (type: "CLOZE", question: "Điền từ thích hợp vào các chỗ trống:", passage: "Đoạn văn hoặc kịch bản hội thoại với các từ cần điền đặt trong ngoặc vuông [từ_cần_điền] (Ví dụ: A: Hello, how are [you]?\\nB: I am [fine], thanks.)", explanation: "Giải thích ngữ cảnh...")',
        };

        const typesRequirementText = selectedTypes.map(t => `- ${typeLabels[t] || t}`).join('\n');
        const questionCount = options?.questionCount ? Number(options.questionCount) : 5;
        const passScore = options?.passScore !== undefined ? Number(options.passScore) : (questionCount >= 5 ? 4 : Math.max(1, questionCount - 1));
        const fallbackSlideIndex = options?.fallbackSlideIndex !== undefined ? Number(options.fallbackSlideIndex) : (options?.fromSlideIndex || Math.max(1, slide.slideIndex - 1));

        let promptText = '';

        if (isExtractMode) {
            promptText = `
Bạn là CHUYÊN GIA SỐ HÓA VÀ TRÍCH XUẤT ĐỀ THI TỰ ĐỘNG (EXAM QUESTION EXTRACTOR) theo chuẩn Moodle / SCORM / H5P.
Giáo viên ĐÃ CÓ SẴN CÂU HỎI TRONG TÀI LIỆU DƯỚI ĐÂY. Nhiệm vụ của bạn là ĐỌC VÀ TRÍCH XUẤT CHÍNH XÁC CÁC CÂU HỎI ĐÓ, KHÔNG TỰ BỊA RA CÂU HỎI MỚI.

TÀI LIỆU / ĐỀ BÀI DO GIÁO VIÊN CUNG CẤP:
${content || '(Chưa có nội dung đề bài dạng text)'}
${options?.imageBase64 ? '\n[LƯU Ý ĐẶC BIỆT TỪ ẢNH ĐÍNH KÈM]: Giáo viên có gửi kèm HÌNH ẢNH CHỤP ĐỀ BÀI / SÁCH BÀI TẬP. Bạn hãy OCR đọc thật kỹ chữ và câu hỏi từ hình ảnh được đính kèm này để trích xuất đầy đủ, chính xác từng câu hỏi và đáp án!\n' : ''}
QUY TẮC TRÍCH XUẤT BẮT BUỘC:
1. TRÍCH XUẤT NGUYÊN VĂN: Giữ đúng câu hỏi, các phương án lựa chọn (A, B, C, D...) và nội dung nguyên bản của giáo viên. KHÔNG tự chế câu hỏi khác nếu tài liệu đã có câu hỏi.
2. PHÂN LOẠI DẠNG CÂU HỎI CHÍNH XÁC:
   - "MC": Trắc nghiệm 1 đáp án đúng (Single Choice, options: danh sách lựa chọn, correctAnswer: "đáp án đúng").
   - "TF": Đúng hay Sai (True/False, options: ["Đúng", "Sai"], correctAnswer: "Đúng" hoặc "Sai").
   - "MR": Trắc nghiệm nhiều đáp án đúng (Multiple Response, options: danh sách lựa chọn, correctAnswers: mảng các đáp án đúng).
   - "FIB": Điền khuyết từ vào chỗ trống (Fill in the Blank, question có ký hiệu [.....], correctAnswer: từ cần điền).
   - "MATCH": Nối cặp tương ứng hai vế A và B (Matching Pairs, pairs: mảng các cặp đối xứng [ { "left": "vế A", "right": "vế B tương ứng" } ]).
   - "ORDER": Sắp xếp các từ thành câu hoàn chỉnh (words: mảng từ xáo trộn, correctSentence: câu chuẩn hoàn chỉnh).
   - "CLOZE": Điền khuyết đoạn văn hoặc hội thoại (passage: đoạn văn hoặc kịch bản hội thoại có các từ cần điền đặt trong ngoặc vuông [từ]).
3. XÁC ĐỊNH ĐÁP ÁN ĐÚNG:
   - Nếu trong văn bản đề bài có ghi rõ đáp án (ví dụ: dòng "Đáp án: A", hoặc có dấu *, gạch chân, in đậm, [x]), hãy lấy đúng đáp án đó.
   - Nếu đề bài chưa ghi đáp án, bạn hãy giải và xác định đáp án chính xác 100%, kèm giải thích ngắn gọn (explanation).
4. SỐ LƯỢNG & CHUẨN ĐẠT:
   - Trích xuất toàn bộ các câu hỏi có trong tài liệu (ưu tiên trích xuất đầy đủ, nếu đề bài dài có thể lấy tối đa ${questionCount} câu).
   - Chuẩn đạt tối thiểu (passScore): ${passScore}.
   - Slide quay lại ôn tập nếu không đạt: Slide ${fallbackSlideIndex}.

YÊU CẦU ĐẦU RA:
Trả về DUY NHẤT một chuỗi JSON hợp lệ (không kèm markdown ngoài block json, không giải thích ngoài JSON) theo định dạng:
{
  "activityType": "${requestedType || (hasAudioSample ? 'listening_comprehension' : 'checkpoint_quiz')}",
  "badgeLabel": "${hasAudioSample ? '🎧 Bài tập nghe hiểu' : '🎯 Kiểm tra kiến thức (Chặn bài)'}",
  "instruction": "Hãy trả lời các câu hỏi kiểm tra dưới đây",
  "passScore": ${passScore},
  "totalQuestions": ${questionCount},
  "fallbackSlideIndex": ${fallbackSlideIndex},
  "allowContinueWithoutPass": ${options?.allowContinueWithoutPass === true},
  "hideSolutions": ${!hasAudioSample},
  "questions": [
    {
      "id": "q1",
      "type": "MC",
      "question": "Nội dung câu hỏi nguyên bản...",
      "options": ["Lựa chọn A", "Lựa chọn B", "Lựa chọn C", "Lựa chọn D"],
      "correctAnswer": "Lựa chọn A",
      "explanation": "Giải thích chi tiết..."
    },
    {
      "id": "q2",
      "type": "ORDER",
      "question": "Sắp xếp các từ sau thành câu hoàn chỉnh:",
      "words": ["English", "Learning", "is", "fun"],
      "correctSentence": "Learning English is fun",
      "explanation": "Giải thích cấu trúc câu..."
    },
    {
      "id": "q3",
      "type": "CLOZE",
      "question": "Điền từ thích hợp vào chỗ trống trong đoạn hội thoại sau:",
      "passage": "A: Good morning, how are [you]?\\nB: I am [fine], thank you.",
      "explanation": "Đoạn hội thoại giao tiếp cơ bản."
    }
  ]
}
`;
        } else {
            promptText = `
Bạn là chuyên gia thiết kế sư phạm và học liệu điện tử tương tác cao (Instructional Designer) theo chuẩn Moodle / H5P / SCORM.
Hãy tạo 1 hoạt động tương tác (Interactive Activity) tốt nhất cho Slide học sau:

THÔNG TIN BÀI HỌC:
- Môn học: ${subjectName} (${courseName})
- Đối tượng: ${targetAudience}
- Bài học: ${lesson.title}
- Slide số: ${slide.slideIndex}
- Tiêu đề slide: ${slide.title}
${sourceType === 'slide_range' ? `- NGUỒN KIẾN THỨC TỔNG HỢP TỪ CÁC SLIDE (${options?.fromSlideIndex} ĐẾN ${options?.toSlideIndex}):` : '- Nội dung kiến thức nguồn:'}
${content || '(Dựa vào tiêu đề slide)'}
${slide.speakerNote && sourceType !== 'slide_range' ? `- Lời giảng thuyết minh: ${slide.speakerNote}` : ''}
${hasAudioSample ? `- Slide có TỆP ÂM THANH MẪU: "${slide.extraAudioName || 'Audio mẫu'}" (Hãy ưu tiên tạo bài tập nghe hiểu hoặc nghe chép chính tả dựa trên ngữ cảnh này!)` : ''}
${requestedType ? `- Loại tương tác được yêu cầu: ${requestedType}` : ''}

QUY ĐỊNH BẮT BUỘC VỀ DẠNG CÂU HỎI:
CHỈ ĐƯỢC TẠO các câu hỏi thuộc đúng các dạng sau đây:
${typesRequirementText}
TUYỆT ĐỐI KHÔNG sinh dạng câu hỏi nằm ngoài danh sách được phép trên!

YÊU CẦU SỐ LƯỢNG & CHUẨN ĐẠT:
- Hãy sinh CHÍNH XÁC đúng ${questionCount} câu hỏi (phân bố đều các dạng đã chọn ở trên).
- Chuẩn đạt tối thiểu: ${passScore}/${questionCount} câu.
- Slide quay lại ôn tập nếu không đạt: Slide ${fallbackSlideIndex}.
- Chính sách cho phép qua slide: ${options?.allowContinueWithoutPass ? 'Cho phép sinh viên tiếp tục học kể cả chưa đạt điểm chuẩn' : 'Bắt buộc đạt chuẩn mới được qua slide'}.

YÊU CẦU ĐẦU RA:
Trả về DUY NHẤT một chuỗi JSON hợp lệ (không kèm markdown ngoài block json, không giải thích thêm) theo định dạng:
{
  "activityType": "${requestedType || (hasAudioSample ? 'listening_comprehension' : 'checkpoint_quiz')}",
  "badgeLabel": "${hasAudioSample ? '🎧 Bài tập nghe hiểu' : (options?.allowContinueWithoutPass ? '📝 Luyện tập & Khảo sát quan điểm' : '🎯 Kiểm tra kiến thức (Chặn bài)')}",
  "instruction": "Hướng dẫn ngắn gọn cho sinh viên thực hiện bài tập",
  "passScore": ${passScore},
  "totalQuestions": ${questionCount},
  "fallbackSlideIndex": ${fallbackSlideIndex},
  "allowContinueWithoutPass": ${options?.allowContinueWithoutPass === true},
  "hideSolutions": ${!hasAudioSample},
  "questions": [
    {
      "id": "q1",
      "type": "${selectedTypes[0] || 'MC'}",
      "question": "Nội dung câu hỏi...",
      "options": ["Đáp án A", "Đáp án B", "Đáp án C", "Đáp án D"],
      "correctAnswer": "Đáp án A",
      "explanation": "Giải thích chi tiết..."
    },
    {
      "id": "q2",
      "type": "ORDER",
      "question": "Sắp xếp các từ sau thành câu hoàn chỉnh:",
      "words": ["English", "Learning", "is", "fun"],
      "correctSentence": "Learning English is fun",
      "explanation": "Giải thích cấu trúc ngữ pháp..."
    },
    {
      "id": "q3",
      "type": "CLOZE",
      "question": "Điền từ thích hợp vào chỗ trống trong đoạn văn / hội thoại sau:",
      "passage": "A: Good morning, how are [you]?\\nB: I am [fine], thank you.",
      "explanation": "Đoạn văn / kịch bản hội thoại chuẩn ngữ cảnh."
    }
  ]
}
`;
        }

        const modelConfig = await this.modelConfigService.getModelForTask(userId, 'QUESTIONS');
        const aiResult = await this.aiProvider.generateText(promptText, modelConfig.modelName, userId, { imageBase64: options?.imageBase64 });
        const rawContent = aiResult.content;

        let parsedInteractive: any = null;
        try {
            const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, rawContent];
            const cleanJson = (jsonMatch[1] || rawContent).trim();
            parsedInteractive = JSON.parse(cleanJson);
        } catch (err) {
            this.logger.error(`Failed to parse AI interactive JSON: ${err.message}. Raw: ${rawContent}`);
            parsedInteractive = {
                activityType: requestedType || (hasAudioSample ? 'listening_comprehension' : 'checkpoint_quiz'),
                badgeLabel: hasAudioSample ? '🎧 Bài tập nghe hiểu' : (options?.allowContinueWithoutPass ? '📝 Luyện tập & Khảo sát quan điểm' : '🎯 Kiểm tra kiến thức (Chặn bài)'),
                instruction: 'Trả lời các câu hỏi kiểm tra kiến thức để mở khóa bài học tiếp theo',
                passScore: passScore,
                totalQuestions: questionCount,
                fallbackSlideIndex: fallbackSlideIndex,
                allowContinueWithoutPass: options?.allowContinueWithoutPass === true,
                hideSolutions: !hasAudioSample,
                questions: [
                    {
                        id: 'q1',
                        type: 'MC',
                        question: `Kiến thức trọng tâm của ${slide.title} là gì?`,
                        options: ['Phương án A', 'Phương án B', 'Phương án C', 'Phương án D'],
                        correctAnswer: 'Phương án A',
                        explanation: 'Vui lòng xem lại nội dung bài học để nắm rõ kiến thức.'
                    },
                    {
                        id: 'q2',
                        type: 'TF',
                        question: `Nhận định: "${slide.title} đóng vai trò quan trọng trong học phần" là Đúng hay Sai?`,
                        options: ['Đúng', 'Sai'],
                        correctAnswer: 'Đúng',
                        explanation: 'Đây là nhận định chính xác theo giáo trình.'
                    }
                ]
            };
        }

        parsedInteractive.passScore = passScore;
        parsedInteractive.fallbackSlideIndex = fallbackSlideIndex;
        parsedInteractive.allowContinueWithoutPass = options?.allowContinueWithoutPass === true;
        parsedInteractive.totalQuestions = parsedInteractive.questions?.length || questionCount;

        const newSlideType = requestedType || (hasAudioSample ? 'interactive_audio' : 'checkpoint_quiz');
        const newLayoutType = hasAudioSample ? 'audio_lab' : 'checkpoint_gate';

        const updatedSlide = await this.prisma.slide.update({
            where: { lessonId_slideIndex: { lessonId, slideIndex } },
            data: {
                interactiveData: JSON.stringify(parsedInteractive),
                slideType: newSlideType,
                layoutType: newLayoutType,
            } as any,
        });

        this.logger.log(`[generateSlideInteractions] Successfully generated interaction for slide ${slideIndex} in lesson ${lessonId}`);
        return {
            ...updatedSlide,
            interactiveDataParsed: parsedInteractive,
        };
    }

    /**
     * Upload custom image for slide and replace existing image
     */
    async uploadCustomSlideImage(
        lessonId: string,
        slideIndex: number,
        userId: string,
        file: Express.Multer.File,
    ) {
        if (!file || !file.buffer) {
            throw new BadRequestException('Vui lòng chọn file hình ảnh');
        }

        const slide = await this.prisma.slide.findFirst({
            where: { lessonId, slideIndex },
        });

        if (!slide) {
            throw new NotFoundException(`Slide ${slideIndex} not found for lesson ${lessonId}`);
        }

        // Determine extension
        let ext = 'png';
        if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg') {
            ext = 'jpg';
        } else if (file.mimetype === 'image/webp') {
            ext = 'webp';
        }

        // Save image buffer using fileStorageService
        const { publicUrl } = await this.fileStorageService.saveImageFile(
            userId,
            lessonId,
            slideIndex,
            file.buffer,
            ext,
        );

        // Update database with imageUrl
        const updatedSlide = await this.prisma.slide.update({
            where: {
                lessonId_slideIndex: { lessonId, slideIndex },
            },
            data: {
                imageUrl: publicUrl,
                status: 'image_generated',
            },
        });

        this.logger.log(`[uploadCustomSlideImage] Custom image saved for slide ${slideIndex}: ${publicUrl}`);
        return updatedSlide;
    }

    /**
     * Re-serializes the current Slide list in database back to lesson.slideScript.
     * Keeps Step 3 (Slide Script) and other consumers in sync when slides are added,
     * deleted, or reordered.
     */
    async syncSlidesToSlideScript(lessonId: string): Promise<void> {
        try {
            const lesson = await this.prisma.lesson.findUnique({
                where: { id: lessonId },
                select: { title: true, slideScript: true },
            });
            if (!lesson) return;

            const slides = await this.prisma.slide.findMany({
                where: { lessonId },
                orderBy: { slideIndex: 'asc' },
            });

            const slideAudios = await this.prisma.slideAudio.findMany({
                where: { lessonId },
                orderBy: { slideIndex: 'asc' },
            });
            const audioMap = new Map(slideAudios.map(a => [a.slideIndex, a]));

            const scriptSlides = slides.map(s => {
                const audio = audioMap.get(s.slideIndex);
                let contentArray: string[] = [];
                if (Array.isArray(s.content)) {
                    contentArray = s.content;
                } else if (typeof s.content === 'string' && s.content.trim()) {
                    contentArray = s.content.split('\n').map(l => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
                }
                return {
                    slideIndex: s.slideIndex,
                    slideNumber: s.slideIndex,
                    slideType: s.slideType || 'content',
                    title: s.title,
                    content: contentArray,
                    visualIdea: s.visualIdea || '',
                    speakerNote: audio?.speakerNote || s.speakerNote || '',
                };
            });

            const scriptData = {
                lessonTitle: lesson.title,
                slides: scriptSlides,
            };

            await this.prisma.lesson.update({
                where: { id: lessonId },
                data: { slideScript: JSON.stringify(scriptData, null, 2) },
            });
            this.logger.log(`[syncSlidesToSlideScript] Synced ${scriptSlides.length} slides to slideScript for lesson ${lessonId}`);
        } catch (e: any) {
            this.logger.warn(`[syncSlidesToSlideScript] Failed: ${e.message}`);
        }
    }

    /**
     * Add a new slide to the lesson.
     * If insertAfterIndex is provided, inserts right after that slide and shifts all
     * subsequent slides up by 1. Otherwise appends at the end.
     */
    async createSlide(
        lessonId: string,
        dto: { title?: string; content?: string; speakerNote?: string; slideType?: string; layoutType?: string; interactiveData?: any; insertAfterIndex?: number; }
    ): Promise<any> {
        const existingSlides = await this.prisma.slide.findMany({
            where: { lessonId },
            orderBy: { slideIndex: 'asc' },
        });

        const total = existingSlides.length;
        let targetIndex = total + 1;

        if (
            dto.insertAfterIndex !== undefined &&
            dto.insertAfterIndex >= 0 &&
            dto.insertAfterIndex <= total
        ) {
            targetIndex = dto.insertAfterIndex + 1;
        }

        // Shift existing slides from targetIndex up to total by +1 (in reverse order to avoid unique collisions)
        if (targetIndex <= total) {
            for (let i = total; i >= targetIndex; i--) {
                await this.prisma.slide.update({
                    where: { lessonId_slideIndex: { lessonId, slideIndex: i } },
                    data: { slideIndex: i + 1 },
                });

                const sa = await this.prisma.slideAudio.findUnique({
                    where: { lessonId_slideIndex: { lessonId, slideIndex: i } },
                });
                if (sa) {
                    await this.prisma.slideAudio.update({
                        where: { id: sa.id },
                        data: { slideIndex: i + 1 },
                    });
                }
            }
        }

        const title = dto.title?.trim() || `Slide ${targetIndex}`;
        const newSlide = await this.prisma.slide.create({
            data: {
                lessonId,
                slideIndex: targetIndex,
                title,
                content: dto.content || '',
                speakerNote: dto.speakerNote || '',
                slideType: dto.slideType || 'content',
                layoutType: dto.layoutType || (dto.slideType === 'checkpoint_quiz' ? 'checkpoint_gate' : (dto.slideType === 'interactive_audio' ? 'audio_lab' : 'split_standard')),
                interactiveData: dto.interactiveData ? (typeof dto.interactiveData === 'string' ? dto.interactiveData : JSON.stringify(dto.interactiveData)) : null,
                status: 'draft',
            } as any,
        });

        // Also create matching SlideAudio slot
        await this.prisma.slideAudio.create({
            data: {
                lessonId,
                slideIndex: targetIndex,
                slideTitle: title,
                speakerNote: dto.speakerNote || '',
                status: 'pending',
            },
        });

        await this.syncSlidesToSlideScript(lessonId);
        return newSlide;
    }

    /**
     * Delete slide at slideIndex and renumber remaining slides.
     */
    async deleteSlide(lessonId: string, slideIndex: number): Promise<{ success: boolean; totalSlides: number }> {
        const slide = await this.prisma.slide.findUnique({
            where: { lessonId_slideIndex: { lessonId, slideIndex } },
        });

        if (!slide) {
            throw new NotFoundException(`Slide ${slideIndex} not found in lesson ${lessonId}`);
        }

        const total = await this.prisma.slide.count({ where: { lessonId } });
        if (total <= 1) {
            throw new BadRequestException('Không thể xóa slide duy nhất trong bài giảng');
        }

        // Cleanup any extra audio file
        if ((slide as any).extraAudioUrl) {
            try {
                const localPath = path.join(process.cwd(), (slide as any).extraAudioUrl.replace(/^\//, ''));
                if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
            } catch (err: any) {
                this.logger.warn(`Could not delete extra audio file: ${err.message}`);
            }
        }

        // Delete SlideAudio
        await this.prisma.slideAudio.deleteMany({
            where: { lessonId, slideIndex },
        });

        // Delete Slide
        await this.prisma.slide.delete({
            where: { id: slide.id },
        });

        // Shift subsequent slides down by 1 (ascending order)
        for (let i = slideIndex + 1; i <= total; i++) {
            await this.prisma.slide.update({
                where: { lessonId_slideIndex: { lessonId, slideIndex: i } },
                data: { slideIndex: i - 1 },
            });

            const sa = await this.prisma.slideAudio.findUnique({
                where: { lessonId_slideIndex: { lessonId, slideIndex: i } },
            });
            if (sa) {
                await this.prisma.slideAudio.update({
                    where: { id: sa.id },
                    data: { slideIndex: i - 1 },
                });
            }
        }

        await this.syncSlidesToSlideScript(lessonId);
        return { success: true, totalSlides: total - 1 };
    }

    /**
     * Move slide up or down by swapping with adjacent slide.
     */
    async moveSlide(lessonId: string, slideIndex: number, direction: 'up' | 'down'): Promise<any[]> {
        const total = await this.prisma.slide.count({ where: { lessonId } });
        if (direction === 'up' && slideIndex <= 1) {
            throw new BadRequestException('Slide đầu tiên không thể di chuyển lên');
        }
        if (direction === 'down' && slideIndex >= total) {
            throw new BadRequestException('Slide cuối cùng không thể di chuyển xuống');
        }

        const targetIndex = direction === 'up' ? slideIndex - 1 : slideIndex + 1;

        const slideA = await this.prisma.slide.findUnique({
            where: { lessonId_slideIndex: { lessonId, slideIndex } },
        });
        const slideB = await this.prisma.slide.findUnique({
            where: { lessonId_slideIndex: { lessonId, slideIndex: targetIndex } },
        });

        if (!slideA || !slideB) {
            throw new NotFoundException('Slide not found for swap');
        }

        const audioA = await this.prisma.slideAudio.findUnique({
            where: { lessonId_slideIndex: { lessonId, slideIndex } },
        });
        const audioB = await this.prisma.slideAudio.findUnique({
            where: { lessonId_slideIndex: { lessonId, slideIndex: targetIndex } },
        });

        // 3-step swap using temp index -999 to prevent unique constraint conflict
        await this.prisma.$transaction(async (tx) => {
            // Slide swap
            await tx.slide.update({
                where: { id: slideA.id },
                data: { slideIndex: -999 },
            });
            await tx.slide.update({
                where: { id: slideB.id },
                data: { slideIndex: slideIndex },
            });
            await tx.slide.update({
                where: { id: slideA.id },
                data: { slideIndex: targetIndex },
            });

            // SlideAudio swap
            if (audioA) {
                await tx.slideAudio.update({
                    where: { id: audioA.id },
                    data: { slideIndex: -999 },
                });
            }
            if (audioB) {
                await tx.slideAudio.update({
                    where: { id: audioB.id },
                    data: { slideIndex: slideIndex },
                });
            }
            if (audioA) {
                await tx.slideAudio.update({
                    where: { id: audioA.id },
                    data: { slideIndex: targetIndex },
                });
            }
        });

        await this.syncSlidesToSlideScript(lessonId);
        return this.getSlides(lessonId);
    }

    /**
     * Upload an extra sample/media audio file for a slide.
     * Saved in /uploads/lessons/:lessonId/audio/ (same place as lecture narration audio).
     */
    async uploadExtraAudio(
        lessonId: string,
        slideIndex: number,
        file: Express.Multer.File
    ): Promise<any> {
        if (!file) {
            throw new BadRequestException('Vui lòng chọn file âm thanh');
        }

        const slide = await this.prisma.slide.findUnique({
            where: { lessonId_slideIndex: { lessonId, slideIndex } },
        });
        if (!slide) {
            throw new NotFoundException(`Slide ${slideIndex} not found for lesson ${lessonId}`);
        }

        // Audio storage folder: uploads/lessons/:lessonId/audio
        const audioDir = path.join(process.cwd(), 'uploads', 'lessons', lessonId, 'audio');
        if (!fs.existsSync(audioDir)) {
            fs.mkdirSync(audioDir, { recursive: true });
        }

        // Delete previous extra audio if exists
        if ((slide as any).extraAudioUrl) {
            try {
                const oldPath = path.join(process.cwd(), (slide as any).extraAudioUrl.replace(/^\//, ''));
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            } catch (err: any) {
                this.logger.warn(`Could not remove old extra audio: ${err.message}`);
            }
        }

        const ext = path.extname(file.originalname).replace('.', '') || 'mp3';
        const fileName = `slide_${String(slideIndex).padStart(2, '0')}_extra_${Date.now()}.${ext}`;
        const filePath = path.join(audioDir, fileName);

        fs.writeFileSync(filePath, file.buffer);
        const publicUrl = `/uploads/lessons/${lessonId}/audio/${fileName}`;

        const updatedSlide = await this.prisma.slide.update({
            where: { lessonId_slideIndex: { lessonId, slideIndex } },
            data: {
                extraAudioUrl: publicUrl,
                extraAudioName: file.originalname || fileName,
            } as any,
        });

        this.logger.log(`[uploadExtraAudio] Extra audio saved for slide ${slideIndex}: ${publicUrl}`);
        return updatedSlide;
    }

    /**
     * Delete extra audio from slide.
     */
    async deleteExtraAudio(lessonId: string, slideIndex: number): Promise<any> {
        const slide = await this.prisma.slide.findUnique({
            where: { lessonId_slideIndex: { lessonId, slideIndex } },
        });
        if (!slide) {
            throw new NotFoundException(`Slide ${slideIndex} not found`);
        }

        if ((slide as any).extraAudioUrl) {
            try {
                const localPath = path.join(process.cwd(), (slide as any).extraAudioUrl.replace(/^\//, ''));
                if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
            } catch (err: any) {
                this.logger.warn(`Could not delete extra audio file: ${err.message}`);
            }
        }

        const updatedSlide = await this.prisma.slide.update({
            where: { lessonId_slideIndex: { lessonId, slideIndex } },
            data: {
                extraAudioUrl: null,
                extraAudioName: null,
                extraAudioDuration: null,
            } as any,
        });

        return updatedSlide;
    }

    /**
     * Export lesson as ADL SCORM 1.2 ZIP package for Moodle LMS
     */
    async exportScorm(lessonId: string, res: any, templateId?: string, bgOption?: string, theme?: string) {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
        });
        if (!lesson) {
            throw new NotFoundException(`Lesson ${lessonId} not found`);
        }

        const slides = await this.prisma.slide.findMany({
            where: { lessonId },
            orderBy: { slideIndex: 'asc' },
        });

        const slideAudios = await this.prisma.slideAudio.findMany({
            where: { lessonId },
        });
        const audioMap = new Map(slideAudios.map(a => [a.slideIndex, a.audioUrl]));

        const enrichedSlides = slides.map(s => ({
            ...s,
            audioUrl: s.audioUrl || audioMap.get(s.slideIndex) || '',
        }));

        // Retrieve template info
        let selectedTemplate: any = null;
        if (templateId && templateId !== 'blank') {
            selectedTemplate = await this.prisma.pPTXTemplate.findUnique({
                where: { id: templateId },
            });
        }
        if (!selectedTemplate) {
            selectedTemplate = await this.prisma.pPTXTemplate.findFirst({
                where: { isDefault: true, isActive: true },
            });
        }

        const effectiveBgOption = bgOption || 'tuaf_clean';

        const safeTitle = (lesson.title || 'lesson')
            .replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF ]/g, '_')
            .replace(/\s+/g, '_');
        const zipFileName = `${safeTitle}_SCORM_1.2.zip`;

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(zipFileName)}"`);

        await packageScormZip(lesson.title, lessonId, enrichedSlides, res, {
            templateId: selectedTemplate?.id,
            templateName: selectedTemplate?.name,
            titleBgUrl: selectedTemplate?.titleBgUrl,
            contentBgUrl: selectedTemplate?.contentBgUrl,
            bgOption: effectiveBgOption,
            theme,
        });
    }

    /**
     * Export lesson as H5P Course Presentation package (.h5p) for Moodle LMS
     */
    async exportH5p(lessonId: string, res: any, templateId?: string, bgOption?: string, theme?: string) {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
        });
        if (!lesson) {
            throw new NotFoundException(`Lesson ${lessonId} not found`);
        }

        const slides = await this.prisma.slide.findMany({
            where: { lessonId },
            orderBy: { slideIndex: 'asc' },
        });

        const slideAudios = await this.prisma.slideAudio.findMany({
            where: { lessonId },
        });
        const audioMap = new Map(slideAudios.map(a => [a.slideIndex, a.audioUrl]));

        const enrichedSlides = slides.map(s => ({
            ...s,
            audioUrl: s.audioUrl || audioMap.get(s.slideIndex) || '',
        }));

        let selectedTemplate: any = null;
        if (templateId && templateId !== 'blank') {
            selectedTemplate = await this.prisma.pPTXTemplate.findUnique({
                where: { id: templateId },
            });
        }
        if (!selectedTemplate) {
            selectedTemplate = await this.prisma.pPTXTemplate.findFirst({
                where: { isDefault: true, isActive: true },
            });
        }

        const effectiveBgOption = bgOption || 'tuaf_clean';

        const safeTitle = (lesson.title || 'lesson')
            .replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF ]/g, '_')
            .replace(/\s+/g, '_');
        const h5pFileName = `${safeTitle}_H5P.h5p`;

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(h5pFileName)}"`);

        await packageH5pZip(lesson.title, enrichedSlides, res, {
            templateId: selectedTemplate?.id,
            templateName: selectedTemplate?.name,
            titleBgUrl: selectedTemplate?.titleBgUrl,
            contentBgUrl: selectedTemplate?.contentBgUrl,
            bgOption: effectiveBgOption,
            theme,
        });
    }

    /**
     * Export all interactive & checkpoint questions as Moodle Quiz XML (.xml)
     */
    async exportMoodleXml(lessonId: string, res: any) {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
        });
        if (!lesson) {
            throw new NotFoundException(`Lesson ${lessonId} not found`);
        }

        const slides = await this.prisma.slide.findMany({
            where: { lessonId },
            orderBy: { slideIndex: 'asc' },
        });

        const questions: any[] = [];
        for (const slide of slides) {
            const rawInteractive = (slide as any).interactiveData;
            if (!rawInteractive) continue;
            try {
                const data = typeof rawInteractive === 'string'
                    ? JSON.parse(rawInteractive)
                    : rawInteractive;
                const qList = Array.isArray(data.questions) ? data.questions : [];
                qList.forEach((q: any, qIdx: number) => {
                    questions.push({
                        slideIndex: slide.slideIndex,
                        slideTitle: slide.title,
                        questionId: `Slide${slide.slideIndex}-Q${qIdx + 1}`,
                        question: q.question,
                        correctAnswer: q.correctAnswer,
                        options: q.options || [],
                        explanation: q.explanation || '',
                        type: q.type || 'MC',
                        badgeLabel: data.badgeLabel || 'Hoạt động tương tác',
                    });
                });
            } catch (e) {
                this.logger.warn(`Failed to parse interactiveData for slide ${slide.slideIndex}`);
            }
        }

        const safeTitle = (lesson.title || 'lesson')
            .replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF ]/g, '_')
            .replace(/\s+/g, '_');

        let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<quiz>\n`;
        xml += `  <question type="category">\n    <category>\n      <text>$course$/top/${safeTitle}</text>\n    </category>\n  </question>\n\n`;

        for (const q of questions) {
            const otherOptions = (q.options || []).filter((opt: string) => opt.trim() !== (q.correctAnswer || '').trim());
            const feedbackParts = [`<strong>Đáp án đúng là: </strong>${q.correctAnswer}`];
            if (q.explanation) {
                feedbackParts.push(`<strong>Vì: </strong>${q.explanation}`);
            }
            const feedbackHtml = feedbackParts.map((p) => `<p>${p}</p>`).join('\n      ');

            xml += `  <question type="multichoice">\n`;
            xml += `    <name><text><![CDATA[Slide ${q.slideIndex}: ${q.question.substring(0, 120)}]]></text></name>\n`;
            xml += `    <questiontext format="html">\n`;
            xml += `      <text><![CDATA[<p><strong>[${q.badgeLabel} - Slide ${q.slideIndex}: ${q.slideTitle}]</strong></p><p>${q.question}</p>]]></text>\n`;
            xml += `    </questiontext>\n`;
            xml += `    <generalfeedback format="html">\n`;
            xml += `      <text><![CDATA[${feedbackHtml}]]></text>\n`;
            xml += `    </generalfeedback>\n`;
            xml += `    <defaultgrade>1.0000000</defaultgrade>\n`;
            xml += `    <penalty>0.3333333</penalty>\n`;
            xml += `    <hidden>0</hidden>\n`;
            xml += `    <single>true</single>\n`;
            xml += `    <shuffleanswers>true</shuffleanswers>\n`;
            xml += `    <answernumbering>ABCD</answernumbering>\n`;

            // Correct answer
            xml += `    <answer fraction="100" format="html">\n`;
            xml += `      <text><![CDATA[<p>${q.correctAnswer}</p>]]></text>\n`;
            xml += `      <feedback format="html"><text><![CDATA[<p>Chính xác!</p>]]></text></feedback>\n`;
            xml += `    </answer>\n`;

            // Distractors
            for (const distractor of otherOptions) {
                xml += `    <answer fraction="0" format="html">\n`;
                xml += `      <text><![CDATA[<p>${distractor}</p>]]></text>\n`;
                xml += `      <feedback format="html"><text><![CDATA[<p>Chưa chính xác.</p>]]></text></feedback>\n`;
                xml += `    </answer>\n`;
            }
            xml += `  </question>\n\n`;
        }

        xml += `</quiz>\n`;

        const fileName = `${safeTitle}_moodle_quiz.xml`;
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
        res.send(xml);
    }
}

