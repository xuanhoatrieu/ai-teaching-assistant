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

    constructor(private readonly service: PptxAudioToolService) {}

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

    // 7. Generate audio for ALL slides
    @Post(':sessionId/generate-all-audio')
    async generateAllAudio(
        @Param('sessionId') sessionId: string,
        @Req() req: Request,
        @Body() body: { multilingualMode?: string; vittsMode?: string; vittsDesignInstruct?: string; vittsNormalize?: boolean },
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;
        return this.service.generateAllAudio(sessionId, userId, body);
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

    // 10. Generate questions from slide content
    @Post(':sessionId/generate-questions')
    async generateQuestions(
        @Param('sessionId') sessionId: string,
        @Req() req: Request,
        @Body() body: { level1Count?: number; level2Count?: number; level3Count?: number },
    ) {
        const userId = (req as any).user?.id || (req as any).user?.sub;
        return this.service.generateQuestions(sessionId, userId, body);
    }

    // 11. Export questions to XLSX
    @Get(':sessionId/questions/export/excel')
    async exportQuestionsExcel(
        @Param('sessionId') sessionId: string,
        @Res() res: Response,
    ) {
        const questions = await this.service.getQuestions(sessionId);
        const session = await this.service.getSession(sessionId);

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Câu hỏi ôn tập');

        worksheet.columns = [
            { header: 'STT', key: 'stt', width: 6 },
            { header: 'Mức độ', key: 'level', width: 10 },
            { header: 'Câu hỏi', key: 'question', width: 50 },
            { header: 'A (Đáp án đúng)', key: 'correctAnswer', width: 30 },
            { header: 'B', key: 'optionB', width: 30 },
            { header: 'C', key: 'optionC', width: 30 },
            { header: 'D', key: 'optionD', width: 30 },
            { header: 'Giải thích', key: 'explanation', width: 40 },
        ];

        // Style header row
        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4472C4' },
        };

        // Add data
        questions.forEach((q: any, i: number) => {
            worksheet.addRow({
                stt: i + 1,
                level: q.level === 1 ? 'Biết' : q.level === 2 ? 'Hiểu' : 'Vận dụng',
                question: q.question,
                correctAnswer: q.correctAnswer,
                optionB: q.optionB,
                optionC: q.optionC,
                optionD: q.optionD,
                explanation: q.explanation || '',
            });
        });

        const filename = `${session?.fileName?.replace('.pptx', '') || 'pptx'}_questions.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);

        await workbook.xlsx.write(res);
        res.end();
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
