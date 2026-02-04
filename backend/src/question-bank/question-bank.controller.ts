import {
    Controller,
    Get,
    Put,
    Post,
    Body,
    Param,
    UseGuards,
    Request,
    Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { QuestionBankService, LevelCounts } from './question-bank.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { IsNumber, IsString, IsNotEmpty, Min } from 'class-validator';
import * as XLSX from 'xlsx';

// DTOs
class GenerateQuestionsDto {
    @IsNumber()
    @Min(0)
    level1: number;  // Mức Biết

    @IsNumber()
    @Min(0)
    level2: number;  // Mức Hiểu

    @IsNumber()
    @Min(0)
    level3: number;  // Mức Vận dụng
}

class UpdateQuestionsDto {
    @IsString()
    @IsNotEmpty()
    questionsJson: string;
}

@Controller('lessons/:lessonId/questions')
@UseGuards(JwtAuthGuard)
export class QuestionBankController {
    constructor(private questionBankService: QuestionBankService) { }

    // GET /lessons/:id/questions - Get question bank
    @Get()
    async getQuestionBank(@Param('lessonId') lessonId: string) {
        const questionBank = await this.questionBankService.getQuestionBank(lessonId);
        if (!questionBank) {
            return { questions: [], levelCounts: null };
        }
        return {
            questions: JSON.parse(questionBank.questionsJson),
            levelCounts: questionBank.levelCounts ? JSON.parse(questionBank.levelCounts) : null,
        };
    }

    // POST /lessons/:id/questions/generate - Generate questions with AI (Step 5)
    @Post('generate')
    async generateQuestions(
        @Param('lessonId') lessonId: string,
        @Body() dto: GenerateQuestionsDto,
        @Request() req,
    ) {
        const levelCounts: LevelCounts = {
            level1: dto.level1,
            level2: dto.level2,
            level3: dto.level3,
        };

        const questionBank = await this.questionBankService.generateQuestions(
            lessonId,
            req.user.id,
            levelCounts,
        );

        return {
            questions: JSON.parse(questionBank.questionsJson),
            levelCounts: JSON.parse(questionBank.levelCounts || '{}'),
        };
    }

    // PUT /lessons/:id/questions - Update questions after user edit
    @Put()
    async updateQuestions(
        @Param('lessonId') lessonId: string,
        @Body() dto: UpdateQuestionsDto,
    ) {
        return this.questionBankService.updateQuestions(lessonId, dto.questionsJson);
    }

    // GET /lessons/:id/questions/export/excel - Export to Excel
    @Get('export/excel')
    async exportExcel(
        @Param('lessonId') lessonId: string,
        @Res() res: Response,
    ) {
        const questionBank = await this.questionBankService.getQuestionBank(lessonId);

        if (!questionBank) {
            res.status(404).json({ error: 'Question bank not found' });
            return;
        }

        const questions = JSON.parse(questionBank.questionsJson);

        // Create workbook
        const wb = XLSX.utils.book_new();

        const data = questions.map((q: any) => ({
            'Question ID': q.id,
            'Câu hỏi': q.question,
            'Đáp án đúng (A)': q.correctAnswer,
            'Đáp án B': q.optionB,
            'Đáp án C': q.optionC,
            'Đáp án D': q.optionD,
            'Giải thích': q.explanation,
            'Mức độ': q.level === 1 ? 'Biết' : q.level === 2 ? 'Hiểu' : 'Vận dụng',
        }));

        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, 'Questions');

        // Generate buffer
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        // Send file
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=questions_${lessonId}.xlsx`);
        res.send(buffer);
    }
}
