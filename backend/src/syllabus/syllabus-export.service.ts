/**
 * Syllabus DOCX Export Service
 *
 * Generates a TUAF-2026 compliant DOCX from syllabus blocks.
 * Key features:
 *   - Portrait sections for most blocks
 *   - Landscape section for "Nội dung chi tiết học phần" (content_detail)
 *   - Standard A4 margins (1440 twips = 1 inch)
 *   - Vietnamese typography (Times New Roman 13pt body)
 */

import { Injectable, Logger } from '@nestjs/common';
import { execFileSync, execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    AlignmentType,
    SectionType,
    PageOrientation,
    Table,
    TableRow,
    TableCell,
    WidthType,
    BorderStyle,
    VerticalAlign,
    VerticalMergeType,
    convertMillimetersToTwip,
} from 'docx';

/** Block content from database */
interface BlockData {
    blockType: string;
    title: string;
    content: string;
}

const FONT_NAME = 'Times New Roman';
const FONT_SIZE = 26; // 13pt in half-points
const HEADING_SIZE = 28; // 14pt
const TITLE_SIZE = 32; // 16pt

// A4 margins in twips (1cm ≈ 567 twips)
// top=2cm, bottom=2cm, left=3cm, right=2cm
const MARGIN = {
    top: 1134,    // 2cm
    bottom: 1134, // 2cm
    left: 1701,   // 3cm
    right: 1134,  // 2cm
};

@Injectable()
export class SyllabusExportService {
    private readonly logger = new Logger(SyllabusExportService.name);

    /**
     * Generate DOCX from syllabus blocks.
     */
    async generateDocx(blocks: BlockData[], subjectName: string): Promise<Buffer> {
        this.logger.log(`Generating syllabus DOCX: ${subjectName}, ${blocks.length} blocks`);

        // Split blocks into sections:
        // - Portrait (Section 1): header, general_info, lecturers, description, clo, materials, student_tasks
        // - Landscape (Section 2): assessment, content_detail (contains wide tables)
        // - Portrait (Section 3): update_log + signatures
        const beforeLandscape: BlockData[] = [];
        const landscapeBlocks: BlockData[] = [];
        const afterLandscape: BlockData[] = [];

        for (const block of blocks) {
            if (block.blockType === 'assessment' || block.blockType === 'content_detail') {
                landscapeBlocks.push(block);
            } else if (block.blockType === 'update_log') {
                afterLandscape.push(block);
            } else {
                beforeLandscape.push(block);
            }
        }

        const sections: any[] = [];

        // Section 1: Portrait — header through student_tasks
        sections.push({
            properties: {
                page: {
                    size: { width: 11906, height: 16838 }, // A4 portrait
                    margin: MARGIN,
                },
            },
            children: [
                ...this.buildBlocks(beforeLandscape),
            ],
        });

        // Section 2: Landscape — assessment and content_detail (wide tables)
        if (landscapeBlocks.length > 0) {
            sections.push({
                properties: {
                    type: SectionType.NEXT_PAGE,
                    page: {
                        size: {
                            width: 11906,
                            height: 16838,
                            orientation: PageOrientation.LANDSCAPE,
                        },
                        margin: {
                            top: 1134,    // 2cm
                            bottom: 1134, // 2cm
                            left: 1701,   // 3cm
                            right: 1134,  // 2cm
                        },
                    },
                },
                children: this.buildBlocks(landscapeBlocks),
            });
        }

        // Section 3: Portrait — update_log + signatures
        if (afterLandscape.length > 0) {
            sections.push({
                properties: {
                    type: SectionType.NEXT_PAGE,
                    page: {
                        size: { width: 11906, height: 16838 },
                        margin: MARGIN,
                    },
                },
                children: [
                    ...this.buildBlocks(afterLandscape),
                    ...this.buildSignatures(),
                ],
            });
        }

        const doc = new Document({
            creator: 'AI Teaching Assistant',
            title: `Đề cương - ${subjectName}`,
            styles: {
                default: {
                    document: {
                        run: {
                            font: FONT_NAME,
                            size: FONT_SIZE,
                        },
                        paragraph: {
                            spacing: { after: 120, line: 312 },
                            alignment: AlignmentType.JUSTIFIED,
                        },
                    },
                },
            },
            sections,
        });

        return Buffer.from(await Packer.toBuffer(doc));
    }

    // ==================== Document parts ====================

    private buildBlocks(blocks: BlockData[]): (Paragraph | Table)[] {
        const children: (Paragraph | Table)[] = [];
        for (const block of blocks) {
            children.push(...this.buildBlock(block));
        }
        return children;
    }

    private buildBlock(block: BlockData): (Paragraph | Table)[] {
        const children: (Paragraph | Table)[] = [];

        if (!block.content.trim()) return children;

        // Block heading (skip for header block)
        if (block.blockType !== 'header') {
            children.push(
                new Paragraph({
                    spacing: { before: 300, after: 120 },
                    children: [
                        new TextRun({
                            text: block.title,
                            font: FONT_NAME,
                            size: HEADING_SIZE,
                            bold: true,
                        }),
                    ],
                }),
            );
        }

        // Render content as an ordered sequence of text runs and tables.
        // A block (e.g. "assessment") may contain MULTIPLE tables interleaved
        // with text (plan table + several rubric tables), so we must walk the
        // whole content instead of extracting only the first table.
        const segments = this.splitIntoSegments(block.content);
        for (const seg of segments) {
            if (seg.type === 'table') {
                children.push(this.buildDocxTable(seg.table, block.blockType === 'header'));
            } else if (seg.text.trim()) {
                children.push(...this.buildLines(seg.text));
            }
        }

        return children;
    }

    /**
     * Split markdown content into an ordered list of text / table segments.
     * Consecutive table rows (header + separator + data rows) form one table
     * segment; everything else is text. This lets a single block render any
     * number of tables interleaved with paragraphs, in document order.
     */
    private splitIntoSegments(
        markdown: string,
    ): Array<{ type: 'text'; text: string } | { type: 'table'; table: { headers: string[]; rows: string[][] } }> {
        const segments: Array<{ type: 'text'; text: string } | { type: 'table'; table: { headers: string[]; rows: string[][] } }> = [];
        if (!markdown) return segments;

        const lines = markdown.split('\n');

        const isSeparatorRow = (line: string): boolean => {
            const trimmed = line.trim();
            if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return false;
            const parts = trimmed.slice(1, -1).split('|');
            if (parts.length === 0) return false;
            return parts.every((part) => /^\s*:?-+:?\s*$/.test(part));
        };
        const isTableRow = (line: string): boolean => {
            const trimmed = line.trim();
            return trimmed.startsWith('|') && trimmed.endsWith('|');
        };
        const parseRow = (line: string, colCount: number): string[] => {
            const cells = line.trim().slice(1, -1).split('|').map((cell) => cell.trim().replace(/<br\s*\/?>/gi, '\n'));
            while (cells.length < colCount) cells.push('');
            if (cells.length > colCount) cells.splice(colCount);
            return cells;
        };

        let textBuffer: string[] = [];
        const flushText = () => {
            if (textBuffer.length) {
                segments.push({ type: 'text', text: textBuffer.join('\n') });
                textBuffer = [];
            }
        };

        let i = 0;
        while (i < lines.length) {
            // Detect start of a table: a row followed by a separator row
            if (isTableRow(lines[i]) && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
                flushText();
                let headers = lines[i].trim().slice(1, -1).split('|').map((c) => c.trim());
                const colCount = headers.length;
                const rows: string[][] = [];
                let j = i + 2;
                while (j < lines.length && isTableRow(lines[j]) && !isSeparatorRow(lines[j])) {
                    rows.push(parseRow(lines[j], colCount));
                    j++;
                }
                // Many TUAF-2026 templates use an EMPTY markdown header row (e.g. "|  |  |")
                // followed by the real (bold) heading as the first data row. Rendering the
                // empty header produces a blank first row above the title. Drop it and
                // promote the first data row to be the header instead.
                if (headers.every((h) => h === '') && rows.length > 0) {
                    headers = rows.shift() as string[];
                }
                segments.push({ type: 'table', table: { headers, rows } });
                i = j;
            } else {
                textBuffer.push(lines[i]);
                i++;
            }
        }
        flushText();

        return segments;
    }

    private buildLines(text: string): Paragraph[] {
        const paragraphs: Paragraph[] = [];
        const lines = text.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
                paragraphs.push(new Paragraph({ spacing: { after: 60 } }));
                continue;
            }

            // Detect bullet/list items
            const isBullet = /^[-•*]\s/.test(trimmed);
            if (isBullet) {
                paragraphs.push(
                    new Paragraph({
                        bullet: { level: 0 },
                        spacing: { after: 60 },
                        children: [
                            new TextRun({
                                text: trimmed.replace(/^[-•*]\s/, ''),
                                font: FONT_NAME,
                                size: FONT_SIZE,
                            }),
                        ],
                    }),
                );
            } else {
                // Check for bold markers (**text**)
                const parts = this.parseInlineFormatting(trimmed);
                paragraphs.push(
                    new Paragraph({
                        spacing: { after: 80 },
                        alignment: AlignmentType.JUSTIFIED,
                        children: parts,
                    }),
                );
            }
        }
        return paragraphs;
    }

    private buildDocxTable(parsed: { headers: string[]; rows: string[][] }, isHeaderBlock = false): Table {
        const { headers, rows } = parsed;
        const tableRows: TableRow[] = [];
        const numCols = headers.length;

        // Build header row
        const headerCells: TableCell[] = [];
        for (let c = 0; c < numCols; c++) {
            const value = headers[c];
            if (value === '>') {
                continue;
            }
            let colSpan = 1;
            while (c + colSpan < numCols && headers[c + colSpan] === '>') {
                colSpan++;
            }
            headerCells.push(this.createTableCell(value, true, colSpan, undefined, isHeaderBlock));
        }
        tableRows.push(
            new TableRow({
                tableHeader: true,
                children: headerCells,
            }),
        );

        // Build data rows
        const numRows = rows.length;
        for (let r = 0; r < numRows; r++) {
            const rowCells: TableCell[] = [];
            for (let c = 0; c < numCols; c++) {
                const value = rows[r][c];
                if (value === '>') {
                    continue;
                }

                if (value === '^') {
                    // vertical merge continue cell
                    let colSpan = 1;
                    while (c + colSpan < numCols && rows[r][c + colSpan] === '>') {
                        colSpan++;
                    }
                    rowCells.push(this.createTableCell('', false, colSpan, VerticalMergeType.CONTINUE, isHeaderBlock));
                } else {
                    // normal cell or vertical merge restart
                    let colSpan = 1;
                    while (c + colSpan < numCols && rows[r][c + colSpan] === '>') {
                        colSpan++;
                    }
                    let rowSpan = 1;
                    while (r + rowSpan < numRows && rows[r + rowSpan][c] === '^') {
                        rowSpan++;
                    }
                    
                    const vMerge = rowSpan > 1 ? VerticalMergeType.RESTART : undefined;
                    rowCells.push(this.createTableCell(value, false, colSpan, vMerge, isHeaderBlock));
                }
            }
            tableRows.push(
                new TableRow({
                    children: rowCells,
                }),
            );
        }

        return new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: isHeaderBlock ? {
                top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
                bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
                left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
                right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
                insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
                insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' },
            } : {
                top: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
                bottom: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
                left: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
                right: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
                insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
                insideVertical: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
            },
            rows: tableRows,
        });
    }

    private createTableCell(
        cellContent: string, 
        isHeader: boolean, 
        colSpan: number, 
        vMerge?: (typeof VerticalMergeType)[keyof typeof VerticalMergeType],
        isHeaderBlock = false
    ): TableCell {
        if (vMerge === VerticalMergeType.CONTINUE) {
            return new TableCell({
                columnSpan: colSpan,
                verticalMerge: VerticalMergeType.CONTINUE,
                margins: {
                    top: 100,
                    bottom: 100,
                    left: 150,
                    right: 150,
                },
                children: [
                    new Paragraph({
                        spacing: { before: 0, after: 0 },
                        children: [],
                    })
                ],
            });
        }

        const paragraphs: Paragraph[] = [];
        if (!cellContent.trim()) {
            paragraphs.push(new Paragraph({
                spacing: { before: 0, after: 0 },
                children: []
            }));
        } else {
            const lines = cellContent.split('\n');
            for (const line of lines) {
                const inlineRuns = this.parseInlineFormatting(line, isHeader);
                paragraphs.push(new Paragraph({
                    alignment: isHeader ? AlignmentType.CENTER : AlignmentType.LEFT,
                    spacing: { before: 60, after: 60, line: 240 },
                    children: inlineRuns,
                }));
            }
        }

        return new TableCell({
            columnSpan: colSpan,
            verticalMerge: vMerge === VerticalMergeType.RESTART ? VerticalMergeType.RESTART : undefined,
            shading: (isHeader && !isHeaderBlock) ? { fill: 'F2F2F2' } : undefined,
            margins: {
                top: 100,
                bottom: 100,
                left: 150,
                right: 150,
            },
            children: paragraphs,
        });
    }

    /**
     * Parse simple inline **bold** and *italic* markers into TextRun array.
     */
    private parseInlineFormatting(text: string, forceBold = false): TextRun[] {
        const runs: TextRun[] = [];
        // Simple regex to match **bold** and *italic*
        const regex = /(\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
        let lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(text)) !== null) {
            // Text before match
            if (match.index > lastIndex) {
                runs.push(new TextRun({
                    text: text.slice(lastIndex, match.index),
                    font: FONT_NAME,
                    size: FONT_SIZE,
                    bold: forceBold ? true : undefined,
                }));
            }

            if (match[2]) {
                // Bold
                runs.push(new TextRun({
                    text: match[2],
                    font: FONT_NAME,
                    size: FONT_SIZE,
                    bold: true,
                }));
            } else if (match[3]) {
                // Italic
                runs.push(new TextRun({
                    text: match[3],
                    font: FONT_NAME,
                    size: FONT_SIZE,
                    italics: true,
                    bold: forceBold ? true : undefined,
                }));
            }

            lastIndex = match.index + match[0].length;
        }

        // Remaining text
        if (lastIndex < text.length) {
            runs.push(new TextRun({
                text: text.slice(lastIndex),
                font: FONT_NAME,
                size: FONT_SIZE,
                bold: forceBold ? true : undefined,
            }));
        }

        // If no formatting found, return plain text
        if (runs.length === 0) {
            runs.push(new TextRun({ text, font: FONT_NAME, size: FONT_SIZE, bold: forceBold ? true : undefined }));
        }

        return runs;
    }

    /**
     * Build signature block at the end (TRƯỞNG KHOA / TRƯỞNG BỘ MÔN / GIẢNG VIÊN)
     */
    private buildSignatures(): Paragraph[] {
        return [
            new Paragraph({ spacing: { before: 600 } }),
            new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                    new TextRun({ text: '     TRƯỞNG KHOA               ', font: FONT_NAME, size: FONT_SIZE, bold: true }),
                    new TextRun({ text: '     TRƯỞNG BỘ MÔN               ', font: FONT_NAME, size: FONT_SIZE, bold: true }),
                    new TextRun({ text: '     GIẢNG VIÊN BIÊN SOẠN', font: FONT_NAME, size: FONT_SIZE, bold: true }),
                ],
            }),
        ];
    }

    // ==================== Textbook DOCX Export ====================

    private async getPandocCommand(): Promise<string> {
        const defaultCmd = 'pandoc';
        
        // 1. Try default system-wide command
        const works = await new Promise<boolean>((resolve) => {
            execFile(defaultCmd, ['--version'], (err) => {
                resolve(!err);
            });
        });
        if (works) return defaultCmd;

        // 2. Try common paths
        const home = os.homedir();
        const commonPaths = [
            path.join(process.cwd(), '.local/bin/pandoc'),
            path.join(home, '.local/bin/pandoc'),
            '/usr/local/bin/pandoc',
            '/usr/bin/pandoc',
        ];

        for (const p of commonPaths) {
            if (fs.existsSync(p)) {
                this.logger.log(`Found pandoc at fallback path: ${p}`);
                return p;
            }
        }

        return defaultCmd;
    }

    /**
     * Resolve a bundled asset (reference.docx, docx_postprocess.py).
     * The compiled code runs from dist/, but the `assets` folder may live either
     * next to dist (dist/assets, when nest-cli copies it) or at the project root
     * (backend/assets, the source location). Try the known locations in order.
     */
    private resolveAssetPath(fileName: string): string {
        const candidates = [
            path.resolve(__dirname, '..', '..', 'assets', fileName), // dist/assets (copied)
            path.resolve(process.cwd(), 'assets', fileName),         // backend/assets (source)
            path.resolve(process.cwd(), 'dist', 'assets', fileName),
        ];
        for (const p of candidates) {
            if (fs.existsSync(p)) return p;
        }
        // Fall back to the first candidate so the error message is meaningful
        this.logger.warn(`Asset "${fileName}" not found in: ${candidates.join(', ')}`);
        return candidates[0];
    }

    /**
     * Generate a DOCX file combining all lessons' textbook content.
     * Uses Pandoc for conversion — the same approach as the /export skill.
     * Pandoc handles tables, math, code blocks, blockquotes, and all
     * markdown formatting natively with professional Word output.
     */
    async generateTextbookDocx(
        lessons: { title: string; sortOrder: number; textbookContent: string | null }[],
        subjectName: string,
    ): Promise<Buffer> {
        this.logger.log(`Generating textbook DOCX: ${subjectName}, ${lessons.length} lessons`);
        return this.renderMarkdownChaptersDocx(
            lessons.map((l) => ({
                title: l.title,
                sortOrder: l.sortOrder,
                content: l.textbookContent,
            })),
            'GIÁO TRÌNH',
            subjectName,
            'textbook',
        );
    }

    /**
     * Generate a DOCX file combining lessons' hands-on practice guides.
     * Uses the same Pandoc + TUAF reference.docx + code-block styling pipeline as Textbook DOCX,
     * while keeping Practice Guide completely separate and parallel to Textbook.
     */
    async generatePracticeDocx(
        lessons: { title: string; sortOrder: number; practiceContent: string | null }[],
        subjectName: string,
    ): Promise<Buffer> {
        this.logger.log(`Generating practice guide DOCX: ${subjectName}, ${lessons.length} lessons`);
        return this.renderMarkdownChaptersDocx(
            lessons.map((l) => ({
                title: l.title,
                sortOrder: l.sortOrder,
                content: l.practiceContent,
            })),
            'TÀI LIỆU HƯỚNG DẪN THỰC HÀNH',
            subjectName,
            'practice',
        );
    }

    /**
     * Shared Pandoc Markdown-to-DOCX renderer for Textbook & Practice Guide exports.
     * Uses execFileSync (no shell interpolation) and strict path-containment validation for embedded images.
     */
    private async renderMarkdownChaptersDocx(
        chapters: { title: string; sortOrder: number; content: string | null }[],
        docTitle: string,
        subjectName: string,
        tmpPrefix: string,
    ): Promise<Buffer> {
        const profile: 'textbook' | 'practice' = tmpPrefix === 'practice' ? 'practice' : 'textbook';
        const mdParts: string[] = [];
        const safeSubjectTitle = subjectName.replace(/[\r\n]+/g, ' ').trim();

        // YAML front-matter for Pandoc metadata (JSON.stringify safely escapes quotes/backslashes)
        mdParts.push(`---`);
        mdParts.push(`title: ${JSON.stringify(docTitle)}`);
        mdParts.push(`subtitle: ${JSON.stringify(safeSubjectTitle)}`);
        mdParts.push(`---\n`);

        const resolvedTextbookUploadsRoot = path.resolve(process.cwd(), 'uploads', 'syllabus-textbook');
        const sanitizedChapters: { title: string; sortOrder: number; content: string | null }[] = [];

        let renderedCount = 0;
        for (const lesson of chapters) {
            if (!lesson.content?.trim()) continue;

            const paddedNum = String(lesson.sortOrder + 1).padStart(2, '0');
            const cleanedTitle = lesson.title.replace(/^Bài\s*\d+\s*[:.\\-]\s*/i, '');

            // Pre-process markdown: normalize bullets and math notation
            let md = lesson.content;
            // Convert ● bullets to standard markdown bullets
            md = md.replace(/^[●•]\s*/gm, '- ');
            // Convert LaTeX display math \[...\] to $$...$$
            md = md.replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_m, p1) => `$$${p1}$$`);
            // Convert LaTeX inline math \(...\) to $...$
            md = md.replace(/\\\(\s*([^)]*?)\s*\\\)/g, (_m, p1) => `$${p1}$`);
            // Convert standalone display math [ expr ] on its own line
            md = md.replace(/^\[\s*(.+?)\s*\]$/gm, (_m, p1) => `$$${p1}$$`);

            // Convert image URLs to validated absolute file paths for Pandoc embedding
            md = md.replace(
                /!\[([^\]]*)\]\(\/files\/public\/syllabus-textbook\/([^)]+)\)/g,
                (_m, caption, relPath) => {
                    const candidate = path.resolve(resolvedTextbookUploadsRoot, relPath);
                    if (!candidate.startsWith(resolvedTextbookUploadsRoot + path.sep)) {
                        this.logger.warn(`Blocked out-of-bounds image path in DOCX export: ${relPath}`);
                        return '';
                    }
                    return `![${caption}](${candidate})`;
                },
            );

            // Convert ```output blocks to plain text blocks (Pandoc doesn't know "output" language)
            md = md.replace(/```output/g, '```text');

            // Strip leftover ILLUSTRATION markers
            md = md.replace(/<!-- ILLUSTRATION:\s*\{[^}]+\}\s*-->/g, '');

            sanitizedChapters.push({ title: lesson.title, sortOrder: lesson.sortOrder, content: md });

            if (profile !== 'practice' || renderedCount > 0) {
                mdParts.push(`\\newpage\n`);
            }
            mdParts.push(`# Bài ${paddedNum}: ${cleanedTitle}\n`);
            mdParts.push(md);
            mdParts.push('\n');
            renderedCount++;
        }

        const fullMd = mdParts.join('\n');

        const tmpDir = os.tmpdir();
        const uniqueSuffix = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
        const tmpMd = path.join(tmpDir, `${tmpPrefix}_${uniqueSuffix}.md`);
        const tmpDocx = path.join(tmpDir, `${tmpPrefix}_${uniqueSuffix}.docx`);

        try {
            fs.writeFileSync(tmpMd, fullMd, 'utf-8');

            const refDoc = this.resolveAssetPath('reference.docx');
            const pandoc = await this.getPandocCommand();
            const pandocArgs = [
                tmpMd,
                '-o',
                tmpDocx,
                '-f',
                'markdown',
                '-t',
                'docx',
                '--standalone',
                '--wrap=none',
                '--highlight-style=tango',
                `--reference-doc=${refDoc}`,
            ];

            this.logger.log(`Running Pandoc (${tmpPrefix}): ${pandoc} ${pandocArgs.join(' ')}`);
            try {
                execFileSync(pandoc, pandocArgs, { timeout: 60_000 });
            } catch (pandocErr: any) {
                if (pandocErr?.code === 'ENOENT') {
                    this.logger.warn(`Pandoc binary not found on host; falling back to pure-JS docx renderer (${tmpPrefix})`);
                    const fallbackBuf = await this.buildFallbackChaptersDocx(sanitizedChapters, docTitle, safeSubjectTitle, profile);
                    const tmpFallbackIn = path.join(tmpDir, `${tmpPrefix}_fb_${uniqueSuffix}.docx`);
                    try {
                        fs.writeFileSync(tmpFallbackIn, fallbackBuf);
                        const styledFallback = this.tryRunDocxPostprocess(tmpFallbackIn, profile, tmpPrefix);
                        if (styledFallback) return styledFallback;
                    } finally {
                        try { fs.unlinkSync(tmpFallbackIn); } catch { /* ignore */ }
                    }
                    return fallbackBuf;
                }
                throw pandocErr;
            }

            const styledBuffer = this.tryRunDocxPostprocess(tmpDocx, profile, tmpPrefix);
            if (styledBuffer) {
                return styledBuffer;
            }

            const docxBuffer = fs.readFileSync(tmpDocx);
            this.logger.log(`Pandoc DOCX generated (${tmpPrefix}): ${docxBuffer.length} bytes`);

            return Buffer.from(docxBuffer);
        } finally {
            try { fs.unlinkSync(tmpMd); } catch { /* ignore */ }
            try { fs.unlinkSync(tmpDocx); } catch { /* ignore */ }
        }
    }

    /**
     * Run Python docx_postprocess.py on an existing DOCX file with the requested profile.
     */
    private tryRunDocxPostprocess(
        inputDocxPath: string,
        profile: 'textbook' | 'practice',
        tmpPrefix: string,
    ): Buffer | null {
        const postprocessScript = this.resolveAssetPath('docx_postprocess.py');
        const tmpDocxStyled = inputDocxPath.replace(/\.docx$/, '_styled.docx');
        try {
            try {
                execFileSync('python3', ['-c', 'import docx'], { timeout: 5_000, stdio: 'pipe' });
            } catch {
                this.logger.log('python-docx not found, installing...');
                execFileSync('pip3', ['install', '--break-system-packages', 'python-docx'], {
                    timeout: 60_000,
                    stdio: 'pipe',
                });
                this.logger.log('python-docx installed successfully');
            }
            execFileSync('python3', [postprocessScript, inputDocxPath, tmpDocxStyled, '--profile', profile], {
                timeout: 30_000,
            });
            if (fs.existsSync(tmpDocxStyled)) {
                const styledBuffer = fs.readFileSync(tmpDocxStyled);
                this.logger.log(`Post-processed DOCX (${tmpPrefix}, profile=${profile}): ${styledBuffer.length} bytes`);
                return Buffer.from(styledBuffer);
            }
        } catch (ppErr: any) {
            this.logger.warn(`Post-processing failed (using unstyled DOCX): ${ppErr.message}`);
        } finally {
            try { fs.unlinkSync(tmpDocxStyled); } catch { /* ignore */ }
        }
        return null;
    }

    /**
     * Pure-JS DOCX fallback when `pandoc` is not installed on a local dev/CI host.
     * Applies TUAF/Practice page setup (A4, left 3cm, T/R/B 2cm), TNR 13pt, 1.3x line spacing, 4pt paragraph after,
     * and zero-spacing tables (centered header & numeric cols, left-middle text cols).
     */
    private async buildFallbackChaptersDocx(
        chapters: { title: string; sortOrder: number; content: string | null }[],
        docTitle: string,
        subjectName: string,
        profile: 'textbook' | 'practice' = 'textbook',
    ): Promise<Buffer> {
        const isPractice = profile === 'practice';
        const bodySpacing = isPractice ? { before: 0, after: 80, line: 312 } : { after: 120, line: 312 };

        const children: (Paragraph | Table)[] = [
            new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 120, after: 80, line: 312 },
                children: [
                    new TextRun({ text: docTitle, font: FONT_NAME, size: isPractice ? 30 : TITLE_SIZE, bold: true }),
                ],
            }),
        ];

        if (subjectName) {
            children.push(
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 0, after: 160, line: 312 },
                    children: [
                        new TextRun({ text: subjectName, font: FONT_NAME, size: isPractice ? 26 : HEADING_SIZE, bold: true }),
                    ],
                }),
            );
        }

        let chapterIdx = 0;
        for (const lesson of chapters) {
            if (!lesson.content?.trim()) continue;
            const paddedNum = String(lesson.sortOrder + 1).padStart(2, '0');
            const cleanedTitle = lesson.title.replace(/^Bài\s*\d+\s*[:.\\-]\s*/i, '');

            children.push(
                new Paragraph({
                    heading: HeadingLevel.HEADING_1,
                    pageBreakBefore: chapterIdx > 0,
                    spacing: { before: 120, after: 80, line: 312 },
                    children: [
                        new TextRun({
                            text: `Bài ${paddedNum}: ${cleanedTitle}`,
                            font: FONT_NAME,
                            size: isPractice ? 28 : TITLE_SIZE,
                            bold: true,
                        }),
                    ],
                }),
            );
            chapterIdx++;

            // Strip HTML illustration comments and split around fenced code blocks
            const cleanedMd = lesson.content.replace(/<!-- ILLUSTRATION:\s*\{[^}]+\}\s*-->/g, '');
            const codeSplit = cleanedMd.split(/(```[\s\S]*?```)/g);

            for (const part of codeSplit) {
                if (!part.trim()) continue;
                if (part.startsWith('```') && part.endsWith('```')) {
                    const codeLines = part.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '').split('\n');
                    for (const cLine of codeLines) {
                        children.push(
                            new Paragraph({
                                alignment: AlignmentType.LEFT,
                                spacing: { before: 0, after: 20, line: 264 },
                                shading: { fill: 'F5F5F5' },
                                children: [
                                    new TextRun({
                                        text: cLine || ' ',
                                        font: 'Consolas',
                                        size: 20, // 10pt
                                    }),
                                ],
                            }),
                        );
                    }
                } else {
                    const segments = this.splitIntoSegments(part);
                    for (const seg of segments) {
                        if (seg.type === 'table') {
                            children.push(
                                isPractice
                                    ? this.buildPracticeFallbackTable(seg.table)
                                    : this.buildDocxTable(seg.table, false),
                            );
                        } else if (seg.text.trim()) {
                            for (const line of seg.text.split('\n')) {
                                const trimmed = line.trim();
                                const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
                                if (headingMatch) {
                                    const level = headingMatch[1].length;
                                    children.push(
                                        new Paragraph({
                                            alignment: AlignmentType.LEFT,
                                            spacing: isPractice
                                                ? { before: 120, after: 80, line: 312 }
                                                : { before: 220, after: 100 },
                                            children: [
                                                new TextRun({
                                                    text: headingMatch[2].replace(/\*\*/g, ''),
                                                    font: FONT_NAME,
                                                    size: isPractice
                                                        ? level === 1
                                                            ? 28
                                                            : FONT_SIZE
                                                        : level <= 2
                                                          ? HEADING_SIZE
                                                          : FONT_SIZE,
                                                    bold: true,
                                                }),
                                            ],
                                        }),
                                    );
                                } else if (isPractice) {
                                    if (!trimmed) continue;
                                    const isBullet = /^[-•*]\s/.test(trimmed);
                                    const textContent = isBullet ? trimmed.replace(/^[-•*]\s+/, '') : trimmed;
                                    children.push(
                                        new Paragraph({
                                            ...(isBullet ? { bullet: { level: 0 } } : {}),
                                            alignment: AlignmentType.JUSTIFIED,
                                            spacing: bodySpacing,
                                            children: this.parseInlineFormatting(textContent),
                                        }),
                                    );
                                } else {
                                    children.push(...this.buildLines(line));
                                }
                            }
                        }
                    }
                }
            }
        }

        const doc = new Document({
            creator: 'AI Teaching Assistant',
            title: `${docTitle} - ${subjectName}`,
            styles: {
                default: {
                    document: {
                        run: { font: FONT_NAME, size: FONT_SIZE },
                        paragraph: { spacing: bodySpacing, alignment: AlignmentType.JUSTIFIED },
                    },
                },
            },
            sections: [
                {
                    properties: {
                        page: {
                            size: { width: 11906, height: 16838 },
                            margin: MARGIN,
                        },
                    },
                    children,
                },
            ],
        });

        return Buffer.from(await Packer.toBuffer(doc));
    }

    /**
     * Build a table adhering strictly to Practice Guide rules:
     * - Zero line/paragraph spacing (single line, before=0, after=0)
     * - Vertical alignment = CENTER for all cells
     * - Header row = CENTER horizontal + bold
     * - Numeric/data columns = CENTER horizontal; text columns = LEFT horizontal ("trái ở giữa")
     */
    private buildPracticeFallbackTable(parsed: { headers: string[]; rows: string[][] }): Table {
        const { headers, rows } = parsed;
        const numCols = headers.length;
        const numericCols = this.detectNumericColumnsJs(headers, rows);

        const makeCell = (text: string, isHeader: boolean, isNumeric: boolean) => {
            const lines = (text || '').split('\n');
            const alignment = isHeader || isNumeric ? AlignmentType.CENTER : AlignmentType.LEFT;
            const paragraphs = lines.map(
                (ln) =>
                    new Paragraph({
                        alignment,
                        spacing: { before: 0, after: 0, line: 240 },
                        children: this.parseInlineFormatting(ln, isHeader),
                    }),
            );
            return new TableCell({
                verticalAlign: VerticalAlign.CENTER,
                shading: isHeader ? { fill: 'F2F2F2' } : undefined,
                margins: { top: 60, bottom: 60, left: 100, right: 100 },
                children: paragraphs.length > 0 ? paragraphs : [new Paragraph({ spacing: { before: 0, after: 0, line: 240 } })],
            });
        };

        const tableRows: TableRow[] = [
            new TableRow({
                tableHeader: true,
                cantSplit: true,
                children: headers.map((h) => makeCell(h, true, false)),
            }),
            ...rows.map(
                (row) =>
                    new TableRow({
                        cantSplit: true,
                        children: Array.from({ length: numCols }, (_, c) =>
                            makeCell(row[c] ?? '', false, numericCols.has(c)),
                        ),
                    }),
            ),
        ];

        return new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
                top: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
                bottom: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
                left: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
                right: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
                insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
                insideVertical: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
            },
            rows: tableRows,
        });
    }

    private detectNumericColumnsJs(headers: string[], rows: string[][]): Set<number> {
        const numericRe =
            /^([-+]?\d+(?:[.,]\d+)?(\s*(%|cm|mm|m|km|ml|l|g|kg|mg|ug|µg|°c|c|k|v|mv|a|ma|w|kw|hz|khz|mhz|s|ms|phút|giờ|tiết|đ|đ\.|điểm|lần|mẫu|px))?|\d+\s*[:/×x\-–]\s*\d+|[.\-_]{2,})$/i;
        const headerHintRe =
            /^(stt|tt|số\s*tt|thứ\s*tự|số\s*lượng|trọng\s*số(\s*\(%\))?|điểm(\s*tối\s*đa)?|tỷ\s*lệ(\s*\(%\))?|lần\s*\d+|mẫu\s*\d+|thời\s*lượng|thời\s*gian)$/i;

        const out = new Set<number>();
        if (rows.length === 0) return out;
        for (let c = 0; c < headers.length; c++) {
            const hdr = (headers[c] || '').trim();
            const vals = rows.map((r) => (r[c] || '').trim()).filter(Boolean);
            if (vals.length === 0) {
                if (headerHintRe.test(hdr)) out.add(c);
                continue;
            }
            const ratio = vals.filter((v) => numericRe.test(v)).length / vals.length;
            const avgLen = vals.reduce((s, v) => s + v.length, 0) / vals.length;
            if (ratio >= 0.7 || (headerHintRe.test(hdr) && avgLen <= 24)) {
                out.add(c);
            }
        }
        return out;
    }
}
