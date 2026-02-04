import { Injectable, Logger } from '@nestjs/common';
import { PptxExportService } from './pptx-export.service';
import { DocxExportService } from './docx-export.service';
import { ExcelExportService } from './excel-export.service';
import { WordTableExportService } from './word-table-export.service';
import { GeminiService, SlideContent, HandoutContent, QuizContent } from '../ai/gemini.service';
import { ContentType } from '@prisma/client';

export interface ExportResult {
    buffer: Buffer;
    filename: string;
    mimeType: string;
    contentType: ContentType;
}

export interface GenerateAllOptions {
    lessonTitle: string;
    outline: string;
    generatePptx?: boolean;
    generateHandout?: boolean;
    generateQuizExcel?: boolean;
    generateQuizWord?: boolean;
    questionCount?: number;
}

@Injectable()
export class ExportService {
    private readonly logger = new Logger(ExportService.name);

    constructor(
        private readonly pptxExport: PptxExportService,
        private readonly docxExport: DocxExportService,
        private readonly excelExport: ExcelExportService,
        private readonly wordTableExport: WordTableExportService,
        private readonly geminiService: GeminiService,
    ) { }

    /**
     * Generate all content types from an outline
     */
    async generateAll(options: GenerateAllOptions): Promise<ExportResult[]> {
        this.logger.log(`Generating all content for: ${options.lessonTitle}`);
        const results: ExportResult[] = [];

        // Generate PPTX
        if (options.generatePptx !== false) {
            try {
                const slideContent = await this.geminiService.generateSlideContent(options.outline);
                const buffer = await this.pptxExport.generatePptx(slideContent, {
                    title: options.lessonTitle,
                });
                results.push({
                    buffer,
                    filename: `${this.sanitizeFilename(options.lessonTitle)}.pptx`,
                    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                    contentType: ContentType.PPTX,
                });
                this.logger.log('PPTX generated successfully');
            } catch (error) {
                this.logger.error(`PPTX generation failed: ${error}`);
            }
        }

        // Generate Handout
        if (options.generateHandout !== false) {
            try {
                const handoutContent = await this.geminiService.generateHandoutContent(options.outline);
                const buffer = await this.docxExport.generateHandout(handoutContent);
                results.push({
                    buffer,
                    filename: `${this.sanitizeFilename(options.lessonTitle)}_Handout.docx`,
                    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    contentType: ContentType.HANDOUT,
                });
                this.logger.log('Handout generated successfully');
            } catch (error) {
                this.logger.error(`Handout generation failed: ${error}`);
            }
        }

        // Generate Quiz Excel
        if (options.generateQuizExcel !== false) {
            try {
                const quizContent = await this.geminiService.generateQuizQuestions(
                    options.outline,
                    options.questionCount || 10,
                );
                const buffer = await this.excelExport.generateQuizExcel(quizContent);
                results.push({
                    buffer,
                    filename: `${this.sanitizeFilename(options.lessonTitle)}_Quiz.xlsx`,
                    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    contentType: ContentType.QUIZ_EXCEL,
                });
                this.logger.log('Quiz Excel generated successfully');
            } catch (error) {
                this.logger.error(`Quiz Excel generation failed: ${error}`);
            }
        }

        // Generate Quiz Word Table
        if (options.generateQuizWord !== false) {
            try {
                const quizContent = await this.geminiService.generateQuizQuestions(
                    options.outline,
                    options.questionCount || 10,
                );
                const buffer = await this.wordTableExport.generateQuizWordTable(quizContent);
                results.push({
                    buffer,
                    filename: `${this.sanitizeFilename(options.lessonTitle)}_Quiz.docx`,
                    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    contentType: ContentType.QUIZ_WORD,
                });
                this.logger.log('Quiz Word generated successfully');
            } catch (error) {
                this.logger.error(`Quiz Word generation failed: ${error}`);
            }
        }

        return results;
    }

    /**
     * Generate PPTX from pre-generated content
     */
    async exportPptx(content: SlideContent, title: string): Promise<ExportResult> {
        const buffer = await this.pptxExport.generatePptx(content, { title });
        return {
            buffer,
            filename: `${this.sanitizeFilename(title)}.pptx`,
            mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            contentType: ContentType.PPTX,
        };
    }

    /**
     * Generate Handout from pre-generated content
     */
    async exportHandout(content: HandoutContent): Promise<ExportResult> {
        const buffer = await this.docxExport.generateHandout(content);
        return {
            buffer,
            filename: `${this.sanitizeFilename(content.title)}_Handout.docx`,
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            contentType: ContentType.HANDOUT,
        };
    }

    /**
     * Generate Quiz Excel from pre-generated content
     */
    async exportQuizExcel(content: QuizContent): Promise<ExportResult> {
        const buffer = await this.excelExport.generateQuizExcel(content);
        return {
            buffer,
            filename: `${this.sanitizeFilename(content.title)}.xlsx`,
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            contentType: ContentType.QUIZ_EXCEL,
        };
    }

    /**
     * Generate Quiz Word Table from pre-generated content
     */
    async exportQuizWord(content: QuizContent): Promise<ExportResult> {
        const buffer = await this.wordTableExport.generateQuizWordTable(content);
        return {
            buffer,
            filename: `${this.sanitizeFilename(content.title)}_Table.docx`,
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            contentType: ContentType.QUIZ_WORD,
        };
    }

    /**
     * Sanitize filename for filesystem safety
     */
    private sanitizeFilename(name: string): string {
        return name
            .replace(/[<>:"/\\|?*]/g, '')
            .replace(/\s+/g, '_')
            .substring(0, 100);
    }
}
