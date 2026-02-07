import { Injectable, Logger, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SlideImageGeneratorService } from '../slide-data/slide-image-generator.service';
import { SlideDataService } from '../slide-data/slide-data.service';
import { PromptComposerService } from '../prompts/prompt-composer.service';
import { ModelConfigService } from '../model-config/model-config.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { GeminiService } from '../ai/gemini.service';
import { APIService } from '@prisma/client';
import * as path from 'path';

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
        private gemini: GeminiService,
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

            try {
                const optimizedContent = await this.optimizeSlideContent(
                    slide.title,
                    slide.content || '',
                    apiKey || '',
                    contentModel.modelName
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

            // Phase 2: Generate image
            progress.slides[i].phase = 'generating_image';
            progress.status = 'generating_images';
            progress.message = `🖼️ Đang tạo ảnh slide ${i + 1}/${slides.length}...`;
            this.generationProgress.set(lessonId, progress);
            yield progress;

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

            this.generationProgress.set(lessonId, progress);
            yield progress;
        }

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
        apiKey: string,
        modelName: string
    ): Promise<OptimizedBullet[]> {
        this.logger.log(`[DEBUG] optimizeSlideContent called: title="${title.substring(0, 50)}", rawContent=${rawContent?.length || 0} chars, apiKey=${apiKey?.length || 0} chars, model=${modelName}`);

        if (!rawContent || !apiKey) {
            this.logger.warn(`[SKIP] Content optimization skipped: rawContent=${!!rawContent}, apiKey=${!!apiKey}`);
            return [];
        }

        try {
            // Build prompt using slides.design template
            this.logger.log(`[DEBUG] Building prompt with slides.design template...`);
            const prompt = await this.promptComposer.buildTaskOnlyPrompt(
                'slides.design',
                { title, content: rawContent }
            );
            this.logger.log(`[DEBUG] Prompt built: ${prompt?.length || 0} chars`);

            // Call Gemini
            this.logger.log(`[DEBUG] Calling Gemini with model ${modelName}...`);
            const result = await this.gemini.generateTextWithModel(prompt, modelName, apiKey);
            this.logger.log(`[DEBUG] Gemini response: ${result?.length || 0} chars, preview: ${result?.substring(0, 200) || 'null'}`);

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
     * Generate PPTX file by calling Python service
     */
    async generatePptx(
        lessonId: string,
        templateId: string,
        userId: string
    ): Promise<Buffer> {
        this.logger.log(`Generating PPTX for lesson ${lessonId} with template ${templateId}`);

        // Get lesson with slides
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

        // Get template path and background URLs
        const templateInfo = await this.getTemplateInfo(templateId, userId);
        const templatePath = templateInfo.fileUrl || 'blank';

        // Convert background URLs to local paths for Python service
        const titleBgPath = templateInfo.titleBgUrl ? this.getLocalPath(templateInfo.titleBgUrl) : undefined;
        const contentBgPath = templateInfo.contentBgUrl ? this.getLocalPath(templateInfo.contentBgUrl) : undefined;

        this.logger.log(`[PPTX] Template: ${templatePath}`);
        this.logger.log(`[PPTX] Title BG URL: ${templateInfo.titleBgUrl || 'none'}`);
        this.logger.log(`[PPTX] Title BG Path: ${titleBgPath || 'none'}`);
        this.logger.log(`[PPTX] Title BG Exists: ${titleBgPath ? require('fs').existsSync(titleBgPath) : false}`);
        this.logger.log(`[PPTX] Content BG URL: ${templateInfo.contentBgUrl || 'none'}`);
        this.logger.log(`[PPTX] Content BG Path: ${contentBgPath || 'none'}`);
        this.logger.log(`[PPTX] Content BG Exists: ${contentBgPath ? require('fs').existsSync(contentBgPath) : false}`);

        // Build slide content for Python service
        // IMPORTANT: Use optimizedContentJson (AI-generated) if available, fallback to original content
        // NOTE: audioUrl is stored directly on the Slide model (not SlideAudio table)
        const slideContents: SlideContent[] = lesson.slides.map(slide => {
            const audioPath = slide.audioUrl ? this.getLocalPath(slide.audioUrl) : undefined;
            this.logger.log(`[PPTX] Slide ${slide.slideIndex}: audioUrl=${slide.audioUrl || 'NULL'}, audioPath=${audioPath || 'NULL'}`);

            // Parse optimized content if available - send structured bullets to Python
            let bullets: OptimizedBullet[] | undefined;
            let contentArray: string[] = [];

            if (slide.optimizedContentJson) {
                try {
                    bullets = JSON.parse(slide.optimizedContentJson) as OptimizedBullet[];
                    // Also create flat content as fallback
                    contentArray = bullets.map(b => b.point
                        ? `${b.emoji} ${b.point}: ${b.description}`
                        : b.description
                    );
                    this.logger.log(`[PPTX] Slide ${slide.slideIndex}: Sending ${bullets.length} structured bullets`);
                } catch (e) {
                    this.logger.warn(`[PPTX] Failed to parse optimizedContentJson for slide ${slide.slideIndex}`);
                    contentArray = this.parseContent(slide.content);
                }
            } else {
                contentArray = this.parseContent(slide.content);
                this.logger.log(`[PPTX] Slide ${slide.slideIndex}: Using original content (no AI optimization)`);
            }

            // DEBUG: Log image path conversion
            const imagePath = slide.imageUrl ? this.getLocalPath(slide.imageUrl) : undefined;
            this.logger.log(`[PPTX] Slide ${slide.slideIndex}: imageUrl=${slide.imageUrl || 'NULL'}, imagePath=${imagePath || 'NULL'}`);

            return {
                slideIndex: slide.slideIndex,
                title: slide.title,
                content: contentArray,
                bullets,  // Send structured bullets for proper rendering
                imagePath,
                audioPath,
                speakerNote: slide.speakerNote || '',
                slideType: slide.slideType || 'content',
            };
        });

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
