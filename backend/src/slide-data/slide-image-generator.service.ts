import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ImagenService, GeneratedImage } from '../ai/imagen.service';
import { FileStorageService } from '../file-storage/file-storage.service';
import { ModelConfigService } from '../model-config/model-config.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { Slide, APIService } from '@prisma/client';


interface ImageGenerationResult {
    slideIndex: number;
    imageUrl: string;
    imagePrompt: string;
    success: boolean;
    error?: string;
}

@Injectable()
export class SlideImageGeneratorService {
    private readonly logger = new Logger(SlideImageGeneratorService.name);

    constructor(
        private prisma: PrismaService,
        private imagenService: ImagenService,
        private fileStorageService: FileStorageService,
        private modelConfigService: ModelConfigService,
        private apiKeysService: ApiKeysService,
    ) { }

    /**
     * Generate image for a single slide
     */
    async generateImageForSlide(
        lessonId: string,
        slideIndex: number,
        userId: string,
    ): Promise<Slide> {
        this.logger.log(`Generating image for lesson ${lessonId}, slide ${slideIndex}`);

        // Get the slide
        const slide = await this.prisma.slide.findUnique({
            where: {
                lessonId_slideIndex: { lessonId, slideIndex },
            },
        });

        if (!slide) {
            throw new NotFoundException(`Slide ${slideIndex} not found in lesson ${lessonId}`);
        }

        // Use visualIdea OR imagePrompt as source (AI may output either)
        const visualSource = slide.visualIdea || slide.imagePrompt;
        if (!visualSource) {
            // Fall back to generating from title if no explicit visual idea/prompt
            this.logger.warn(`Slide ${slideIndex} has no visualIdea or imagePrompt - generating from title`);
        }

        // Build image prompt from visualSource and title
        const imagePrompt = visualSource
            ? this.buildImagePrompt(visualSource, slide.title)
            : `Educational slide illustration for "${slide.title}". Style: Clean, professional, suitable for academic presentation.`;

        // Get model config and API key for IMAGE task
        const modelConfig = await this.modelConfigService.getModelForTask(userId, 'IMAGE');
        const apiKey = await this.apiKeysService.getActiveKey(userId, APIService.GEMINI);

        // DEBUG: Log API key retrieval result
        this.logger.log(`[DEBUG] Slide ${slideIndex} - userId: ${userId}`);
        this.logger.log(`[DEBUG] Slide ${slideIndex} - modelConfig: ${modelConfig.modelName}`);
        this.logger.log(`[DEBUG] Slide ${slideIndex} - apiKey from DB: ${apiKey ? `present (${apiKey.length} chars)` : 'NULL - will try env'}`);

        // Fallback to environment variable if no user key
        let effectiveApiKey = apiKey;
        if (!effectiveApiKey) {
            effectiveApiKey = process.env.GEMINI_API_KEY || null;
            this.logger.log(`[DEBUG] Slide ${slideIndex} - env GEMINI_API_KEY: ${effectiveApiKey ? `present (${effectiveApiKey.length} chars)` : 'NULL'}`);
        }

        // Generate image using Imagen with user's configured model
        this.logger.log(`[DEBUG] Slide ${slideIndex} - Calling imagenService.generateImage with apiKey=${effectiveApiKey ? 'present' : 'NULL'}`);
        const generatedImage = await this.imagenService.generateImage(
            imagePrompt,
            '16:9',
            modelConfig.modelName,
            effectiveApiKey || undefined
        );

        // Convert base64 to Buffer
        const imageBuffer = Buffer.from(generatedImage.base64, 'base64');

        // Determine file extension from mimeType
        const extension = this.getExtensionFromMimeType(generatedImage.mimeType);

        // Save to file storage
        const { publicUrl } = await this.fileStorageService.saveImageFile(
            userId,
            lessonId,
            slideIndex,
            imageBuffer,
            extension,
        );

        // Update slide with imageUrl and imagePrompt
        const updatedSlide = await this.prisma.slide.update({
            where: {
                lessonId_slideIndex: { lessonId, slideIndex },
            },
            data: {
                imageUrl: publicUrl,
                imagePrompt: imagePrompt,
                status: 'image_generated',
            },
        });

        this.logger.log(`Image saved for slide ${slideIndex}: ${publicUrl}`);
        return updatedSlide;
    }

    /**
     * Generate images for all slides in a lesson that have visualIdea
     */
    async generateAllImages(
        lessonId: string,
        userId: string,
    ): Promise<ImageGenerationResult[]> {
        this.logger.log(`Generating images for all slides in lesson ${lessonId}`);

        // Get all slides with visualIdea OR imagePrompt (AI may output either field)
        const slides = await this.prisma.slide.findMany({
            where: {
                lessonId,
                OR: [
                    { visualIdea: { not: null } },
                    { imagePrompt: { not: null } },
                ],
            },
            orderBy: { slideIndex: 'asc' },
        });

        if (slides.length === 0) {
            this.logger.warn(`No slides with visualIdea or imagePrompt found in lesson ${lessonId}`);
            return [];
        }

        const results: ImageGenerationResult[] = [];

        // Generate images sequentially to avoid rate limiting
        for (const slide of slides) {
            try {
                const updatedSlide = await this.generateImageForSlide(
                    lessonId,
                    slide.slideIndex,
                    userId,
                );
                results.push({
                    slideIndex: slide.slideIndex,
                    imageUrl: updatedSlide.imageUrl || '',
                    imagePrompt: updatedSlide.imagePrompt || '',
                    success: true,
                });
            } catch (error) {
                this.logger.error(`Failed to generate image for slide ${slide.slideIndex}: ${error.message}`);
                results.push({
                    slideIndex: slide.slideIndex,
                    imageUrl: '',
                    imagePrompt: '',
                    success: false,
                    error: error.message,
                });
            }
        }

        const successCount = results.filter(r => r.success).length;
        this.logger.log(`Generated ${successCount}/${slides.length} images for lesson ${lessonId}`);

        return results;
    }

    /**
     * Build an optimized image prompt from visualIdea and slide title
     */
    buildImagePrompt(visualIdea: string, slideTitle: string): string {
        // Combine title context with visualIdea for better prompt
        const cleanVisualIdea = visualIdea
            .replace(/^\[Visual Idea\]:\s*/i, '')
            .replace(/^\*\*\[Visual Idea\]\*\*:\s*/i, '')
            .trim();

        // Add educational context and style hints
        const prompt = `Educational slide illustration for "${slideTitle}": ${cleanVisualIdea}. Style: Clean, professional, suitable for academic presentation, high quality illustration.`;

        return prompt;
    }

    /**
     * Get file extension from MIME type
     */
    private getExtensionFromMimeType(mimeType: string): string {
        const mimeMap: Record<string, string> = {
            'image/png': 'png',
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/webp': 'webp',
            'image/svg+xml': 'svg',
        };
        return mimeMap[mimeType] || 'png';
    }

    /**
     * Get user ID from lesson (through subject)
     */
    async getUserIdFromLesson(lessonId: string): Promise<string> {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
            include: {
                subject: {
                    select: { userId: true },
                },
            },
        });

        if (!lesson) {
            throw new NotFoundException(`Lesson ${lessonId} not found`);
        }

        return lesson.subject.userId;
    }
}
