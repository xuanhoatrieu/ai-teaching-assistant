import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GeminiService } from '../ai/gemini.service';
import { ExportService, ExportResult } from '../export/export.service';
import { LessonStatus, ContentType, ContentStatus } from '@prisma/client';

/**
 * Generation Processor - orchestrates the full content generation flow:
 * 1. Get lesson outline
 * 2. Generate AI content (slides, handout, quiz)
 * 3. Export to files (PPTX, DOCX, Excel)
 * 4. Store file URLs
 * 5. Update lesson status
 */
@Injectable()
export class GenerationProcessorService {
    private readonly logger = new Logger(GenerationProcessorService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly geminiService: GeminiService,
        private readonly exportService: ExportService,
    ) { }

    /**
     * Process generation for a lesson
     */
    async processLesson(lessonId: string): Promise<void> {
        this.logger.log(`Starting generation for lesson: ${lessonId}`);

        try {
            // 1. Get lesson with outline
            const lesson = await this.prisma.lesson.findUnique({
                where: { id: lessonId },
                include: { subject: true },
            });

            if (!lesson) {
                throw new Error(`Lesson not found: ${lessonId}`);
            }

            if (!lesson.outlineRaw) {
                throw new Error('Lesson has no outline');
            }

            // 2. Update status to PROCESSING
            await this.updateLessonStatus(lessonId, LessonStatus.PROCESSING);

            // 3. Generate all content
            const results = await this.exportService.generateAll({
                lessonTitle: lesson.title,
                outline: lesson.outlineRaw,
                generatePptx: true,
                generateHandout: true,
                generateQuizExcel: true,
                generateQuizWord: true,
                questionCount: 10,
            });

            // 4. Store generated content records
            for (const result of results) {
                await this.storeContent(lessonId, result);
            }

            // 5. Update status to COMPLETED
            await this.updateLessonStatus(lessonId, LessonStatus.COMPLETED);

            this.logger.log(`Generation completed for lesson: ${lessonId}`);
        } catch (error) {
            this.logger.error(`Generation failed for lesson ${lessonId}: ${error}`);
            await this.updateLessonStatus(lessonId, LessonStatus.FAILED);
            throw error;
        }
    }

    /**
     * Store generated content
     */
    private async storeContent(lessonId: string, result: ExportResult): Promise<void> {
        // For now, store as base64 data URL
        // In production, upload to MinIO and store the URL
        const fileUrl = `data:${result.mimeType};base64,${result.buffer.toString('base64')}`;

        await this.prisma.generatedContent.create({
            data: {
                lessonId,
                type: result.contentType,
                status: ContentStatus.COMPLETED,
                contentJson: JSON.stringify({ filename: result.filename }),
                fileUrl,
            },
        });

        this.logger.debug(`Stored content: ${result.filename}`);
    }

    /**
     * Update lesson status
     */
    private async updateLessonStatus(lessonId: string, status: LessonStatus): Promise<void> {
        await this.prisma.lesson.update({
            where: { id: lessonId },
            data: { status },
        });
    }

    /**
     * Get generation progress
     */
    async getProgress(lessonId: string) {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
            include: {
                generatedContents: {
                    orderBy: { createdAt: 'asc' },
                },
            },
        });

        if (!lesson) {
            throw new Error(`Lesson not found: ${lessonId}`);
        }

        return {
            lessonId,
            status: lesson.status,
            contents: lesson.generatedContents.map(c => {
                const meta = c.contentJson ? JSON.parse(c.contentJson) : {};
                return {
                    id: c.id,
                    type: c.type,
                    status: c.status,
                    fileUrl: c.fileUrl,
                    fileName: meta.filename || null,
                    createdAt: c.createdAt,
                };
            }),
        };
    }
}
