import { Injectable, Logger } from '@nestjs/common';
import {
    Document,
    Packer,
    Paragraph,
    TextRun,
    Table,
    TableRow,
    TableCell,
    WidthType,
    AlignmentType,
    HeadingLevel,
    BorderStyle,
} from 'docx';
import { QuizContent } from '../ai/gemini.service';

@Injectable()
export class WordTableExportService {
    private readonly logger = new Logger(WordTableExportService.name);

    /**
     * Generate Quiz Word document with table format
     */
    async generateQuizWordTable(content: QuizContent): Promise<Buffer> {
        this.logger.log(`Generating Quiz Word Table: ${content.title}`);

        const doc = new Document({
            creator: 'AI Teaching Assistant',
            title: content.title,
            sections: [
                {
                    properties: {},
                    children: this.buildQuizTable(content),
                },
            ],
        });

        return Packer.toBuffer(doc);
    }

    private buildQuizTable(content: QuizContent): (Paragraph | Table)[] {
        const children: (Paragraph | Table)[] = [];

        // Title
        children.push(
            new Paragraph({
                text: content.title,
                heading: HeadingLevel.TITLE,
                alignment: AlignmentType.CENTER,
                spacing: { after: 400 },
            }),
        );

        // Info
        children.push(
            new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 400 },
                children: [
                    new TextRun({ text: `Tổng số câu hỏi: ${content.totalQuestions}`, italics: true }),
                ],
            }),
        );

        // Questions table
        const tableRows: TableRow[] = [];

        // Header row
        tableRows.push(
            new TableRow({
                tableHeader: true,
                children: [
                    this.createHeaderCell('STT', 800),
                    this.createHeaderCell('Câu hỏi', 4000),
                    this.createHeaderCell('A', 1500),
                    this.createHeaderCell('B', 1500),
                    this.createHeaderCell('C', 1500),
                    this.createHeaderCell('D', 1500),
                    this.createHeaderCell('ĐA', 800),
                ],
            }),
        );

        // Data rows
        for (const question of content.questions) {
            const options = this.parseOptions(question.options);

            tableRows.push(
                new TableRow({
                    children: [
                        this.createDataCell(question.id.toString(), 800, AlignmentType.CENTER),
                        this.createDataCell(question.question, 4000),
                        this.createDataCell(options.A, 1500),
                        this.createDataCell(options.B, 1500),
                        this.createDataCell(options.C, 1500),
                        this.createDataCell(options.D, 1500),
                        this.createDataCell(question.correctAnswer, 800, AlignmentType.CENTER),
                    ],
                }),
            );
        }

        children.push(
            new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                rows: tableRows,
            }),
        );

        // Answer key section
        children.push(
            new Paragraph({
                text: 'ĐÁP ÁN',
                heading: HeadingLevel.HEADING_1,
                spacing: { before: 600, after: 200 },
            }),
        );

        // Answer key in compact format
        const answerText = content.questions
            .map(q => `${q.id}.${q.correctAnswer}`)
            .join('  |  ');

        children.push(
            new Paragraph({
                text: answerText,
                spacing: { after: 400 },
            }),
        );

        return children;
    }

    private createHeaderCell(text: string, width: number): TableCell {
        return new TableCell({
            width: { size: width, type: WidthType.DXA },
            shading: { fill: '3B82F6' },
            children: [
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                        new TextRun({ text, bold: true, color: 'FFFFFF' }),
                    ],
                }),
            ],
        });
    }

    private createDataCell(text: string, width: number, align?: (typeof AlignmentType)[keyof typeof AlignmentType]): TableCell {
        return new TableCell({
            width: { size: width, type: WidthType.DXA },
            children: [
                new Paragraph({
                    alignment: align || AlignmentType.LEFT,
                    children: [new TextRun({ text })],
                }),
            ],
        });
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

        // Fallback
        if (!result.A && options[0]) result.A = options[0];
        if (!result.B && options[1]) result.B = options[1];
        if (!result.C && options[2]) result.C = options[2];
        if (!result.D && options[3]) result.D = options[3];

        return result;
    }
}
