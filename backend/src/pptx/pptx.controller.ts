import {
    Controller,
    Get,
    Post,
    Param,
    Body,
    Res,
    UseGuards,
    Request,
    Sse,
    MessageEvent,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable } from 'rxjs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PptxService, GenerationProgress } from './pptx.service';
import { GeneratePptxDto } from './dto/generate-pptx.dto';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { APIService } from '@prisma/client';

@Controller('lessons/:lessonId/pptx')
@UseGuards(JwtAuthGuard)
export class PptxController {
    constructor(
        private pptxService: PptxService,
        private apiKeysService: ApiKeysService,
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
        return new Observable<MessageEvent>((subscriber) => {
            (async () => {
                try {
                    for await (const progress of generator) {
                        subscriber.next({ data: progress });
                    }
                    subscriber.complete();
                } catch (error) {
                    subscriber.error(error);
                }
            })();
        });
    }

    /**
     * Generate and download PPTX file
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
            req.user.id
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
