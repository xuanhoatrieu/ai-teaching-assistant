import {
    Controller,
    Post,
    Get,
    Put,
    Delete,
    Param,
    Query,
    Body,
    Req,
    Res,
    UseGuards,
    UploadedFile,
    UseInterceptors,
    Logger,
    BadRequestException,
    HttpException,
    HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PptxAudioToolService } from './pptx-audio-tool.service';
import type { PptxSubjectDto } from './pptx-audio-tool.service';
import { GenerationJobService } from '../generation-job/generation-job.service';
import { DownloadTicketService } from '../common/download-ticket/download-ticket.service';
import type { Request, Response } from 'express';
import { diskStorage, memoryStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import * as ExcelJS from 'exceljs';
import { fixUtf8Filename } from '../common/string.util';

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

// Configure multer for chunk uploads (temporary staging before moving into session folder)
const chunkStorage = diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(process.cwd(), 'uploads', 'pptx-tool', 'temp-chunks');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `chunk-${Date.now()}-${Math.random().toString(36).substring(7)}.tmp`;
        cb(null, uniqueName);
    },
});

// Configure multer for context document uploads (.docx / .pdf / .txt / .md)
const contextDocStorage = memoryStorage();

@Controller('pptx-audio-tool')
@UseGuards(JwtAuthGuard)
export class PptxAudioToolController {
    private readonly logger = new Logger(PptxAudioToolController.name);

    constructor(
        private readonly service: PptxAudioToolService,
        private readonly jobService: GenerationJobService,
        private readonly tickets: DownloadTicketService,
    ) {}

    // 0. List all sessions for current user
    @Get()
    async listSessions(@Req() req: Request) {
        const userId = (req as any).user?.id || (req as any).user?.sub;
        return this.service.listSessions(userId);
    }

    // 0A. Subject CRUD for PPTX Tool (Independent Subjects)
    @Get('subjects')
    async listSubjects(@Req() req: Request) {
        const userId = (req as any).user?.id || (req as any).user?.sub;
        return this.service.listSubjects(userId);
    }

    @Post('subjects')
    async createSubject(
        @Req() req: Request,
        @Body() body: PptxSubjectDto,
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;
        return this.service.createSubject(userId, body);
    }

    @Put('subjects/:subjectId')
    async updateSubject(
        @Param('subjectId') subjectId: string,
        @Req() req: Request,
        @Body() body: Partial<PptxSubjectDto>,
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;
        return this.service.updateSubject(subjectId, userId, body);
    }

    @Delete('subjects/:subjectId')
    async deleteSubject(
        @Param('subjectId') subjectId: string,
        @Req() req: Request,
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;
        return this.service.deleteSubject(subjectId, userId);
    }

    // 0B. Templates list for SCORM / H5P export
    @Get('templates/list')
    async getTemplates(@Req() req: Request) {
        const userId = (req as any).user?.id || (req as any).user?.sub;
        return this.service.getTemplates(userId);
    }

    // 0C. Extract text from Word / PDF / TXT file (used in Create Lesson modal before session is created)
    @Post('extract-context-file')
    @UseInterceptors(FileInterceptor('file', {
        storage: contextDocStorage,
        limits: { fileSize: 30 * 1024 * 1024 },
    }))
    async extractContextFile(@UploadedFile() file: Express.Multer.File) {
        return this.service.extractTextFromDocument(file);
    }

    // 1. Upload PPTX (single request for small/medium files) → parse → create session
    @Post('upload')
    @UseInterceptors(FileInterceptor('file', { storage: pptxStorage }))
    async upload(
        @UploadedFile() file: Express.Multer.File,
        @Body() body: { pptxSubjectId?: string; lessonTitle?: string; contextText?: string; contextFileName?: string },
        @Req() req: Request,
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;
        if (file?.originalname) {
            file.originalname = fixUtf8Filename(file.originalname);
        }
        this.logger.log(`Upload PPTX: ${file?.originalname} by user ${userId}`);
        return this.service.uploadAndParse(file, userId, {
            pptxSubjectId: body?.pptxSubjectId || null,
            lessonTitle: body?.lessonTitle,
            contextText: body?.contextText,
            contextFileName: body?.contextFileName || null,
        });
    }

    // 1A. Init chunked upload (for large files to bypass Cloudflare 100MB limit)
    @Post('upload-chunk/init')
    async initChunkUpload(
        @Body() body: { fileName: string; fileSize: number; totalChunks: number },
        @Req() req: Request,
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;
        return this.service.initChunkUpload(userId, body.fileName, body.fileSize, body.totalChunks);
    }

    // 1B. Upload single chunk (10MB/chunk)
    @Post('upload-chunk')
    @UseInterceptors(FileInterceptor('chunk', { storage: chunkStorage }))
    async uploadChunk(
        @UploadedFile() chunkFile: Express.Multer.File,
        @Body('uploadId') uploadId: string,
        @Body('chunkIndex') chunkIndex: string,
        @Req() req: Request,
    ) {
        if (!chunkFile) {
            throw new BadRequestException('Mảnh dữ liệu (chunk) không hợp lệ');
        }
        if (!uploadId || chunkIndex === undefined) {
            if (chunkFile?.path && fs.existsSync(chunkFile.path)) {
                fs.unlinkSync(chunkFile.path);
            }
            throw new BadRequestException('Thiếu uploadId hoặc chunkIndex');
        }
        return this.service.saveChunk(uploadId, parseInt(chunkIndex, 10), chunkFile);
    }

    // 1C. Complete chunked upload & merge chunks -> parse -> create session
    @Post('upload-chunk/complete')
    async completeChunkUpload(
        @Body() body: {
            uploadId: string;
            fileName: string;
            totalChunks: number;
            pptxSubjectId?: string;
            lessonTitle?: string;
            contextText?: string;
            contextFileName?: string;
        },
        @Req() req: Request,
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;
        if (!body.uploadId || !body.fileName || !body.totalChunks) {
            throw new BadRequestException('Thiếu thông tin hoàn tất upload');
        }
        return this.service.mergeChunksAndParse(body.uploadId, body.fileName, body.totalChunks, userId, {
            pptxSubjectId: body.pptxSubjectId || null,
            lessonTitle: body.lessonTitle,
            contextText: body.contextText,
            contextFileName: body.contextFileName || null,
        });
    }

    // 2. Get session info
    @Get(':sessionId')
    async getSession(@Param('sessionId') sessionId: string) {
        return this.service.getSession(sessionId);
    }

    // 2A. Update session metadata (lessonTitle, pptxSubjectId, contextText)
    @Put(':sessionId/meta')
    async updateSessionMeta(
        @Param('sessionId') sessionId: string,
        @Req() req: Request,
        @Body() body: {
            lessonTitle?: string;
            pptxSubjectId?: string | null;
            contextText?: string;
            contextFileName?: string | null;
        },
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;
        return this.service.updateSessionMeta(sessionId, userId, body);
    }

    // 2B. Upload context document (.docx / .pdf / .txt / .md) to an existing session
    @Post(':sessionId/context-file')
    @UseInterceptors(FileInterceptor('file', {
        storage: contextDocStorage,
        limits: { fileSize: 30 * 1024 * 1024 },
    }))
    async uploadSessionContextFile(
        @Param('sessionId') sessionId: string,
        @UploadedFile() file: Express.Multer.File,
        @Body('mode') mode: 'replace' | 'append' = 'append',
        @Req() req: Request,
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;
        return this.service.uploadSessionContextFile(sessionId, userId, file, mode || 'append');
    }

    // 3. Get parsed slides with notes + audio status
    @Get(':sessionId/slides')
    async getSlides(@Param('sessionId') sessionId: string) {
        return this.service.getSlides(sessionId);
    }

    // 3A. Create / Insert a new slide (theory or interactive checkpoint)
    @Post(':sessionId/slides')
    async createSlide(
        @Param('sessionId') sessionId: string,
        @Req() req: Request,
        @Body() body: {
            title?: string;
            content?: string | string[];
            speakerNote?: string;
            slideType?: string;
            layoutType?: string;
            interactiveData?: any;
            insertAfterIndex?: number;
        },
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;
        return this.service.createSlide(sessionId, userId, body);
    }

    // 3B. Update slide content / optimized bullets / layout / interactiveData
    @Put(':sessionId/slides/:index/content')
    async updateSlideContent(
        @Param('sessionId') sessionId: string,
        @Param('index') index: string,
        @Req() req: Request,
        @Body() body: {
            title?: string;
            content?: string[] | string;
            optimizedContent?: Array<{ emoji: string; point: string; description: string }> | null;
            speakerNote?: string;
            slideType?: string;
            layoutType?: string;
            interactiveData?: any;
        },
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;
        return this.service.updateSlideContent(sessionId, parseInt(index, 10), userId, body);
    }

    // 3C. Delete a slide
    @Delete(':sessionId/slides/:index')
    async deleteSlide(
        @Param('sessionId') sessionId: string,
        @Param('index') index: string,
        @Req() req: Request,
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;
        return this.service.deleteSlide(sessionId, parseInt(index, 10), userId);
    }

    // 3D. Move slide up or down
    @Post(':sessionId/slides/:index/move')
    async moveSlide(
        @Param('sessionId') sessionId: string,
        @Param('index') index: string,
        @Req() req: Request,
        @Body('direction') direction: 'up' | 'down',
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;
        if (direction !== 'up' && direction !== 'down') {
            throw new BadRequestException('Direction must be "up" or "down"');
        }
        return this.service.moveSlide(sessionId, parseInt(index, 10), userId, direction);
    }

    // 3E. Upload custom cropped slide image
    @Post(':sessionId/slides/:index/upload-image')
    @UseInterceptors(FileInterceptor('image', {
        storage: memoryStorage(),
        limits: { fileSize: 15 * 1024 * 1024 },
    }))
    async uploadSlideImage(
        @Param('sessionId') sessionId: string,
        @Param('index') index: string,
        @UploadedFile() file: Express.Multer.File,
        @Req() req: Request,
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;
        return this.service.uploadCustomSlideImage(sessionId, parseInt(index, 10), userId, file);
    }

    // 3F. Regenerate / optimize slide content with AI
    @Post(':sessionId/slides/:index/regenerate-content')
    async regenerateSlideContent(
        @Param('sessionId') sessionId: string,
        @Param('index') index: string,
        @Req() req: Request,
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;
        return this.service.regenerateSlideContent(sessionId, parseInt(index, 10), userId);
    }

    // 3G. Regenerate slide illustration image with AI
    @Post(':sessionId/slides/:index/regenerate-image')
    async regenerateSlideImage(
        @Param('sessionId') sessionId: string,
        @Param('index') index: string,
        @Req() req: Request,
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;
        return this.service.regenerateSlideImage(sessionId, parseInt(index, 10), userId);
    }

    // 3H. Upload extra sample audio for a slide
    @Post(':sessionId/slides/:index/extra-audio')
    @UseInterceptors(FileInterceptor('audio', {
        storage: memoryStorage(),
        limits: { fileSize: 30 * 1024 * 1024 },
    }))
    async uploadExtraAudio(
        @Param('sessionId') sessionId: string,
        @Param('index') index: string,
        @UploadedFile() file: Express.Multer.File,
        @Req() req: Request,
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;
        return this.service.uploadExtraAudio(sessionId, parseInt(index, 10), userId, file);
    }

    // 3I. Delete extra sample audio from a slide
    @Delete(':sessionId/slides/:index/extra-audio')
    async deleteExtraAudio(
        @Param('sessionId') sessionId: string,
        @Param('index') index: string,
        @Req() req: Request,
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;
        return this.service.deleteExtraAudio(sessionId, parseInt(index, 10), userId);
    }

    // 3J. Generate AI interactive activity / checkpoint quiz for a slide
    @Post(':sessionId/slides/:index/generate-interactions')
    async generateSlideInteractions(
        @Param('sessionId') sessionId: string,
        @Param('index') index: string,
        @Req() req: Request,
        @Body() body: {
            activityType?: string;
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
        const userId = (req as any).user?.id || (req as any).user?.sub;
        return this.service.generateSlideInteractions(
            sessionId,
            parseInt(index, 10),
            userId,
            body?.activityType,
            {
                mode: body?.mode,
                sourceType: body?.sourceType,
                fromSlideIndex: body?.fromSlideIndex,
                toSlideIndex: body?.toSlideIndex,
                customContent: body?.customContent,
                imageBase64: body?.imageBase64,
                selectedQuestionTypes: body?.selectedQuestionTypes,
                questionCount: body?.questionCount,
                passScore: body?.passScore,
                fallbackSlideIndex: body?.fallbackSlideIndex,
                allowContinueWithoutPass: body?.allowContinueWithoutPass,
            },
        );
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
        @Body('language') lang?: 'vi' | 'en',
    ) {
        return this.service.updateNote(sessionId, parseInt(index), note, lang);
    }

    // 5A. Generate speaker notes with AI (Background Job)
    @Post(':sessionId/speaker-notes/generate')
    async generateSpeakerNotes(
        @Param('sessionId') sessionId: string,
        @Req() req: Request,
        @Body() body: { mode?: 'all' | 'missing'; language?: 'vi' | 'en' },
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;

        const activeJob = await this.jobService.getActiveJob(sessionId, 'pptx-tool-speaker-notes');
        if (activeJob) {
            this.logger.log(`Active speaker notes job ${activeJob.id} already exists for session ${sessionId}. Re-attaching.`);
            return { jobId: activeJob.id, status: 'processing' };
        }

        if (body?.language) {
            await this.service.setLanguage(sessionId, body.language).catch(e => this.logger.warn(`Failed to sync language to session: ${e.message}`));
        }

        const job = await this.jobService.createJob({
            type: 'pptx-tool-speaker-notes',
            lessonId: sessionId,
            userId,
        });

        setImmediate(async () => {
            try {
                await this.service.generateSpeakerNotesBackground(job.id, sessionId, userId, body?.mode || 'all', body?.language);
            } catch (err: any) {
                this.logger.error(`[generateSpeakerNotes] Job ${job.id} failed: ${err.message}`);
                await this.jobService.failJob(job.id, err.message);
            }
        });

        return { jobId: job.id, status: 'pending' };
    }

    // 5B. Optimize speaker notes for TTS with AI (Background Job)
    @Post(':sessionId/speaker-notes/optimize')
    async optimizeSpeakerNotes(
        @Param('sessionId') sessionId: string,
        @Req() req: Request,
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;

        const activeJob = await this.jobService.getActiveJob(sessionId, 'pptx-tool-optimize-notes');
        if (activeJob) {
            this.logger.log(`Active optimize notes job ${activeJob.id} already exists for session ${sessionId}. Re-attaching.`);
            return { jobId: activeJob.id, status: 'processing' };
        }

        const job = await this.jobService.createJob({
            type: 'pptx-tool-optimize-notes',
            lessonId: sessionId,
            userId,
        });

        setImmediate(async () => {
            try {
                await this.service.optimizeSpeakerNotesBackground(job.id, sessionId, userId);
            } catch (err: any) {
                this.logger.error(`[optimizeSpeakerNotes] Job ${job.id} failed: ${err.message}`);
                await this.jobService.failJob(job.id, err.message);
            }
        });

        return { jobId: job.id, status: 'pending' };
    }

    // 5C. Import speaker notes from parsed TXT array
    @Post(':sessionId/speaker-notes/import')
    async importSpeakerNotes(
        @Param('sessionId') sessionId: string,
        @Body() body: { notes: Array<{ slideIndex: number; speakerNote: string }> },
    ) {
        if (!body.notes || !Array.isArray(body.notes) || body.notes.length === 0) {
            throw new BadRequestException('Danh sách lời giảng không hợp lệ');
        }
        return this.service.importSpeakerNotes(sessionId, body.notes);
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

    // 11. SCORM 1.2 & H5P Export (Ticket-based native download + direct fallback)
    @Post(':sessionId/export/scorm/ticket')
    async createScormTicket(
        @Param('sessionId') sessionId: string,
        @Body() body: { templateId?: string; bgOption?: string; theme?: string },
        @Req() req: Request,
    ) {
        const user = (req as any).user;
        const userId = user?.id || user?.sub;
        await this.tickets.assertPptxSessionAccess(sessionId, { id: userId, role: user?.role });
        await this.service.ensureRenderedSlidesForSession(sessionId);
        const { ticket, expiresInSeconds } = this.tickets.issue({
            kind: 'pptx-tool-scorm',
            userId,
            lessonId: sessionId,
            params: {
                templateId: body?.templateId,
                bgOption: body?.bgOption,
                theme: body?.theme,
            },
        });
        return {
            ticket,
            expiresInSeconds,
            url: `/api/pptx-audio-tool/${encodeURIComponent(sessionId)}/export/scorm/file?ticket=${encodeURIComponent(ticket)}`,
        };
    }

    @Post(':sessionId/export/h5p/ticket')
    async createH5pTicket(
        @Param('sessionId') sessionId: string,
        @Body() body: { templateId?: string; bgOption?: string; theme?: string },
        @Req() req: Request,
    ) {
        const user = (req as any).user;
        const userId = user?.id || user?.sub;
        await this.tickets.assertPptxSessionAccess(sessionId, { id: userId, role: user?.role });
        await this.service.ensureRenderedSlidesForSession(sessionId);
        const { ticket, expiresInSeconds } = this.tickets.issue({
            kind: 'pptx-tool-h5p',
            userId,
            lessonId: sessionId,
            params: {
                templateId: body?.templateId,
                bgOption: body?.bgOption,
                theme: body?.theme,
            },
        });
        return {
            ticket,
            expiresInSeconds,
            url: `/api/pptx-audio-tool/${encodeURIComponent(sessionId)}/export/h5p/file?ticket=${encodeURIComponent(ticket)}`,
        };
    }

    @Get(':sessionId/export/scorm')
    async exportScormDirect(
        @Param('sessionId') sessionId: string,
        @Query('templateId') templateId: string,
        @Query('bgOption') bgOption: string,
        @Query('theme') theme: string,
        @Req() req: Request,
        @Res() res: Response,
    ) {
        const user = (req as any).user;
        const userId = user?.id || user?.sub;
        await this.tickets.assertPptxSessionAccess(sessionId, { id: userId, role: user?.role });
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'no-store');
        return this.service.exportScorm(sessionId, res, templateId, bgOption, theme);
    }

    @Get(':sessionId/export/h5p')
    async exportH5pDirect(
        @Param('sessionId') sessionId: string,
        @Query('templateId') templateId: string,
        @Query('bgOption') bgOption: string,
        @Query('theme') theme: string,
        @Req() req: Request,
        @Res() res: Response,
    ) {
        const user = (req as any).user;
        const userId = user?.id || user?.sub;
        await this.tickets.assertPptxSessionAccess(sessionId, { id: userId, role: user?.role });
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'no-store');
        return this.service.exportH5p(sessionId, res, templateId, bgOption, theme);
    }

    @Get(':sessionId/export/moodle-xml')
    async exportMoodleXml(
        @Param('sessionId') sessionId: string,
        @Req() req: Request,
        @Res() res: Response,
    ) {
        const user = (req as any).user;
        const userId = user?.id || user?.sub;
        await this.tickets.assertPptxSessionAccess(sessionId, { id: userId, role: user?.role });
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'no-store');
        return this.service.exportMoodleXml(sessionId, res);
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

/**
 * Unguarded file download controller for PPTX Audio Tool SCORM 1.2 & H5P exports.
 * Uses short-lived single-use tickets issued by PptxAudioToolController.
 */
@Controller('pptx-audio-tool/:sessionId/export')
export class PptxAudioToolExportFileController {
    constructor(
        private readonly service: PptxAudioToolService,
        private readonly tickets: DownloadTicketService,
    ) {}

    @Get('scorm/file')
    async downloadScorm(
        @Param('sessionId') sessionId: string,
        @Query('ticket') ticket: string,
        @Res() res: Response,
    ) {
        const payload = this.tickets.resolve(ticket, 'pptx-tool-scorm', sessionId);
        if (!payload) {
            throw new HttpException('Liên kết tải đã hết hạn. Vui lòng bấm xuất lại.', HttpStatus.UNAUTHORIZED);
        }
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'no-store');
        return this.service.exportScorm(
            sessionId,
            res,
            payload.params.templateId,
            payload.params.bgOption,
            payload.params.theme,
        );
    }

    @Get('h5p/file')
    async downloadH5p(
        @Param('sessionId') sessionId: string,
        @Query('ticket') ticket: string,
        @Res() res: Response,
    ) {
        const payload = this.tickets.resolve(ticket, 'pptx-tool-h5p', sessionId);
        if (!payload) {
            throw new HttpException('Liên kết tải đã hết hạn. Vui lòng bấm xuất lại.', HttpStatus.UNAUTHORIZED);
        }
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'no-store');
        return this.service.exportH5p(
            sessionId,
            res,
            payload.params.templateId,
            payload.params.bgOption,
            payload.params.theme,
        );
    }
}
