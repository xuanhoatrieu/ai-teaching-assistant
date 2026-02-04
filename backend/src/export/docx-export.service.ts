import { Injectable, Logger } from '@nestjs/common';
import {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    AlignmentType,
    BorderStyle,
    Table,
    TableRow,
    TableCell,
    WidthType,
} from 'docx';
import { HandoutContent } from '../ai/gemini.service';

export interface DocxOptions {
    title?: string;
    author?: string;
    subject?: string;
}

@Injectable()
export class DocxExportService {
    private readonly logger = new Logger(DocxExportService.name);

    /**
     * Generate Handout DOCX from content
     */
    async generateHandout(content: HandoutContent, options?: DocxOptions): Promise<Buffer> {
        this.logger.log(`Generating Handout DOCX: ${content.title}`);

        const doc = new Document({
            creator: options?.author || 'AI Teaching Assistant',
            title: options?.title || content.title,
            subject: options?.subject || content.subject,
            sections: [
                {
                    properties: {},
                    children: this.buildHandoutContent(content),
                },
            ],
        });

        return Packer.toBuffer(doc);
    }

    private buildHandoutContent(content: HandoutContent): (Paragraph | Table)[] {
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

        // Subject
        if (content.subject) {
            children.push(
                new Paragraph({
                    text: content.subject,
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 600 },
                    children: [
                        new TextRun({
                            text: content.subject,
                            italics: true,
                            color: '666666',
                        }),
                    ],
                }),
            );
        }

        // Sections
        for (const section of content.sections) {
            // Section heading
            children.push(
                new Paragraph({
                    text: section.heading,
                    heading: HeadingLevel.HEADING_1,
                    spacing: { before: 400, after: 200 },
                }),
            );

            // Section content
            children.push(
                new Paragraph({
                    text: section.content,
                    spacing: { after: 200 },
                }),
            );

            // Key points
            if (section.keyPoints && section.keyPoints.length > 0) {
                children.push(
                    new Paragraph({
                        text: '📌 Key Points:',
                        spacing: { before: 200 },
                        children: [
                            new TextRun({ text: '📌 Key Points:', bold: true }),
                        ],
                    }),
                );

                for (const point of section.keyPoints) {
                    children.push(
                        new Paragraph({
                            text: point,
                            bullet: { level: 0 },
                            spacing: { after: 80 },
                        }),
                    );
                }
            }

            // Examples
            if (section.examples && section.examples.length > 0) {
                children.push(
                    new Paragraph({
                        text: '💡 Examples:',
                        spacing: { before: 200 },
                        children: [
                            new TextRun({ text: '💡 Examples:', bold: true }),
                        ],
                    }),
                );

                for (const example of section.examples) {
                    children.push(
                        new Paragraph({
                            text: example,
                            bullet: { level: 0 },
                            spacing: { after: 80 },
                            children: [
                                new TextRun({ text: example, italics: true }),
                            ],
                        }),
                    );
                }
            }
        }

        // Summary
        if (content.summary) {
            children.push(
                new Paragraph({
                    text: 'Summary',
                    heading: HeadingLevel.HEADING_1,
                    spacing: { before: 600, after: 200 },
                }),
            );

            children.push(
                new Paragraph({
                    text: content.summary,
                    spacing: { after: 400 },
                    border: {
                        top: { style: BorderStyle.SINGLE, size: 6, color: '3B82F6' },
                        bottom: { style: BorderStyle.SINGLE, size: 6, color: '3B82F6' },
                        left: { style: BorderStyle.SINGLE, size: 6, color: '3B82F6' },
                        right: { style: BorderStyle.SINGLE, size: 6, color: '3B82F6' },
                    },
                }),
            );
        }

        // Review Questions
        if (content.reviewQuestions && content.reviewQuestions.length > 0) {
            children.push(
                new Paragraph({
                    text: 'Review Questions',
                    heading: HeadingLevel.HEADING_1,
                    spacing: { before: 400, after: 200 },
                }),
            );

            content.reviewQuestions.forEach((question, index) => {
                children.push(
                    new Paragraph({
                        text: `${index + 1}. ${question}`,
                        spacing: { after: 120 },
                    }),
                );
            });
        }

        return children;
    }
}
