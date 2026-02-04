import { Injectable, Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { QuizContent } from '../ai/gemini.service';

export interface ExcelQuizOptions {
    title?: string;
    sheetName?: string;
}

@Injectable()
export class ExcelExportService {
    private readonly logger = new Logger(ExcelExportService.name);

    /**
     * Generate Quiz Excel from quiz content
     */
    async generateQuizExcel(content: QuizContent, options?: ExcelQuizOptions): Promise<Buffer> {
        this.logger.log(`Generating Quiz Excel: ${content.title}`);

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'AI Teaching Assistant';
        workbook.created = new Date();

        const worksheet = workbook.addWorksheet(options?.sheetName || 'Quiz');

        // Define columns
        worksheet.columns = [
            { header: 'STT', key: 'id', width: 6 },
            { header: 'Câu hỏi', key: 'question', width: 50 },
            { header: 'A', key: 'optionA', width: 25 },
            { header: 'B', key: 'optionB', width: 25 },
            { header: 'C', key: 'optionC', width: 25 },
            { header: 'D', key: 'optionD', width: 25 },
            { header: 'Đáp án', key: 'answer', width: 10 },
            { header: 'Độ khó', key: 'difficulty', width: 12 },
            { header: 'Giải thích', key: 'explanation', width: 40 },
        ];

        // Style header row
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF3B82F6' },
        };
        headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
        headerRow.height = 25;

        // Add data rows
        for (const question of content.questions) {
            const options = this.parseOptions(question.options);

            worksheet.addRow({
                id: question.id,
                question: question.question,
                optionA: options.A,
                optionB: options.B,
                optionC: options.C,
                optionD: options.D,
                answer: question.correctAnswer,
                difficulty: this.translateDifficulty(question.difficulty),
                explanation: question.explanation,
            });
        }

        // Style data rows
        for (let i = 2; i <= content.questions.length + 1; i++) {
            const row = worksheet.getRow(i);
            row.alignment = { vertical: 'middle', wrapText: true };

            // Alternate row colors
            if (i % 2 === 0) {
                row.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFF3F4F6' },
                };
            }
        }

        // Add borders to all cells
        worksheet.eachRow((row) => {
            row.eachCell((cell) => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' },
                };
            });
        });

        // Generate buffer
        const buffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(buffer);
    }

    private parseOptions(options: string[]): { A: string; B: string; C: string; D: string } {
        const result = { A: '', B: '', C: '', D: '' };

        for (const opt of options) {
            if (opt.startsWith('A.') || opt.startsWith('A ')) {
                result.A = opt.substring(2).trim();
            } else if (opt.startsWith('B.') || opt.startsWith('B ')) {
                result.B = opt.substring(2).trim();
            } else if (opt.startsWith('C.') || opt.startsWith('C ')) {
                result.C = opt.substring(2).trim();
            } else if (opt.startsWith('D.') || opt.startsWith('D ')) {
                result.D = opt.substring(2).trim();
            }
        }

        // Fallback: assign by index if parsing fails
        if (!result.A && options[0]) result.A = options[0];
        if (!result.B && options[1]) result.B = options[1];
        if (!result.C && options[2]) result.C = options[2];
        if (!result.D && options[3]) result.D = options[3];

        return result;
    }

    private translateDifficulty(difficulty: string): string {
        switch (difficulty) {
            case 'easy': return 'Dễ';
            case 'medium': return 'Trung bình';
            case 'hard': return 'Khó';
            default: return difficulty;
        }
    }
}
