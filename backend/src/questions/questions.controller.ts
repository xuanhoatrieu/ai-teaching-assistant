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
    Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { InteractiveQuestionService } from './interactive-question.service';
import { ReviewQuestionService } from './review-question.service';
import { PrismaService } from '../prisma/prisma.service';
import * as ExcelJS from 'exceljs';

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
    constructor(
        private readonly interactiveQuestionService: InteractiveQuestionService,
        private readonly reviewQuestionService: ReviewQuestionService,
        private readonly prisma: PrismaService,
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
    ) {
        // Get slides content for generation
        const slidesContent = await this.getSlidesContent(lessonId);
        return this.interactiveQuestionService.generateFromSlides(
            lessonId,
            slidesContent,
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
     */
    @Post('review-questions/generate')
    async generateReviewQuestions(
        @Param('lessonId') lessonId: string,
        @Body() dto: GenerateReviewQuestionsDto,
    ) {
        const slidesContent = await this.getSlidesContent(lessonId);
        const lessonNumber = await this.getLessonNumber(lessonId);

        return this.reviewQuestionService.generateFromSlides(
            lessonId,
            lessonNumber,
            slidesContent,
            {
                level1: dto.level1 || 4,
                level2: dto.level2 || 3,
                level3: dto.level3 || 3,
            },
        );
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
            { header: 'ID', key: 'questionId', width: 12 },
            { header: 'Mức độ', key: 'level', width: 10 },
            { header: 'Câu hỏi', key: 'question', width: 50 },
            { header: 'A (Đúng)', key: 'correctAnswer', width: 30 },
            { header: 'B', key: 'optionB', width: 30 },
            { header: 'C', key: 'optionC', width: 30 },
            { header: 'D', key: 'optionD', width: 30 },
            { header: 'Giải thích', key: 'explanation', width: 40 },
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
            const levelLabel = q.level === 1 ? 'Biết' : q.level === 2 ? 'Hiểu' : 'Vận dụng';
            worksheet.addRow({
                questionId: q.questionId,
                level: levelLabel,
                question: q.question,
                correctAnswer: q.correctAnswer,
                optionB: q.optionB,
                optionC: q.optionC,
                optionD: q.optionD,
                explanation: q.explanation || '',
            });
        }

        // Set response headers
        const filename = `review_questions_${lesson?.title || lessonId}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);

        // Write to response
        await workbook.xlsx.write(res);
        res.end();
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
        const filename = `interactive_questions_${lesson?.title || lessonId}.xlsx`;
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
