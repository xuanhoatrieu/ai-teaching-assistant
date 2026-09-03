import { Injectable, Logger, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SlideImageGeneratorService } from '../slide-data/slide-image-generator.service';
import { SlideDataService } from '../slide-data/slide-data.service';
import { PromptComposerService } from '../prompts/prompt-composer.service';
import { ModelConfigService } from '../model-config/model-config.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { AiProviderService } from '../ai/ai-provider.service';
import { GenerationJobService } from '../generation-job/generation-job.service';
import { APIService } from '@prisma/client';
import { getOutputLanguageInstruction } from '../ai/language-instruction';
import * as path from 'path';
import * as fs from 'fs';
import { createInterface } from 'readline';
import { Readable } from 'stream';

interface SlideContent {
    slideIndex: number;
    title: string;
    content: string[];  // Fallback flat content
    bullets?: OptimizedBullet[];  // Structured bullets from AI
    imagePath?: string;
    audioPath?: string;
    speakerNote?: string;
    slideType?: string;
}

interface OptimizedBullet {
    emoji: string;
    point: string;
    description: string;
}

interface SlideProgressItem {
    slideIndex: number;
    phase: 'pending' | 'optimizing_content' | 'generating_image' | 'complete' | 'error' | 'skipped';
    imageUrl?: string;
    optimizedContent?: OptimizedBullet[];
    title?: string;
}

export interface GenerationProgress {
    lessonId: string;
    status: 'idle' | 'generating_content' | 'generating_images' | 'generating_pptx' | 'complete' | 'error';
    currentSlide: number;
    totalSlides: number;
    message: string;
    slides: SlideProgressItem[];
}

@Injectable()
export class PptxService {
    private readonly logger = new Logger(PptxService.name);
    private readonly pythonServiceUrl: string;
    private generationProgress: Map<string, GenerationProgress> = new Map();

    constructor(
        private prisma: PrismaService,
        private slideImageGenerator: SlideImageGeneratorService,
        private slideDataService: SlideDataService,
        private promptComposer: PromptComposerService,
        private modelConfig: ModelConfigService,
        private apiKeys: ApiKeysService,
        private aiProvider: AiProviderService,
        private jobService: GenerationJobService,
    ) {
        this.pythonServiceUrl = process.env.PPTX_SERVICE_URL || 'http://localhost:3002';
    }

    /**
     * Get generation status for a lesson
     */
    getStatus(lessonId: string): GenerationProgress {
        return this.generationProgress.get(lessonId) || {
            lessonId,
            status: 'idle',
            currentSlide: 0,
            totalSlides: 0,
            message: 'Not started',
            slides: [],
        };
    }

    /**
     * Generate AI-optimized content and images for all slides
     * Returns progress updates for real-time UI with content + image preview
     */
    async *generateImagesStream(lessonId: string, userId: string): AsyncGenerator<GenerationProgress> {
        this.logger.log(`Starting AI content + image generation for lesson ${lessonId}`);

        // Get lesson with subject for prompt context
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
            include: { subject: true },
        });

        if (!lesson) {
            throw new NotFoundException(`Lesson ${lessonId} not found`);
        }

        // Get slides from database
        let slides = await this.prisma.slide.findMany({
            where: { lessonId },
            orderBy: { slideIndex: 'asc' },
        });

        // FALLBACK: If no slides in database, parse from slideScript and create them
        // Uses slideDataService.parseAndSaveSlides which handles both JSON and Markdown formats
        if (slides.length === 0 && lesson.slideScript) {
            this.logger.log(`[INFO] No Slide entities found - using slideDataService to parse and create from slideScript`);
            this.logger.log(`[DEBUG] slideScript length: ${lesson.slideScript.length} chars`);
            try {
                slides = await this.slideDataService.parseAndSaveSlides(lessonId, lesson.slideScript);
                this.logger.log(`[INFO] Successfully created ${slides.length} Slide entities from slideScript`);
            } catch (parseError) {
                this.logger.error(`[ERROR] Failed to parse slideScript via slideDataService: ${parseError.message}`);
                this.logger.error(`[ERROR] slideScript preview: ${lesson.slideScript.substring(0, 500)}...`);
            }
        }

        if (slides.length === 0) {
            throw new NotFoundException(`No slides found for lesson ${lessonId}. Please complete Step 3 first.`);
        }

        // Get API key (user's key or fallback to environment)
        let apiKey = await this.apiKeys.getActiveKey(userId, APIService.GEMINI);
        if (!apiKey) {
            apiKey = process.env.GEMINI_API_KEY || null;
            if (apiKey) {
                this.logger.log(`[INFO] Using environment GEMINI_API_KEY as fallback for user ${userId}`);
            } else {
                this.logger.warn(`[WARN] No API key found for user ${userId} and no GEMINI_API_KEY in environment`);
            }
        }
        const contentModel = await this.modelConfig.getModelForTask(userId, 'SLIDES');

        // Initialize progress with pending slides
        const progress: GenerationProgress = {
            lessonId,
            status: 'generating_content',
            currentSlide: 0,
            totalSlides: slides.length,
            message: 'Bắt đầu tạo nội dung...',
            slides: slides.map(s => ({
                slideIndex: s.slideIndex,
                phase: 'pending' as const,
                title: s.title,
            })),
        };
        this.generationProgress.set(lessonId, progress);
        yield progress;

        // Process each slide: content optimization → image generation
        // Heartbeat: send periodic progress to keep SSE alive during long AI operations
        let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
        const startHeartbeat = () => {
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            heartbeatInterval = setInterval(() => {
                this.generationProgress.set(lessonId, progress);
            }, 15000); // Every 15 seconds
        };
        const stopHeartbeat = () => {
            if (heartbeatInterval) {
                clearInterval(heartbeatInterval);
                heartbeatInterval = null;
            }
        };

        for (let i = 0; i < slides.length; i++) {
            const slide = slides[i];
            progress.currentSlide = i + 1;

            // Phase 1: Optimize content with AI
            progress.slides[i].phase = 'optimizing_content';
            progress.message = `📝 Đang tạo nội dung slide ${i + 1}/${slides.length}...`;
            this.generationProgress.set(lessonId, progress);
            yield progress;

            // Debug logging
            this.logger.log(`[DEBUG] Optimizing slide ${i + 1}: title="${slide.title}", hasContent=${!!slide.content}, apiKey=${apiKey ? 'present' : 'MISSING'}, model=${contentModel.modelName}`);

            // Start heartbeat during AI call
            startHeartbeat();
            try {
                const subjectLanguage = lesson.subject?.language || 'vi';
                const optimizedContent = await this.optimizeSlideContent(
                    slide.title,
                    slide.content || '',
                    userId,
                    contentModel.modelName,
                    lesson.subjectId,
                    subjectLanguage
                );
                this.logger.log(`[DEBUG] Slide ${i + 1} optimized: ${optimizedContent.length} bullets`);
                progress.slides[i].optimizedContent = optimizedContent;

                // Save optimizedContent to database for persistence
                if (optimizedContent.length > 0) {
                    await this.prisma.slide.update({
                        where: { lessonId_slideIndex: { lessonId, slideIndex: slide.slideIndex } },
                        data: { optimizedContentJson: JSON.stringify(optimizedContent) }
                    });
                    this.logger.log(`[DEBUG] Saved optimizedContent for slide ${i + 1} to database`);
                }
            } catch (error) {
                this.logger.error(`Failed to optimize content for slide ${slide.slideIndex}: ${error.message}`);
                // Continue with original content if optimization fails
            }
            stopHeartbeat();

            // Phase 2: Generate image
            progress.slides[i].phase = 'generating_image';
            progress.status = 'generating_images';
            progress.message = `🖼️ Đang tạo ảnh slide ${i + 1}/${slides.length}...`;
            this.generationProgress.set(lessonId, progress);
            yield progress;

            startHeartbeat();
            try {
                // Always generate image - slide-image-generator will use title as fallback if no visualIdea
                const updatedSlide = await this.slideImageGenerator.generateImageForSlide(
                    lessonId,
                    slide.slideIndex,
                    userId
                );
                progress.slides[i].imageUrl = updatedSlide.imageUrl || undefined;
                progress.slides[i].phase = 'complete';
            } catch (error) {
                this.logger.error(`Failed to generate image for slide ${slide.slideIndex}: ${error.message}`);
                progress.slides[i].phase = 'error';
            }
            stopHeartbeat();

            this.generationProgress.set(lessonId, progress);
            yield progress;
        }

        stopHeartbeat(); // Ensure cleanup

        progress.status = 'complete';
        progress.message = '✅ Đã tạo xong nội dung và hình ảnh!';
        this.generationProgress.set(lessonId, progress);
        yield progress;
    }

    /**
     * Optimize slide content using AI (slides.design prompt)
     */
    private async optimizeSlideContent(
        title: string,
        rawContent: string,
        userId: string,
        modelName: string,
        subjectId?: string,
        subjectLanguage?: string
    ): Promise<OptimizedBullet[]> {
        this.logger.log(`[DEBUG] optimizeSlideContent called: title="${title.substring(0, 50)}", rawContent=${rawContent?.length || 0} chars, userId=${userId}, model=${modelName}, lang=${subjectLanguage}`);

        if (!rawContent || !userId) {
            this.logger.warn(`[SKIP] Content optimization skipped: rawContent=${!!rawContent}, userId=${!!userId}`);
            return [];
        }

        try {
            // Build prompt using slides.design template with language context
            this.logger.log(`[DEBUG] Building prompt with slides.design template (lang=${subjectLanguage})...`);
            const languageInstruction = getOutputLanguageInstruction(subjectLanguage || 'vi');
            let prompt: string;
            if (subjectId) {
                // Use buildFullPrompt so Role + Language are injected
                prompt = await this.promptComposer.buildFullPrompt(
                    subjectId,
                    'slides.design',
                    { title, content: rawContent }
                );
            } else {
                // Fallback: buildTaskOnlyPrompt + manually prepend language instruction
                const taskPrompt = await this.promptComposer.buildTaskOnlyPrompt(
                    'slides.design',
                    { title, content: rawContent }
                );
                prompt = `${languageInstruction}\n\n${taskPrompt}`;
            }
            this.logger.log(`[DEBUG] Prompt built: ${prompt?.length || 0} chars`);

            // Call AI (routes through CLIProxy if enabled, falls back to Gemini SDK)
            this.logger.log(`[DEBUG] Calling AI with model ${modelName}...`);
            const aiResult = await this.aiProvider.generateText(prompt, modelName, userId);
            const result = aiResult.content;
            this.logger.log(`[DEBUG] AI response (${aiResult.provider}): ${result?.length || 0} chars, preview: ${result?.substring(0, 200) || 'null'}`);

            // Parse JSON response
            const cleaned = this.cleanJsonResponse(result);
            this.logger.log(`[DEBUG] Cleaned JSON: ${cleaned?.length || 0} chars`);
            const parsed = JSON.parse(cleaned);
            this.logger.log(`[DEBUG] Parsed result: ${JSON.stringify(parsed).substring(0, 300)}`);

            const bullets = parsed.bullets || [];
            this.logger.log(`[DEBUG] Returning ${bullets.length} bullets`);
            return bullets;
        } catch (error) {
            this.logger.error(`[ERROR] Content optimization failed for "${title}": ${error.message}`);
            this.logger.error(`[ERROR] Stack: ${error.stack}`);
            return [];
        }
    }

    /**
     * Clean markdown code blocks from JSON response
     * Uses indexOf/lastIndexOf to handle nested code blocks within the JSON
     */
    private cleanJsonResponse(text: string): string {
        let cleaned = text.trim();

        // Use indexOf/lastIndexOf to handle nested code blocks
        const jsonStartTag = cleaned.indexOf('```json');
        if (jsonStartTag !== -1) {
            const contentStart = jsonStartTag + '```json'.length;
            const lastBackticks = cleaned.lastIndexOf('```');
            if (lastBackticks > contentStart) {
                cleaned = cleaned.substring(contentStart, lastBackticks).trim();
            }
        } else {
            // Try plain ``` at start (some responses use just ```)
            const plainStart = cleaned.indexOf('```');
            if (plainStart !== -1 && plainStart < 10) {
                const contentStart = cleaned.indexOf('\n', plainStart) + 1;
                const lastBackticks = cleaned.lastIndexOf('```');
                if (lastBackticks > contentStart) {
                    cleaned = cleaned.substring(contentStart, lastBackticks).trim();
                }
            }
        }

        return cleaned;
    }


    /**
     * Get temporary directory for ephemeral PPTX exports
     */
    getTempDir(): string {
        const dir = path.join(process.cwd(), 'uploads', 'temp-pptx');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return dir;
    }

    /**
     * Cleanup temporary PPTX files for a lesson and garbage-collect files older than 1 hour
     */
    cleanupTempPptx(lessonId: string, fileKey?: string): { success: boolean; deletedCount: number } {
        const tempDir = this.getTempDir();
        let deletedCount = 0;

        try {
            if (!fs.existsSync(tempDir)) return { success: true, deletedCount: 0 };

            const files = fs.readdirSync(tempDir);
            const now = Date.now();
            const ONE_HOUR = 60 * 60 * 1000;

            for (const file of files) {
                const fullPath = path.join(tempDir, file);
                const belongsToLesson = file.startsWith(`${lessonId}_`);
                const isTargetFile = fileKey ? file === `${lessonId}_${fileKey}.pptx` : belongsToLesson;

                let isExpired = false;
                try {
                    const stats = fs.statSync(fullPath);
                    if (now - stats.mtimeMs > ONE_HOUR) {
                        isExpired = true;
                    }
                } catch {}

                if (isTargetFile || isExpired) {
                    try {
                        if (fs.existsSync(fullPath)) {
                            fs.unlinkSync(fullPath);
                            deletedCount++;
                            this.logger.log(`[cleanupTempPptx] Deleted temp file: ${file}`);
                        }
                    } catch (e: any) {
                        this.logger.warn(`[cleanupTempPptx] Could not delete ${file}: ${e.message}`);
                    }
                }
            }
        } catch (err: any) {
            this.logger.error(`[cleanupTempPptx] Error during cleanup: ${err.message}`);
        }

        return { success: true, deletedCount };
    }

    /**
     * Locate temporary PPTX file for download
     */
    getTempPptxFile(lessonId: string, fileKey: string): { filePath: string; filename: string } {
        const safeKey = fileKey.replace(/[^a-zA-Z0-9_-]/g, '');
        if (!safeKey) {
            throw new HttpException('Invalid file key', HttpStatus.BAD_REQUEST);
        }

        const tempDir = this.getTempDir();
        const filePath = path.join(tempDir, `${lessonId}_${safeKey}.pptx`);

        if (!fs.existsSync(filePath)) {
            throw new NotFoundException('File PowerPoint tạm thời không tồn tại hoặc đã bị xóa để giải phóng bộ nhớ.');
        }

        return { filePath, filename: `presentation_${safeKey}.pptx` };
    }

    /**
     * Check if temporary PPTX files are available for download for a lesson
     */
    getAvailableTempFiles(lessonId: string): {
        audioFileKey: string | null;
        noAudioFileKey: string | null;
        audioFileSize?: number;
        noAudioFileSize?: number;
    } {
        const tempDir = this.getTempDir();
        if (!fs.existsSync(tempDir)) {
            return { audioFileKey: null, noAudioFileKey: null };
        }

        let audioFileKey: string | null = null;
        let noAudioFileKey: string | null = null;
        let audioFileSize: number | undefined;
        let noAudioFileSize: number | undefined;
        let newestAudioMtime = 0;
        let newestNoAudioMtime = 0;

        const files = fs.readdirSync(tempDir);
        const ONE_HOUR = 60 * 60 * 1000;
        const now = Date.now();

        for (const file of files) {
            if (!file.startsWith(`${lessonId}_`) || !file.endsWith('.pptx')) continue;

            const fullPath = path.join(tempDir, file);
            try {
                const stats = fs.statSync(fullPath);
                if (now - stats.mtimeMs > ONE_HOUR) continue;

                const fileKey = file.substring(lessonId.length + 1).replace(/\.pptx$/, '');

                if (fileKey.includes('noaudio')) {
                    if (stats.mtimeMs > newestNoAudioMtime) {
                        newestNoAudioMtime = stats.mtimeMs;
                        noAudioFileKey = fileKey;
                        noAudioFileSize = stats.size;
                    }
                } else {
                    if (stats.mtimeMs > newestAudioMtime) {
                        newestAudioMtime = stats.mtimeMs;
                        audioFileKey = fileKey;
                        audioFileSize = stats.size;
                    }
                }
            } catch {}
        }

        return {
            audioFileKey,
            noAudioFileKey,
            audioFileSize,
            noAudioFileSize,
        };
    }

    /**
     * Prepare data payload for Python PPTX generator
     */
    async preparePackagingData(
        lessonId: string,
        templateId: string,
        userId: string,
        skipAudio?: boolean
    ) {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
            include: {
                slides: {
                    orderBy: { slideIndex: 'asc' },
                },
            },
        });

        if (!lesson) {
            throw new NotFoundException(`Lesson ${lessonId} not found`);
        }

        const templateInfo = await this.getTemplateInfo(templateId, userId);
        const templatePath = templateInfo.fileUrl || 'blank';

        const titleBgPath = templateInfo.titleBgUrl ? this.getLocalPath(templateInfo.titleBgUrl) : undefined;
        const contentBgPath = templateInfo.contentBgUrl ? this.getLocalPath(templateInfo.contentBgUrl) : undefined;

        const slideAudios = await this.prisma.slideAudio.findMany({
            where: { lessonId },
            orderBy: { slideIndex: 'asc' },
        });

        const slideContents: SlideContent[] = lesson.slides.map(slide => {
            let audioUrl = null as string | null;
            let audioSource = 'skipped';
            if (!skipAudio) {
                audioUrl = slide.audioUrl;
                audioSource = 'Slide';
                if (!audioUrl) {
                    const legacyAudio = slideAudios.find(a => a.slideIndex === slide.slideIndex);
                    audioUrl = legacyAudio?.audioUrl || null;
                    audioSource = legacyAudio?.audioUrl ? 'SlideAudio(legacy)' : 'none';
                }
            }
            const audioPath = audioUrl ? this.getLocalPath(audioUrl) : undefined;

            let bullets: OptimizedBullet[] | undefined;
            let contentArray: string[] = [];

            if (slide.optimizedContentJson) {
                try {
                    bullets = JSON.parse(slide.optimizedContentJson) as OptimizedBullet[];
                    contentArray = bullets.map(b => b.point
                        ? `${b.emoji} ${b.point}: ${b.description}`
                        : b.description
                    );
                } catch (e) {
                    contentArray = this.parseContent(slide.content);
                }
            } else {
                contentArray = this.parseContent(slide.content);
            }

            const imagePath = slide.imageUrl ? this.getLocalPath(slide.imageUrl) : undefined;
            const slideAudioForNotes = slideAudios.find(a => a.slideIndex === slide.slideIndex);

            return {
                slideIndex: slide.slideIndex,
                title: slide.title,
                content: contentArray,
                bullets,
                imagePath,
                audioPath,
                speakerNote: slideAudioForNotes?.speakerNote || slide.speakerNote || '',
                slideType: slide.slideType || 'content',
            };
        });

        return {
            lesson,
            templatePath,
            titleBgPath,
            contentBgPath,
            slideContents,
        };
    }

    /**
     * Package presentation asynchronously with real-time slide-by-slide progress
     */
    async packagePresentationWithJob(
        jobId: string,
        lessonId: string,
        templateId: string,
        userId: string,
        skipAudio?: boolean
    ): Promise<void> {
        this.logger.log(`[packagePresentationWithJob] Starting job ${jobId} for lesson ${lessonId}`);

        try {
            await this.jobService.updateProgress(jobId, 5, 'Đang chuẩn bị tài nguyên bài học...');

            const { lesson, templatePath, titleBgPath, contentBgPath, slideContents } =
                await this.preparePackagingData(lessonId, templateId, userId, skipAudio);

            const prefix = skipAudio ? 'noaudio_' : 'audio_';
            const fileKey = `${prefix}${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
            const tempDir = this.getTempDir();
            const targetFilePath = path.join(tempDir, `${lessonId}_${fileKey}.pptx`);

            this.logger.log(`[packagePresentationWithJob] Calling Python /generate-stream with target ${targetFilePath}`);

            const response = await fetch(`${this.pythonServiceUrl}/generate-stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    templatePath,
                    lessonTitle: lesson.title,
                    slides: slideContents,
                    titleBgPath,
                    contentBgPath,
                    targetFilePath,
                }),
            });

            if (!response.ok || !response.body) {
                const errorText = await response.text();
                throw new Error(`Python service failed: ${errorText}`);
            }

            const nodeStream = Readable.fromWeb(response.body as any);
            const rl = createInterface({ input: nodeStream, crlfDelay: Infinity });

            let finalFileSize = 0;
            let savingInterval: NodeJS.Timeout | null = null;
            const clearSavingInterval = () => {
                if (savingInterval) {
                    clearInterval(savingInterval);
                    savingInterval = null;
                }
            };

            try {
                for await (const line of rl) {
                    if (!line.trim()) continue;

                    const isCancelled = await this.jobService.isJobCancelled(jobId);
                    if (isCancelled) {
                        clearSavingInterval();
                        this.logger.log(`[packagePresentationWithJob] Job ${jobId} cancelled. Cleaning up.`);
                        try {
                            if (fs.existsSync(targetFilePath)) fs.unlinkSync(targetFilePath);
                        } catch {}
                        return;
                    }

                    try {
                        const event = JSON.parse(line);
                        if (event.step === 'init') {
                            await this.jobService.updateProgress(jobId, 8, event.message || 'Đang chuẩn bị mẫu PowerPoint...');
                        } else if (event.step === 'slide') {
                            const total = event.total || slideContents.length;
                            const pct = Math.round(8 + (event.index / total) * 55);
                            await this.jobService.updateProgress(jobId, pct, event.message);
                        } else if (event.step === 'saving') {
                            clearSavingInterval();
                            const savingStages = [
                                { pct: 72, msg: 'Đang nén dữ liệu đa phương tiện (WAV & PNG)...' },
                                { pct: 80, msg: 'Đang tối ưu dung lượng tệp PowerPoint...' },
                                { pct: 88, msg: 'Đang hoàn thiện cấu trúc tài liệu PPTX...' },
                                { pct: 95, msg: 'Đang ghi file hoàn tất vào hệ thống...' },
                            ];
                            let stageIdx = 0;
                            await this.jobService.updateProgress(jobId, 65, 'Đang nén các tệp âm thanh và hình ảnh vào PowerPoint...');
                            savingInterval = setInterval(async () => {
                                if (stageIdx < savingStages.length) {
                                    const stage = savingStages[stageIdx++];
                                    try {
                                        await this.jobService.updateProgress(jobId, stage.pct, stage.msg);
                                    } catch {}
                                }
                            }, 1800);
                        } else if (event.step === 'done') {
                            clearSavingInterval();
                            finalFileSize = event.fileSize || 0;
                        } else if (event.step === 'error') {
                            clearSavingInterval();
                            throw new Error(event.error || 'Lỗi khi đóng gói PowerPoint');
                        }
                    } catch (parseErr: any) {
                        if (parseErr.message && parseErr.message.includes('Lỗi khi đóng gói')) throw parseErr;
                        this.logger.warn(`[packagePresentationWithJob] Line parse warning: ${parseErr.message}`);
                    }
                }
            } finally {
                clearSavingInterval();
            }

            if (!fs.existsSync(targetFilePath)) {
                throw new Error('File PPTX chưa được tạo thành công.');
            }

            const safeFilename = `${(lesson.title || 'presentation').replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF ]/g, '_')}.pptx`;

            await this.jobService.updateProgress(jobId, 100, 'Đã tạo xong file PowerPoint!');
            await this.jobService.completeJob(jobId, {
                fileKey,
                filename: safeFilename,
                fileSize: finalFileSize || fs.statSync(targetFilePath).size,
            });

            this.logger.log(`[packagePresentationWithJob] Job ${jobId} completed. FileKey: ${fileKey}`);
        } catch (err: any) {
            this.logger.error(`[packagePresentationWithJob] Job ${jobId} failed: ${err.message}`, err.stack);
            await this.jobService.failJob(jobId, err.message || 'Không thể đóng gói file PowerPoint');
        }
    }

    /**
     * Generate PPTX file by calling Python service (Legacy direct buffer download)
     */
    async generatePptx(
        lessonId: string,
        templateId: string,
        userId: string,
        skipAudio?: boolean
    ): Promise<Buffer> {
        this.logger.log(`Generating PPTX for lesson ${lessonId} with template ${templateId}${skipAudio ? ' (no audio)' : ''}`);

        const { lesson, templatePath, titleBgPath, contentBgPath, slideContents } =
            await this.preparePackagingData(lessonId, templateId, userId, skipAudio);

        // Call Python service with background image paths
        const response = await fetch(`${this.pythonServiceUrl}/generate-buffer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                templatePath,
                lessonTitle: lesson.title,
                slides: slideContents,
                titleBgPath,
                contentBgPath,
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new HttpException(`PPTX generation failed: ${error}`, HttpStatus.INTERNAL_SERVER_ERROR);
        }

        const result = await response.json();

        // Convert base64 to buffer
        const buffer = Buffer.from(result.buffer, 'base64');

        return buffer;
    }

    /**
     * Get template info including file path and background URLs
     */
    private async getTemplateInfo(templateId: string, userId: string): Promise<{
        fileUrl: string | null;
        titleBgUrl: string | null;
        contentBgUrl: string | null;
    }> {
        if (templateId === 'blank' || !templateId) {
            return { fileUrl: null, titleBgUrl: null, contentBgUrl: null };
        }

        // Check if system template
        const template = await this.prisma.pPTXTemplate.findUnique({
            where: { id: templateId },
        });

        if (!template) {
            // Check user templates
            const userTemplate = await this.prisma.pPTXTemplate.findFirst({
                where: { id: templateId, userId },
            });

            if (!userTemplate) {
                this.logger.warn(`Template ${templateId} not found, using blank`);
                return { fileUrl: null, titleBgUrl: null, contentBgUrl: null };
            }

            // For user templates
            return {
                fileUrl: userTemplate.fileUrl || null,
                titleBgUrl: userTemplate.titleBgUrl || null,
                contentBgUrl: userTemplate.contentBgUrl || null,
            };
        }

        // For system templates
        return {
            fileUrl: template.fileUrl || null,
            titleBgUrl: template.titleBgUrl || null,
            contentBgUrl: template.contentBgUrl || null,
        };
    }

    /**
     * Parse slide content to string array
     */
    private parseContent(content: any): string[] {
        if (!content) return [];
        if (Array.isArray(content)) return content;
        if (typeof content === 'string') {
            try {
                const parsed = JSON.parse(content);
                return Array.isArray(parsed) ? parsed : [content];
            } catch {
                return [content];
            }
        }
        return [];
    }

    /**
     * Convert public URL to local file path
     * Handles: /uploads/..., /files/public/..., /files/..., and absolute paths
     * 
     * URL formats:
     * - /files/public/{userId}/{lessonId}/images/{filename} -> datauser/{userId}/lessons/{lessonId}/images/{filename}
     * - /files/{userId}/{lessonId}/audio/{filename} -> datauser/{userId}/lessons/{lessonId}/audio/{filename}
     * - /uploads/... -> {cwd}/uploads/...
     */
    private getLocalPath(publicUrl: string): string {
        if (!publicUrl) return '';

        // Handle /uploads/... path (for user-uploaded templates)
        if (publicUrl.startsWith('/uploads')) {
            return path.join(process.cwd(), publicUrl);
        }

        // Handle /templates/... path (for system templates like /templates/tuaf/1.png)
        // Maps to: {cwd}/public/templates/... (served by NestJS static assets)
        if (publicUrl.startsWith('/templates')) {
            return path.join(process.cwd(), 'public', publicUrl);
        }

        // Handle /files/public/system/templates/{uuid}/{filename}
        // -> datauser/system/templates/{uuid}/{filename} (system template backgrounds)
        const systemTemplateMatch = publicUrl.match(/^\/files\/public\/system\/templates\/([^/]+)\/(.+)$/);
        if (systemTemplateMatch) {
            const [, templateUuid, filename] = systemTemplateMatch;
            return path.join(process.cwd(), 'datauser', 'system', 'templates', templateUuid, filename);
        }

        // Handle /files/public/{userId}/templates/{uuid}/{filename}
        // -> datauser/{userId}/templates/{uuid}/{filename} (user template backgrounds)
        const userTemplateMatch = publicUrl.match(/^\/files\/public\/([^/]+)\/templates\/([^/]+)\/(.+)$/);
        if (userTemplateMatch) {
            const [, userId, templateUuid, filename] = userTemplateMatch;
            return path.join(process.cwd(), 'datauser', userId, 'templates', templateUuid, filename);
        }

        // Handle /files/public/{userId}/{lessonId}/images/{filename}
        // -> datauser/{userId}/lessons/{lessonId}/images/{filename}
        const publicMatch = publicUrl.match(/^\/files\/public\/([^/]+)\/([^/]+)\/images\/(.+)$/);
        if (publicMatch) {
            const [, userId, lessonId, filename] = publicMatch;
            return path.join(process.cwd(), 'datauser', userId, 'lessons', lessonId, 'images', filename);
        }


        // Handle /files/{userId}/{lessonId}/audio/{filename}
        // -> datauser/{userId}/lessons/{lessonId}/audio/{filename}
        const authMatch = publicUrl.match(/^\/files\/([^/]+)\/([^/]+)\/audio\/(.+)$/);
        if (authMatch) {
            const [, userId, lessonId, filename] = authMatch;
            return path.join(process.cwd(), 'datauser', userId, 'lessons', lessonId, 'audio', filename);
        }

        // Fallback: if already an absolute path, return as-is
        if (path.isAbsolute(publicUrl)) {
            return publicUrl;
        }

        this.logger.warn(`[PPTX] Unknown URL format: ${publicUrl}`);
        return publicUrl;
    }


    /**
     * List available templates (system + user)
     */
    async getTemplates(userId: string): Promise<any[]> {
        // Get system templates
        const systemTemplates = await this.prisma.pPTXTemplate.findMany({
            where: { isSystem: true },
            select: { id: true, name: true, description: true },
        });

        // Get user templates
        const userTemplates = await this.prisma.pPTXTemplate.findMany({
            where: { userId, isSystem: false },
            select: { id: true, name: true, description: true },
        });

        return [
            { id: 'blank', name: 'Blank', description: 'Empty presentation', isSystem: true },
            ...systemTemplates.map(t => ({ ...t, isSystem: true })),
            ...userTemplates.map(t => ({ ...t, isSystem: false })),
        ];
    }
}
