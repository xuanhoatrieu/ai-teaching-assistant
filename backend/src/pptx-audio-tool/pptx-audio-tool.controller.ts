import {
    Controller,
    Post,
    Get,
    Put,
    Delete,
    Param,
    Body,
    Req,
    Res,
    UseGuards,
    UploadedFile,
    UseInterceptors,
    Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PptxAudioToolService } from './pptx-audio-tool.service';
import { GenerationJobService } from '../generation-job/generation-job.service';
import type { Request, Response } from 'express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import * as ExcelJS from 'exceljs';

// Configure multer for PPTX uploads
const pptxStorage = diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(process.cwd(), 'uploads', 'pptx-tool', 'temp');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(7)}.pptx`;
        cb(null, uniqueName);
    },
});

@Controller('pptx-audio-tool')
@UseGuards(JwtAuthGuard)
export class PptxAudioToolController {
    private readonly logger = new Logger(PptxAudioToolController.name);

    constructor(
        private readonly service: PptxAudioToolService,
        private readonly jobService: GenerationJobService,
    ) {}

    // 0. List all sessions for current user
    @Get()
    async listSessions(@Req() req: Request) {
        const userId = (req as any).user?.id || (req as any).user?.sub;
        return this.service.listSessions(userId);
    }

    // 1. Upload PPTX → parse → create session
    @Post('upload')
    @UseInterceptors(FileInterceptor('file', { storage: pptxStorage }))
    async upload(
        @UploadedFile() file: Express.Multer.File,
        @Req() req: Request,
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;
        this.logger.log(`Upload PPTX: ${file.originalname} by user ${userId}`);
        return this.service.uploadAndParse(file, userId);
    }

    // 2. Get session info
    @Get(':sessionId')
    async getSession(@Param('sessionId') sessionId: string) {
        return this.service.getSession(sessionId);
    }

    // 3. Get parsed slides with notes + audio status
    @Get(':sessionId/slides')
    async getSlides(@Param('sessionId') sessionId: string) {
        return this.service.getSlides(sessionId);
    }

    // 4. Toggle language (EN/VN)
    @Put(':sessionId/language')
    async setLanguage(
        @Param('sessionId') sessionId: string,
        @Body('language') language: string,
    ) {
        return this.service.setLanguage(sessionId, language as 'en' | 'vi');
    }

    // 5. Edit speaker note for a slide
    @Put(':sessionId/slides/:index/note')
    async updateNote(
        @Param('sessionId') sessionId: string,
        @Param('index') index: string,
        @Body('note') note: string,
    ) {
        return this.service.updateNote(sessionId, parseInt(index), note);
    }

    // 6. Generate audio for single slide
    @Post(':sessionId/slides/:index/generate-audio')
    async generateAudio(
        @Param('sessionId') sessionId: string,
        @Param('index') index: string,
        @Req() req: Request,
        @Body() body: { multilingualMode?: string; vittsMode?: string; vittsDesignInstruct?: string; vittsNormalize?: boolean },
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;
        return this.service.generateAudio(sessionId, parseInt(index), userId, body);
    }

    // 7. Generate audio for ALL slides (Background Job)
    @Post(':sessionId/generate-all-audio')
    async generateAllAudio(
        @Param('sessionId') sessionId: string,
        @Req() req: Request,
        @Body() body: { multilingualMode?: string; vittsMode?: string; vittsDesignInstruct?: string; vittsNormalize?: boolean },
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;

        // Check if there is already an active job
        const activeJob = await this.jobService.getActiveJob(sessionId, 'pptx-tool-generate-all-audio');
        if (activeJob) {
            this.logger.log(`Active audio job ${activeJob.id} already exists for session ${sessionId}. Re-attaching.`);
            return { jobId: activeJob.id, status: 'processing' };
        }

        const slides = await this.service.getSlides(sessionId);
        const session = await this.service.getSession(sessionId);
        const toGenerate = slides.filter(s => {
            const note = session.language === 'en' ? s.noteEN : s.noteVN;
            return note?.trim() && s.audioStatus !== 'done';
        });

        const job = await this.jobService.createJob({
            type: 'pptx-tool-generate-all-audio',
            lessonId: sessionId,
            userId,
            total: toGenerate.length,
        });

        setImmediate(async () => {
            try {
                await this.service.generateAllAudioBackground(job.id, sessionId, userId, body);
            } catch (err: any) {
                this.logger.error(`[generateAllAudio] Job ${job.id} failed: ${err.message}`);
                await this.jobService.failJob(job.id, err.message);
            }
        });

        return { jobId: job.id, status: 'pending' };
    }

    // 8. Delete audio for a slide
    @Delete(':sessionId/slides/:index/audio')
    async deleteAudio(
        @Param('sessionId') sessionId: string,
        @Param('index') index: string,
    ) {
        return this.service.deleteAudio(sessionId, parseInt(index));
    }

    // 9. Download PPTX with injected audio
    @Get(':sessionId/download')
    async downloadPptx(
        @Param('sessionId') sessionId: string,
        @Res() res: Response,
    ) {
        const result = await this.service.downloadPptxWithAudio(sessionId);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(result.filename)}"`);
        res.send(result.buffer);
    }

    // 10. Get all questions across all 3 tabs
    @Get(':sessionId/all-questions')
    async getAllQuestions(@Param('sessionId') sessionId: string) {
        return this.service.getSessionQuestions(sessionId);
    }

    // ─────────────────────────────────────────────────────────────
    // 10A. REVIEW QUESTIONS
    // ─────────────────────────────────────────────────────────────

    @Post(':sessionId/review-questions/generate')
    async generateReviewQuestions(
        @Param('sessionId') sessionId: string,
        @Req() req: Request,
        @Body() body: { level1?: number; level2?: number; level3?: number; level1Count?: number; level2Count?: number; level3Count?: number },
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;

        const activeJob = await this.jobService.getActiveJob(sessionId, 'pptx-tool-review-questions');
        if (activeJob) {
            return { jobId: activeJob.id, status: 'processing' };
        }

        const counts = {
            level1Count: body.level1 ?? body.level1Count ?? 20,
            level2Count: body.level2 ?? body.level2Count ?? 20,
            level3Count: body.level3 ?? body.level3Count ?? 10,
        };
        const total = counts.level1Count + counts.level2Count + counts.level3Count;

        const job = await this.jobService.createJob({
            type: 'pptx-tool-review-questions',
            lessonId: sessionId,
            userId,
            total,
            payload: counts,
        });

        setImmediate(async () => {
            try {
                await this.service.generateReviewQuestionsBackground(job.id, sessionId, userId, counts, false);
            } catch (err: any) {
                this.logger.error(`[generateReviewQuestions] Job ${job.id} failed: ${err.message}`);
                await this.jobService.failJob(job.id, err.message);
            }
        });

        return { jobId: job.id, status: 'pending' };
    }

    @Post(':sessionId/review-questions/append')
    async appendReviewQuestions(
        @Param('sessionId') sessionId: string,
        @Req() req: Request,
        @Body() body: { level1?: number; level2?: number; level3?: number; level1Count?: number; level2Count?: number; level3Count?: number },
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;

        const activeJob = await this.jobService.getActiveJob(sessionId, 'pptx-tool-append-review-questions');
        if (activeJob) {
            return { jobId: activeJob.id, status: 'processing' };
        }

        const counts = {
            level1Count: body.level1 ?? body.level1Count ?? 20,
            level2Count: body.level2 ?? body.level2Count ?? 20,
            level3Count: body.level3 ?? body.level3Count ?? 10,
        };
        const total = counts.level1Count + counts.level2Count + counts.level3Count;

        const job = await this.jobService.createJob({
            type: 'pptx-tool-append-review-questions',
            lessonId: sessionId,
            userId,
            total,
            payload: counts,
        });

        setImmediate(async () => {
            try {
                await this.service.generateReviewQuestionsBackground(job.id, sessionId, userId, counts, true);
            } catch (err: any) {
                this.logger.error(`[appendReviewQuestions] Job ${job.id} failed: ${err.message}`);
                await this.jobService.failJob(job.id, err.message);
            }
        });

        return { jobId: job.id, status: 'pending' };
    }

    @Get(':sessionId/review-questions/export/excel')
    async exportReviewExcel(@Param('sessionId') sessionId: string, @Res() res: Response) {
        return this.service.exportReviewQuestionsExcel(sessionId, res);
    }

    @Get(':sessionId/review-questions/export/word')
    async exportReviewWord(@Param('sessionId') sessionId: string, @Res() res: Response) {
        return this.service.exportReviewQuestionsWord(sessionId, res);
    }

    @Get(':sessionId/review-questions/export/moodle-xml')
    async exportReviewMoodleXml(@Param('sessionId') sessionId: string, @Res() res: Response) {
        return this.service.exportReviewQuestionsMoodleXml(sessionId, res);
    }

    @Get(':sessionId/review-questions/template/excel')
    async downloadReviewTemplate(@Res() res: Response) {
        return this.service.downloadReviewTemplate(res);
    }

    @Post(':sessionId/review-questions/import/excel')
    @UseInterceptors(FileInterceptor('file'))
    async importReviewExcel(
        @Param('sessionId') sessionId: string,
        @UploadedFile() file: Express.Multer.File,
    ) {
        return this.service.importReviewQuestionsExcel(sessionId, file);
    }

    // ─────────────────────────────────────────────────────────────
    // 10B. INTERACTIVE QUESTIONS
    // ─────────────────────────────────────────────────────────────

    @Post(':sessionId/interactive-questions/generate')
    async generateInteractiveQuestions(
        @Param('sessionId') sessionId: string,
        @Req() req: Request,
        @Body() body: { count?: number },
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;

        const activeJob = await this.jobService.getActiveJob(sessionId, 'pptx-tool-interactive-questions');
        if (activeJob) {
            return { jobId: activeJob.id, status: 'processing' };
        }

        const count = body.count || 5;
        const job = await this.jobService.createJob({
            type: 'pptx-tool-interactive-questions',
            lessonId: sessionId,
            userId,
            total: count,
            payload: { count },
        });

        setImmediate(async () => {
            try {
                await this.service.generateInteractiveQuestionsBackground(job.id, sessionId, userId, count, false);
            } catch (err: any) {
                this.logger.error(`[generateInteractiveQuestions] Job ${job.id} failed: ${err.message}`);
                await this.jobService.failJob(job.id, err.message);
            }
        });

        return { jobId: job.id, status: 'pending' };
    }

    @Post(':sessionId/interactive-questions/append')
    async appendInteractiveQuestions(
        @Param('sessionId') sessionId: string,
        @Req() req: Request,
        @Body() body: { count?: number },
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;

        const activeJob = await this.jobService.getActiveJob(sessionId, 'pptx-tool-append-interactive-questions');
        if (activeJob) {
            return { jobId: activeJob.id, status: 'processing' };
        }

        const count = body.count || 5;
        const job = await this.jobService.createJob({
            type: 'pptx-tool-append-interactive-questions',
            lessonId: sessionId,
            userId,
            total: count,
            payload: { count },
        });

        setImmediate(async () => {
            try {
                await this.service.generateInteractiveQuestionsBackground(job.id, sessionId, userId, count, true);
            } catch (err: any) {
                this.logger.error(`[appendInteractiveQuestions] Job ${job.id} failed: ${err.message}`);
                await this.jobService.failJob(job.id, err.message);
            }
        });

        return { jobId: job.id, status: 'pending' };
    }

    @Get(':sessionId/interactive-questions/export/excel')
    async exportInteractiveExcel(@Param('sessionId') sessionId: string, @Res() res: Response) {
        return this.service.exportInteractiveQuestionsExcel(sessionId, res);
    }

    @Get(':sessionId/interactive-questions/export/word')
    async exportInteractiveWord(@Param('sessionId') sessionId: string, @Res() res: Response) {
        return this.service.exportInteractiveQuestionsWord(sessionId, res);
    }

    // ─────────────────────────────────────────────────────────────
    // 10C. ENGLISH QUESTIONS
    // ─────────────────────────────────────────────────────────────

    @Post(':sessionId/english-questions/generate')
    async generateEnglishQuestions(
        @Param('sessionId') sessionId: string,
        @Req() req: Request,
        @Body() body: { level1?: number; level2?: number; level3?: number; questionTypes?: string[]; subDiscipline?: string },
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;

        const activeJob = await this.jobService.getActiveJob(sessionId, 'pptx-tool-english-questions');
        if (activeJob) {
            return { jobId: activeJob.id, status: 'processing' };
        }

        const total = (body.level1 || 4) + (body.level2 || 3) + (body.level3 || 3);
        const job = await this.jobService.createJob({
            type: 'pptx-tool-english-questions',
            lessonId: sessionId,
            userId,
            total,
            payload: body,
        });

        setImmediate(async () => {
            try {
                await this.service.generateEnglishQuestionsBackground(job.id, sessionId, userId, body, false);
            } catch (err: any) {
                this.logger.error(`[generateEnglishQuestions] Job ${job.id} failed: ${err.message}`);
                await this.jobService.failJob(job.id, err.message);
            }
        });

        return { jobId: job.id, status: 'pending' };
    }

    @Post(':sessionId/english-questions/append')
    async appendEnglishQuestions(
        @Param('sessionId') sessionId: string,
        @Req() req: Request,
        @Body() body: { level1?: number; level2?: number; level3?: number; questionTypes?: string[]; subDiscipline?: string },
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;

        const activeJob = await this.jobService.getActiveJob(sessionId, 'pptx-tool-append-english-questions');
        if (activeJob) {
            return { jobId: activeJob.id, status: 'processing' };
        }

        const total = (body.level1 || 4) + (body.level2 || 3) + (body.level3 || 3);
        const job = await this.jobService.createJob({
            type: 'pptx-tool-append-english-questions',
            lessonId: sessionId,
            userId,
            total,
            payload: body,
        });

        setImmediate(async () => {
            try {
                await this.service.generateEnglishQuestionsBackground(job.id, sessionId, userId, body, true);
            } catch (err: any) {
                this.logger.error(`[appendEnglishQuestions] Job ${job.id} failed: ${err.message}`);
                await this.jobService.failJob(job.id, err.message);
            }
        });

        return { jobId: job.id, status: 'pending' };
    }

    @Get(':sessionId/english-questions/export/moodle-xml')
    async exportEnglishMoodleXml(@Param('sessionId') sessionId: string, @Res() res: Response) {
        return this.service.exportEnglishQuestionsMoodleXml(sessionId, res);
    }

    @Get(':sessionId/english-questions/export/excel')
    async exportEnglishExcel(@Param('sessionId') sessionId: string, @Res() res: Response) {
        return this.service.exportEnglishQuestionsExcel(sessionId, res);
    }

    @Get(':sessionId/english-questions/export/word')
    async exportEnglishWord(@Param('sessionId') sessionId: string, @Res() res: Response) {
        return this.service.exportEnglishQuestionsWord(sessionId, res);
    }

    // ─────────────────────────────────────────────────────────────
    // 10D. QUESTION CRUD
    // ─────────────────────────────────────────────────────────────

    @Put(':sessionId/questions/:type/:id')
    async updateQuestion(
        @Param('sessionId') sessionId: string,
        @Param('type') type: 'review' | 'interactive' | 'english',
        @Param('id') id: string,
        @Body() body: any,
    ) {
        return this.service.updateQuestion(sessionId, type, id, body);
    }

    @Delete(':sessionId/questions/:type/:id')
    async deleteQuestion(
        @Param('sessionId') sessionId: string,
        @Param('type') type: 'review' | 'interactive' | 'english',
        @Param('id') id: string,
    ) {
        return this.service.deleteQuestion(sessionId, type, id);
    }

    @Delete(':sessionId/questions/:type')
    async deleteAllQuestions(
        @Param('sessionId') sessionId: string,
        @Param('type') type: 'review' | 'interactive' | 'english',
    ) {
        return this.service.deleteAllQuestions(sessionId, type);
    }

    @Put(':sessionId/questions/:type')
    async updateQuestionsList(
        @Param('sessionId') sessionId: string,
        @Param('type') type: 'review' | 'interactive' | 'english',
        @Body() body: { list: any[] },
    ) {
        return this.service.updateQuestionsList(sessionId, type, body.list);
    }

    // Legacy backward-compatible endpoints
    @Post(':sessionId/generate-questions')
    async generateQuestions(
        @Param('sessionId') sessionId: string,
        @Req() req: Request,
        @Body() body: { level1Count?: number; level2Count?: number; level3Count?: number },
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;
        return this.service.generateReviewQuestions(sessionId, userId, body, false);
    }

    @Get(':sessionId/questions/export/excel')
    async exportQuestionsExcel(
        @Param('sessionId') sessionId: string,
        @Res() res: Response,
    ) {
        return this.service.exportReviewQuestionsExcel(sessionId, res);
    }

    // 12. Delete session and all its data
    @Delete(':sessionId')
    async deleteSession(
        @Param('sessionId') sessionId: string,
        @Req() req: Request,
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;
        return this.service.deleteSession(sessionId, userId);
    }
}
