import {
    Controller,
    Get,
    Post,
    Delete,
    Query,
    Param,
    Body,
    Res,
    UseGuards,
    Request,
    Sse,
    MessageEvent,
    HttpException,
    HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable } from 'rxjs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PptxService, GenerationProgress } from './pptx.service';
import { GeneratePptxDto } from './dto/generate-pptx.dto';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { GenerationJobService } from '../generation-job/generation-job.service';
import { APIService } from '@prisma/client';

@Controller('lessons/:lessonId/pptx')
@UseGuards(JwtAuthGuard)
export class PptxController {
    constructor(
        private pptxService: PptxService,
        private apiKeysService: ApiKeysService,
        private jobService: GenerationJobService,
    ) { }

    /**
     * DEBUG: Test API key retrieval
     */
    @Get('debug-api-key')
    async debugApiKey(@Request() req) {
        const userId = req.user.id;

        // Test with string vs enum
        const keyWithString = await this.apiKeysService.getActiveKey(userId, 'GEMINI' as APIService);
        const keyWithEnum = await this.apiKeysService.getActiveKey(userId, APIService.GEMINI);

        return {
            userId,
            keyWithString: keyWithString ? `Found (${keyWithString.length} chars)` : 'NULL',
            keyWithEnum: keyWithEnum ? `Found (${keyWithEnum.length} chars)` : 'NULL',
            envKey: process.env.GEMINI_API_KEY ? 'Present in env' : 'NOT in env',
        };
    }

    /**
     * DEBUG: Check if slides.design prompt exists in DB
     */
    @Get('debug-prompt')
    async debugPrompt() {
        try {
            // Try to find slides.design prompt
            const promptComposer = this.pptxService['promptComposer'];
            const testPrompt = await promptComposer.buildTaskOnlyPrompt('slides.design', {
                title: 'Test Title',
                content: 'Test content bullet 1\nTest content bullet 2'
            });

            return {
                status: 'SUCCESS',
                promptLength: testPrompt?.length || 0,
                promptPreview: testPrompt?.substring(0, 500),
            };
        } catch (error) {
            return {
                status: 'ERROR',
                error: error.message,
                hint: 'Prompt slides.design may not be seeded. Call POST /admin/prompts/seed first.',
            };
        }
    }

    /**
     * DEBUG: Direct test of AI content optimization
     */
    @Get('debug-optimize')
    async debugOptimize(@Param('lessonId') lessonId: string, @Request() req): Promise<any> {
        try {
            const userId = req.user.id;
            const apiKey = await this.apiKeysService.getActiveKey(userId, APIService.GEMINI);

            const slides = await this.pptxService['prisma'].slide.findMany({
                where: { lessonId },
                take: 1,
                orderBy: { slideIndex: 'asc' },
            });

            if (!slides.length) return { error: 'No slides found' };

            const slide = slides[0];
            const modelConfig = await this.pptxService['modelConfig'].getModelForTask(userId, 'SLIDES');

            const result = await this.pptxService['optimizeSlideContent'](
                slide.title,
                slide.content || '',
                apiKey || '',
                modelConfig.modelName
            );

            return {
                slideTitle: slide.title,
                slideContentPreview: slide.content?.substring(0, 200),
                apiKeyLength: apiKey?.length || 0,
                modelName: modelConfig.modelName,
                optimizedBullets: result,
                bulletCount: result.length,
            };
        } catch (error) {
            return { error: error.message, stack: error.stack?.substring(0, 500) };
        }
    }

    /**
     * Get available templates (system + user)
     */
    @Get('templates')
    async getTemplates(@Request() req) {
        return this.pptxService.getTemplates(req.user.id);
    }

    /**
     * Get generation status
     */
    @Get('status')
    getStatus(@Param('lessonId') lessonId: string) {
        return this.pptxService.getStatus(lessonId);
    }

    /**
     * Generate images for all slides with SSE progress updates
     */
    @Sse('generate-images')
    generateImages(
        @Param('lessonId') lessonId: string,
        @Request() req
    ): Observable<MessageEvent> {
        const generator = this.pptxService.generateImagesStream(lessonId, req.user.id);

        // Stream each item as it's generated (real-time progress)
        // Includes heartbeat to prevent proxy/browser from closing idle SSE connection
        return new Observable<MessageEvent>((subscriber) => {
            let lastProgress: any = null;
            let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

            // Send heartbeat every 15 seconds to keep SSE connection alive
            heartbeatInterval = setInterval(() => {
                if (lastProgress) {
                    subscriber.next({ data: lastProgress });
                }
            }, 15000);

            (async () => {
                try {
                    for await (const progress of generator) {
                        lastProgress = progress;
                        subscriber.next({ data: progress });
                    }
                    if (heartbeatInterval) clearInterval(heartbeatInterval);
                    subscriber.complete();
                } catch (error) {
                    if (heartbeatInterval) clearInterval(heartbeatInterval);
                    subscriber.error(error);
                }
            })();

            // Cleanup on unsubscribe
            return () => {
                if (heartbeatInterval) clearInterval(heartbeatInterval);
            };
        });
    }

    /**
     * Start background packaging job with real-time slide-by-slide progress
     */
    @Post('start-packaging')
    async startPackaging(
        @Param('lessonId') lessonId: string,
        @Body() dto: GeneratePptxDto,
        @Request() req,
    ) {
        const userId = req.user.id;

        // Check if there is already an active packaging job
        const activeJob = await this.jobService.getActiveJob(lessonId, 'pptx-packaging');
        if (activeJob) {
            return { jobId: activeJob.id, status: 'processing' };
        }

        // Clean up any stale temp files before starting new packaging
        this.pptxService.cleanupTempPptx(lessonId);

        const job = await this.jobService.createJob({
            type: 'pptx-packaging',
            lessonId,
            userId,
        });

        setImmediate(() => {
            this.pptxService.packagePresentationWithJob(
                job.id,
                lessonId,
                dto.templateId,
                userId,
                dto.skipAudio
            );
        });

        return { jobId: job.id, status: 'processing' };
    }

    /**
     * Check if temporary PPTX files are available for download
     */
    @Get('temp-status')
    async getTempStatus(@Param('lessonId') lessonId: string) {
        return this.pptxService.getAvailableTempFiles(lessonId);
    }

    /**
     * Download temporary PPTX file
     */
    @Get('download-temp')
    async downloadTemp(
        @Param('lessonId') lessonId: string,
        @Query('fileKey') fileKey: string,
        @Res() res: Response,
    ) {
        if (!fileKey) {
            throw new HttpException('fileKey is required', HttpStatus.BAD_REQUEST);
        }

        const { filePath } = this.pptxService.getTempPptxFile(lessonId, fileKey);

        const lesson = await this.pptxService['prisma'].lesson.findUnique({
            where: { id: lessonId },
            select: { title: true },
        });

        const safeTitle = (lesson?.title || 'presentation')
            .replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF ]/g, '_')
            .replace(/\s+/g, '_')
            .substring(0, 50);

        const filename = `${safeTitle}.pptx`;

        res.download(filePath, filename);
    }

    /**
     * Immediately cleanup temporary PPTX files when user navigates away or switches feature
     */
    @Delete('cleanup-temp')
    async cleanupTemp(
        @Param('lessonId') lessonId: string,
        @Query('fileKey') fileKey?: string,
    ) {
        return this.pptxService.cleanupTempPptx(lessonId, fileKey);
    }

    /**
     * Generate and download PPTX file (Legacy synchronous endpoint)
     */
    @Post('generate')
    async generatePptx(
        @Param('lessonId') lessonId: string,
        @Body() dto: GeneratePptxDto,
        @Request() req,
        @Res() res: Response,
    ) {
        const buffer = await this.pptxService.generatePptx(
            lessonId,
            dto.templateId,
            req.user.id,
            dto.skipAudio
        );

        // Get lesson title for filename
        const lesson = await this.pptxService['prisma'].lesson.findUnique({
            where: { id: lessonId },
            select: { title: true },
        });

        const filename = `${lesson?.title || 'presentation'}.pptx`;

        res.set({
            'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
            'Content-Length': buffer.length,
        });

        res.send(buffer);
    }
}

