import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Param,
    Body,
    Query,
    UseGuards,
    UseInterceptors,
    UploadedFile,
    ParseFilePipe,
    MaxFileSizeValidator,
    BadRequestException,
    Res,
    Req,
    Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { InteractiveQuestionService } from './interactive-question.service';
import { ReviewQuestionService } from './review-question.service';
import { PrismaService } from '../prisma/prisma.service';
import { GenerationJobService } from '../generation-job/generation-job.service';
import * as ExcelJS from 'exceljs';
import { buildMoodleXml } from './moodle-xml.helper';

// DTOs
interface CreateInteractiveQuestionDto {
    questionType?: string;
    questionText: string;
    answers: string[];
    correctFeedback?: string;
    incorrectFeedback?: string;
    points?: number;
    imageUrl?: string;
    videoUrl?: string;
    audioUrl?: string;
}

interface CreateReviewQuestionDto {
    level: number;
    question: string;
    correctAnswer: string;
    optionB: string;
    optionC: string;
    optionD: string;
    explanation?: string;
}

interface GenerateQuestionsDto {
    count?: number;
}

interface GenerateReviewQuestionsDto {
    level1?: number;
    level2?: number;
    level3?: number;
}

@Controller('lessons/:lessonId')
@UseGuards(JwtAuthGuard)
export class QuestionsController {
    private readonly logger = new Logger(QuestionsController.name);

    constructor(
        private readonly interactiveQuestionService: InteractiveQuestionService,
        private readonly reviewQuestionService: ReviewQuestionService,
        private readonly prisma: PrismaService,
        private readonly jobService: GenerationJobService,
    ) { }

    // ==================== INTERACTIVE QUESTIONS ====================

    /**
     * GET /lessons/:lessonId/interactive-questions
     */
    @Get('interactive-questions')
    async getInteractiveQuestions(@Param('lessonId') lessonId: string) {
        return this.interactiveQuestionService.getQuestions(lessonId);
    }

    /**
     * POST /lessons/:lessonId/interactive-questions
     */
    @Post('interactive-questions')
    async createInteractiveQuestion(
        @Param('lessonId') lessonId: string,
        @Body() dto: CreateInteractiveQuestionDto,
    ) {
        return this.interactiveQuestionService.createQuestion(lessonId, dto);
    }

    /**
     * POST /lessons/:lessonId/interactive-questions/generate
     */
    @Post('interactive-questions/generate')
    async generateInteractiveQuestions(
        @Param('lessonId') lessonId: string,
        @Body() dto: GenerateQuestionsDto,
        @Req() req: any,
    ) {
        const userId = req.user.id;
        // Get slides content for generation
        const slidesContent = await this.getSlidesContent(lessonId);
        return this.interactiveQuestionService.generateFromSlides(
            lessonId,
            slidesContent,
            userId,
            dto.count || 5,
        );
    }

    /**
     * PUT /lessons/:lessonId/interactive-questions/:qid
     */
    @Put('interactive-questions/:qid')
    async updateInteractiveQuestion(
        @Param('qid') qid: string,
        @Body() dto: Partial<CreateInteractiveQuestionDto>,
    ) {
        return this.interactiveQuestionService.updateQuestion(qid, dto);
    }

    /**
     * DELETE /lessons/:lessonId/interactive-questions/:qid
     */
    @Delete('interactive-questions/:qid')
    async deleteInteractiveQuestion(@Param('qid') qid: string) {
        await this.interactiveQuestionService.deleteQuestion(qid);
        return { success: true };
    }

    // ==================== REVIEW QUESTIONS ====================

    /**
     * GET /lessons/:lessonId/review-questions
     * GET /lessons/:lessonId/review-questions?level=1
     */
    @Get('review-questions')
    async getReviewQuestions(
        @Param('lessonId') lessonId: string,
        @Query('level') level?: string,
    ) {
        if (level) {
            return this.reviewQuestionService.getByLevel(lessonId, parseInt(level, 10));
        }
        return this.reviewQuestionService.getQuestions(lessonId);
    }

    /**
     * POST /lessons/:lessonId/review-questions
     */
    @Post('review-questions')
    async createReviewQuestion(
        @Param('lessonId') lessonId: string,
        @Body() dto: CreateReviewQuestionDto,
    ) {
        const lessonNumber = await this.getLessonNumber(lessonId);
        return this.reviewQuestionService.createQuestion(lessonId, lessonNumber, dto);
    }

    /**
     * POST /lessons/:lessonId/review-questions/generate
     * Returns jobId immediately, processes in background.
     */
    @Post('review-questions/generate')
    async generateReviewQuestions(
        @Param('lessonId') lessonId: string,
        @Body() dto: GenerateReviewQuestionsDto,
        @Req() req: any,
    ) {
        const userId = req.user.id;
        const levelCounts = {
            level1: dto.level1 || 4,
            level2: dto.level2 || 3,
            level3: dto.level3 || 3,
        };

        // Create job record in DB
        const job = await this.jobService.createJob({
            type: 'review-questions',
            lessonId,
            userId,
            total: levelCounts.level1 + levelCounts.level2 + levelCounts.level3,
            payload: levelCounts,
        });

        // Kick off background processing
        setImmediate(async () => {
            try {
                await this.jobService.updateProgress(job.id, 0, 'Đang chuẩn bị tạo câu hỏi ôn tập...');

                const slidesContent = await this.getSlidesContent(lessonId);
                const lessonNumber = await this.getLessonNumber(lessonId);

                await this.jobService.updateProgress(job.id, 10, `Đang tạo ${job.total} câu hỏi ôn tập...`);

                await this.reviewQuestionService.generateFromSlides(
                    lessonId,
                    lessonNumber,
                    slidesContent,
                    userId,
                    levelCounts,
                );

                await this.jobService.completeJob(job.id);
            } catch (error) {
                this.logger.error(`[generateReviewQuestions] Job ${job.id} failed:`, error);
                await this.jobService.failJob(job.id, error?.message || 'Unknown error');
            }
        });

        return { jobId: job.id, status: 'pending' };
    }

    /**
     * POST /lessons/:lessonId/review-questions/append
     * Returns jobId immediately, processes in background.
     */
    @Post('review-questions/append')
    async appendReviewQuestions(
        @Param('lessonId') lessonId: string,
        @Body() dto: GenerateReviewQuestionsDto,
        @Req() req: any,
    ) {
        const userId = req.user.id;
        const levelCounts = {
            level1: dto.level1 || 4,
            level2: dto.level2 || 3,
            level3: dto.level3 || 3,
        };

        // Create job record in DB
        const job = await this.jobService.createJob({
            type: 'append-questions',
            lessonId,
            userId,
            total: levelCounts.level1 + levelCounts.level2 + levelCounts.level3,
            payload: levelCounts,
        });

        // Kick off background processing
        setImmediate(async () => {
            try {
                await this.jobService.updateProgress(job.id, 0, 'Đang chuẩn bị thêm câu hỏi...');

                const slidesContent = await this.getSlidesContent(lessonId);
                const lessonNumber = await this.getLessonNumber(lessonId);

                await this.jobService.updateProgress(job.id, 10, `Đang tạo thêm ${job.total} câu hỏi...`);

                await this.reviewQuestionService.appendFromSlides(
                    lessonId,
                    lessonNumber,
                    slidesContent,
                    userId,
                    levelCounts,
                );

                await this.jobService.completeJob(job.id);
            } catch (error) {
                this.logger.error(`[appendReviewQuestions] Job ${job.id} failed:`, error);
                await this.jobService.failJob(job.id, error?.message || 'Unknown error');
            }
        });

        return { jobId: job.id, status: 'pending' };
    }

    /**
     * PUT /lessons/:lessonId/review-questions/:qid
     */
    @Put('review-questions/:qid')
    async updateReviewQuestion(
        @Param('qid') qid: string,
        @Body() dto: Partial<CreateReviewQuestionDto>,
    ) {
        return this.reviewQuestionService.updateQuestion(qid, dto);
    }

    /**
     * DELETE /lessons/:lessonId/review-questions/:qid
     */
    @Delete('review-questions/:qid')
    async deleteReviewQuestion(@Param('qid') qid: string) {
        await this.reviewQuestionService.deleteQuestion(qid);
        return { success: true };
    }

    /**
     * GET /lessons/:lessonId/review-questions/export/excel
     */
    @Get('review-questions/export/excel')
    async exportReviewQuestionsExcel(
        @Param('lessonId') lessonId: string,
        @Res() res: Response,
    ) {
        const questions = await this.reviewQuestionService.getQuestions(lessonId);
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
        });

        // Create workbook and worksheet
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Câu hỏi ôn tập');

        // Set columns with width
        worksheet.columns = [
            { header: 'Question ID', key: 'questionId', width: 12 },
            { header: 'Question', key: 'question', width: 50 },
            { header: 'Correct Answer (A)', key: 'correctAnswer', width: 30 },
            { header: 'Option B', key: 'optionB', width: 30 },
            { header: 'Option C', key: 'optionC', width: 30 },
            { header: 'Option D', key: 'optionD', width: 30 },
            { header: 'Explanation', key: 'explanation', width: 40 },
        ];

        // Style header row
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4472C4' },
        };
        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

        // Add data
        for (const q of questions) {
            worksheet.addRow({
                questionId: q.questionId,
                question: q.question,
                correctAnswer: q.correctAnswer,
                optionB: q.optionB,
                optionC: q.optionC,
                optionD: q.optionD,
                explanation: q.explanation || '',
            });
        }

        // Set response headers
        const filename = `${lesson?.title || 'lesson'}_review.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);

        // Write to response
        await workbook.xlsx.write(res);
        res.end();
    }

    /**
     * GET /lessons/:lessonId/review-questions/export/moodle-xml
     * Export review questions as Moodle-compatible XML file
     */
    @Get('review-questions/export/moodle-xml')
    async exportReviewQuestionsMoodleXml(
        @Param('lessonId') lessonId: string,
        @Res() res: Response,
    ) {
        const questions = await this.reviewQuestionService.getQuestions(lessonId);
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
        });

        const xml = buildMoodleXml(questions, lesson?.title || 'lesson');

        const filename = `${lesson?.title || 'lesson'}_moodle.xml`;
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        res.send(xml);
    }

    /**
     * GET /lessons/:lessonId/interactive-questions/export/excel
     */
    @Get('interactive-questions/export/excel')
    async exportInteractiveQuestionsExcel(
        @Param('lessonId') lessonId: string,
        @Res() res: Response,
    ) {
        const questions = await this.interactiveQuestionService.getQuestions(lessonId);
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
        });

        // Create workbook and worksheet
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Câu hỏi tương tác');

        // Set columns - format for import into LMS
        worksheet.columns = [
            { header: 'Question Type', key: 'questionType', width: 15 },
            { header: 'Question Text', key: 'questionText', width: 50 },
            { header: 'Answer 1', key: 'answer1', width: 30 },
            { header: 'Answer 2', key: 'answer2', width: 30 },
            { header: 'Answer 3', key: 'answer3', width: 30 },
            { header: 'Answer 4', key: 'answer4', width: 30 },
            { header: 'Answer 5', key: 'answer5', width: 30 },
            { header: 'Answer 6', key: 'answer6', width: 30 },
            { header: 'Correct Feedback', key: 'correctFeedback', width: 40 },
            { header: 'Incorrect Feedback', key: 'incorrectFeedback', width: 40 },
            { header: 'Points', key: 'points', width: 10 },
        ];

        // Style header row
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF70AD47' },
        };
        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

        // Add data
        for (const q of questions) {
            const answers = q.answers || [];
            worksheet.addRow({
                questionType: q.questionType,
                questionText: q.questionText,
                answer1: answers[0] || '',
                answer2: answers[1] || '',
                answer3: answers[2] || '',
                answer4: answers[3] || '',
                answer5: answers[4] || '',
                answer6: answers[5] || '',
                correctFeedback: q.correctFeedback || '',
                incorrectFeedback: q.incorrectFeedback || '',
                points: q.points,
            });
        }

        // Set response headers
        const filename = `${lesson?.title || 'lesson'}_interactive.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);

        // Write to response
        await workbook.xlsx.write(res);
        res.end();
    }

    /**
     * GET /lessons/:lessonId/review-questions/stats
     */
    @Get('review-questions/stats')
    async getReviewQuestionsStats(@Param('lessonId') lessonId: string) {
        const levelCounts = await this.reviewQuestionService.getLevelCounts(lessonId);
        return {
            total: levelCounts.level1 + levelCounts.level2 + levelCounts.level3,
            ...levelCounts,
        };
    }

    /**
     * GET /lessons/:lessonId/review-questions/import-template
     * Download a blank Excel template (with example rows) for importing review questions.
     */
    @Get('review-questions/import-template')
    async downloadReviewImportTemplate(@Res() res: Response) {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Câu hỏi ôn tập');

        worksheet.columns = [
            { header: 'Level', key: 'level', width: 8 },
            { header: 'Question', key: 'question', width: 50 },
            { header: 'Correct Answer (A)', key: 'correctAnswer', width: 30 },
            { header: 'Option B', key: 'optionB', width: 30 },
            { header: 'Option C', key: 'optionC', width: 30 },
            { header: 'Option D', key: 'optionD', width: 30 },
            { header: 'Explanation', key: 'explanation', width: 40 },
        ];

        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4472C4' },
        };
        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

        // Example rows (users can overwrite/delete these)
        worksheet.addRow({
            level: 1,
            question: 'Thủ đô của Việt Nam là thành phố nào?',
            correctAnswer: 'Hà Nội',
            optionB: 'TP. Hồ Chí Minh',
            optionC: 'Đà Nẵng',
            optionD: 'Hải Phòng',
            explanation: 'Hà Nội là thủ đô của Việt Nam.',
        });
        worksheet.addRow({
            level: 2,
            question: 'Vì sao nước biển có vị mặn?',
            correctAnswer: 'Do hòa tan muối khoáng từ đất đá',
            optionB: 'Do cá thải ra muối',
            optionC: 'Do ánh nắng mặt trời',
            optionD: 'Do gió biển',
            explanation: 'Nước mưa bào mòn đất đá, cuốn muối khoáng ra biển.',
        });

        // Instructions sheet
        const guide = workbook.addWorksheet('Hướng dẫn');
        guide.columns = [{ width: 90 }];
        const lines = [
            'HƯỚNG DẪN ĐIỀN FILE CÂU HỎI ÔN TẬP',
            '',
            '1. Mỗi dòng là một câu hỏi (điền ở sheet "Câu hỏi ôn tập").',
            '2. Cột Level: mức độ Bloom — 1 = Biết, 2 = Hiểu, 3 = Vận dụng. Để trống sẽ mặc định là 1.',
            '3. Cột "Correct Answer (A)" LUÔN là đáp án ĐÚNG (sẽ là phương án A).',
            '4. Các cột Option B, C, D là phương án sai (gây nhiễu). Cần điền đủ cả 3.',
            '5. Cột Explanation (giải thích) không bắt buộc.',
            '6. KHÔNG cần điền mã câu hỏi — hệ thống tự sinh khi import.',
            '7. Khi import, câu hỏi mới được THÊM vào cuối, không xóa câu hỏi cũ.',
            '8. Có thể xóa 2 dòng ví dụ mẫu trước khi điền dữ liệu của bạn.',
        ];
        lines.forEach((t) => guide.addRow([t]));
        guide.getRow(1).font = { bold: true, size: 14 };

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent('mau_cau_hoi_on_tap.xlsx')}"`);
        await workbook.xlsx.write(res);
        res.end();
    }

    /**
     * POST /lessons/:lessonId/review-questions/import
     * Import review questions from an uploaded .xlsx file (append mode).
     */
    @Post('review-questions/import')
    @UseInterceptors(FileInterceptor('file'))
    async importReviewQuestions(
        @Param('lessonId') lessonId: string,
        @UploadedFile(
            new ParseFilePipe({
                validators: [new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 })],
            }),
        )
        file: Express.Multer.File,
    ) {
        if (!file) {
            throw new BadRequestException('Vui lòng chọn file Excel (.xlsx).');
        }
        const ext = file.originalname.split('.').pop()?.toLowerCase();
        if (ext !== 'xlsx') {
            throw new BadRequestException('Định dạng không hợp lệ. Chỉ chấp nhận file .xlsx.');
        }

        const workbook = new ExcelJS.Workbook();
        try {
            await workbook.xlsx.load(file.buffer as any);
        } catch {
            throw new BadRequestException('Không đọc được file Excel. File có thể bị hỏng.');
        }

        const worksheet = workbook.worksheets[0];
        if (!worksheet) {
            throw new BadRequestException('File Excel không có dữ liệu.');
        }

        const lessonNumber = await this.getLessonNumber(lessonId);

        const cell = (row: ExcelJS.Row, col: number): string => {
            const v = row.getCell(col).value;
            if (v === null || v === undefined) return '';
            if (typeof v === 'object' && 'text' in (v as any)) return String((v as any).text).trim();
            if (typeof v === 'object' && 'result' in (v as any)) return String((v as any).result).trim();
            return String(v).trim();
        };

        // Normalize a question for duplicate detection: lowercase, collapse
        // whitespace, strip surrounding punctuation/quotes.
        const normalize = (s: string): string =>
            s
                .toLowerCase()
                .replace(/\s+/g, ' ')
                .replace(/[.,;:!?"'`()[\]{}…]/g, '')
                .trim();

        // Seed the seen-set with questions already in this lesson.
        const existing = await this.reviewQuestionService.getQuestions(lessonId);
        const seen = new Set<string>(existing.map((q) => normalize(q.question)));

        let imported = 0;
        let skipped = 0;
        let duplicates = 0;
        const errors: string[] = [];

        // Row 1 is the header — start from row 2.
        for (let r = 2; r <= worksheet.rowCount; r++) {
            const row = worksheet.getRow(r);
            const question = cell(row, 2);
            const correctAnswer = cell(row, 3);
            const optionB = cell(row, 4);
            const optionC = cell(row, 5);
            const optionD = cell(row, 6);

            // Skip fully empty rows silently.
            if (!question && !correctAnswer && !optionB && !optionC && !optionD) {
                continue;
            }

            if (!question || !correctAnswer || !optionB || !optionC || !optionD) {
                skipped++;
                errors.push(`Dòng ${r}: thiếu câu hỏi hoặc thiếu phương án.`);
                continue;
            }

            // Skip questions that duplicate an existing one or an earlier row.
            const key = normalize(question);
            if (seen.has(key)) {
                duplicates++;
                errors.push(`Dòng ${r}: trùng câu hỏi đã có, đã bỏ qua.`);
                continue;
            }
            seen.add(key);

            let level = parseInt(cell(row, 1), 10);
            if (!Number.isInteger(level) || level < 1 || level > 3) {
                level = 1;
            }

            try {
                await this.reviewQuestionService.createQuestion(lessonId, lessonNumber, {
                    level,
                    question,
                    correctAnswer,
                    optionB,
                    optionC,
                    optionD,
                    explanation: cell(row, 7) || undefined,
                });
                imported++;
            } catch (e: any) {
                skipped++;
                errors.push(`Dòng ${r}: ${e?.message || 'lỗi không xác định'}`);
            }
        }

        if (imported === 0 && skipped === 0 && duplicates === 0) {
            throw new BadRequestException('File không có câu hỏi nào để import.');
        }

        return { imported, skipped, duplicates, errors };
    }

    // ==================== HELPERS ====================
    /**
     * Get slides content for AI generation
     */
    private async getSlidesContent(lessonId: string): Promise<string> {
        const slides = await this.prisma.slide.findMany({
            where: { lessonId },
            orderBy: { slideIndex: 'asc' },
        });

        if (slides.length > 0) {
            return slides
                .map(s => `## ${s.title}\n${s.content || ''}\n${s.speakerNote || ''}`)
                .join('\n\n');
        }

        // Fallback to legacy slideScript
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
        });

        return lesson?.slideScript || lesson?.detailedOutline || '';
    }

    /**
     * Get lesson number (order in subject)
     */
    private async getLessonNumber(lessonId: string): Promise<number> {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
            include: { subject: { include: { lessons: { orderBy: { createdAt: 'asc' } } } } },
        });

        if (!lesson) return 1;

        const index = lesson.subject.lessons.findIndex(l => l.id === lessonId);
        return index >= 0 ? index + 1 : 1;
    }
}
