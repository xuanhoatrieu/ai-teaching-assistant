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

        // Split blocks into sections: portrait (before content_detail),
        // landscape (content_detail), portrait (after content_detail)
        const beforeLandscape: BlockData[] = [];
        let landscapeBlock: BlockData | null = null;
        const afterLandscape: BlockData[] = [];

        let foundLandscape = false;
        for (const block of blocks) {
            if (block.blockType === 'content_detail') {
                landscapeBlock = block;
                foundLandscape = true;
            } else if (!foundLandscape) {
                beforeLandscape.push(block);
            } else {
                afterLandscape.push(block);
            }
        }

        const sections: any[] = [];

        // Section 1: Portrait — header through assessment
        sections.push({
            properties: {
                page: {
                    size: { width: 11906, height: 16838 }, // A4 portrait
                    margin: MARGIN,
                },
            },
            children: [
                ...this.buildTitlePage(subjectName),
                ...this.buildBlocks(beforeLandscape),
            ],
        });

        // Section 2: Landscape — content_detail (wide table)
        if (landscapeBlock && landscapeBlock.content.trim()) {
            sections.push({
                properties: {
                    type: SectionType.NEXT_PAGE,
                    page: {
                        size: {
                            width: 16838,
                            height: 11906,
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
                children: this.buildBlock(landscapeBlock),
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

    private buildTitlePage(subjectName: string): Paragraph[] {
        return [
            // University header
            new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 0 },
                children: [
                    new TextRun({
                        text: 'TRƯỜNG ĐẠI HỌC NÔNG LÂM',
                        font: FONT_NAME,
                        size: HEADING_SIZE,
                        bold: true,
                    }),
                ],
            }),
            new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 200 },
                children: [
                    new TextRun({
                        text: 'KHOA ……',
                        font: FONT_NAME,
                        size: HEADING_SIZE,
                        bold: true,
                    }),
                ],
            }),
            // Title
            new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 400, after: 200 },
                children: [
                    new TextRun({
                        text: 'ĐỀ CƯƠNG HỌC PHẦN',
                        font: FONT_NAME,
                        size: TITLE_SIZE,
                        bold: true,
                    }),
                ],
            }),
            // Subject name
            new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 400 },
                children: [
                    new TextRun({
                        text: subjectName,
                        font: FONT_NAME,
                        size: HEADING_SIZE,
                        bold: true,
                    }),
                ],
            }),
        ];
    }

    private buildBlocks(blocks: BlockData[]): (Paragraph | Table)[] {
        const children: (Paragraph | Table)[] = [];
        for (const block of blocks) {
            children.push(...this.buildBlock(block));
        }
        return children;
    }

    private buildBlock(block: BlockData): (Paragraph | Table)[] {
        const children: (Paragraph | Table)[] = [];

        // Skip header block (handled in title page) and empty blocks
        if (block.blockType === 'header') return children;
        if (!block.content.trim()) return children;

        // Block heading
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

        // Check if there is a table in this block
        const parsedTable = this.parseMarkdownTable(block.content);
        if (parsedTable) {
            // Render text before the table
            if (parsedTable.beforeText) {
                children.push(...this.buildLines(parsedTable.beforeText));
            }

            // Build the Word Table
            children.push(this.buildDocxTable(parsedTable));

            // Render text after the table
            if (parsedTable.afterText) {
                children.push(...this.buildLines(parsedTable.afterText));
            }
        } else {
            // Fallback: standard line-by-line rendering
            children.push(...this.buildLines(block.content));
        }

        return children;
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

    private parseMarkdownTable(markdown: string): { beforeText: string; headers: string[]; rows: string[][]; afterText: string } | null {
        if (!markdown) return null;
        
        const lines = markdown.split('\n');
        let tableStartIndex = -1;
        let tableEndIndex = -1;

        const isSeparatorRow = (line: string): boolean => {
            const trimmed = line.trim();
            if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return false;
            const inner = trimmed.slice(1, -1);
            const parts = inner.split('|');
            if (parts.length === 0) return false;
            return parts.every(part => /^\s*:?-+:?\s*$/.test(part));
        };

        const isTableRow = (line: string): boolean => {
            const trimmed = line.trim();
            return trimmed.startsWith('|') && trimmed.endsWith('|');
        };

        for (let i = 0; i < lines.length - 1; i++) {
            if (isTableRow(lines[i]) && isSeparatorRow(lines[i + 1])) {
                tableStartIndex = i;
                break;
            }
        }

        if (tableStartIndex === -1) {
            return null;
        }

        tableEndIndex = tableStartIndex + 1;
        while (tableEndIndex + 1 < lines.length && isTableRow(lines[tableEndIndex + 1])) {
            tableEndIndex++;
        }

        const beforeText = lines.slice(0, tableStartIndex).join('\n').trim();
        const afterText = lines.slice(tableEndIndex + 1).join('\n').trim();

        const headerLine = lines[tableStartIndex].trim().slice(1, -1);
        const headers = headerLine.split('|').map(cell => cell.trim());

        const rows: string[][] = [];
        for (let i = tableStartIndex + 2; i <= tableEndIndex; i++) {
            const rowLine = lines[i].trim().slice(1, -1);
            const cells = rowLine.split('|').map(cell => {
                let val = cell.trim();
                // Replace <br>, <br/>, <br /> (case-insensitive) with actual newlines
                val = val.replace(/<br\s*\/?>/gi, '\n');
                return val;
            });

            while (cells.length < headers.length) {
                cells.push('');
            }
            if (cells.length > headers.length) {
                cells.splice(headers.length);
            }
            rows.push(cells);
        }

        return {
            beforeText,
            headers,
            rows,
            afterText,
        };
    }

    private buildDocxTable(parsed: { headers: string[]; rows: string[][] }): Table {
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
            headerCells.push(this.createTableCell(value, true, colSpan));
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
                    rowCells.push(this.createTableCell('', false, colSpan, VerticalMergeType.CONTINUE));
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
                    rowCells.push(this.createTableCell(value, false, colSpan, vMerge));
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

    private createTableCell(
        cellContent: string, 
        isHeader: boolean, 
        colSpan: number, 
        vMerge?: (typeof VerticalMergeType)[keyof typeof VerticalMergeType]
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
            shading: isHeader ? { fill: 'F2F2F2' } : undefined,
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

    /** Path to Pandoc binary (installed locally) */
    private readonly PANDOC_PATH = '/home/trieuhoa/ai-teaching-assistant/.local/bin/pandoc';

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

        const { execSync } = await import('child_process');
        const fs = await import('fs');
        const path = await import('path');
        const os = await import('os');

        // Build combined markdown document
        const mdParts: string[] = [];

        // YAML front-matter for Pandoc metadata
        mdParts.push(`---`);
        mdParts.push(`title: "GIÁO TRÌNH"`);
        mdParts.push(`subtitle: "${subjectName}"`);
        mdParts.push(`---\n`);

        // Each lesson as a chapter
        for (const lesson of lessons) {
            if (!lesson.textbookContent?.trim()) continue;

            const paddedNum = String(lesson.sortOrder + 1).padStart(2, '0');
            const cleanedTitle = lesson.title.replace(/^Bài\s*\d+\s*[:.\\-]\s*/i, '');

            // Pre-process markdown: normalize bullets and math notation
            let md = lesson.textbookContent;
            // Convert ● bullets to standard markdown bullets
            md = md.replace(/^[●•]\s*/gm, '- ');
            // Convert LaTeX display math \[...\] to $$...$$
            md = md.replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_m, p1) => `$$${p1}$$`);
            // Convert LaTeX inline math \(...\) to $$
            md = md.replace(/\\\(\s*([^)]*?)\s*\\\)/g, (_m, p1) => `$${p1}$`);
            // Convert standalone display math [ expr ] on its own line
            md = md.replace(/^\[\s*(.+?)\s*\]$/gm, (_m, p1) => `$$${p1}$$`);

            // Convert image URLs to absolute file paths for Pandoc embedding
            // e.g., ![caption](/files/public/syllabus-textbook/abc/def/assets/diagram_001.png)
            // → ![caption](/absolute/path/uploads/syllabus-textbook/abc/def/assets/diagram_001.png)
            const uploadsDir = path.join(process.cwd(), 'uploads');
            md = md.replace(
                /!\[([^\]]*)\]\(\/files\/public\/syllabus-textbook\/([^)]+)\)/g,
                (_m, caption, relPath) => `![${caption}](${path.join(uploadsDir, 'syllabus-textbook', relPath)})`,
            );

            // Convert ```output blocks to plain text blocks (Pandoc doesn't know "output" language)
            md = md.replace(/```output/g, '```text');

            // Strip leftover ILLUSTRATION markers
            md = md.replace(/<!-- ILLUSTRATION:\s*\{[^}]+\}\s*-->/g, '');

            mdParts.push(`\\newpage\n`);
            mdParts.push(`# Bài ${paddedNum}: ${cleanedTitle}\n`);
            mdParts.push(md);
            mdParts.push('\n');
        }

        const fullMd = mdParts.join('\n');

        // Write to temp file
        const tmpDir = os.tmpdir();
        const tmpMd = path.join(tmpDir, `textbook_${Date.now()}.md`);
        const tmpDocx = path.join(tmpDir, `textbook_${Date.now()}.docx`);

        try {
            fs.writeFileSync(tmpMd, fullMd, 'utf-8');

            // Run Pandoc to convert Markdown → DOCX
            // Uses reference.docx template: TNR 13pt, justified, A4 2cm/3cm margins
            const refDoc = '/home/trieuhoa/ai-teaching-assistant/backend/assets/reference.docx';
            const pandocCmd = [
                this.PANDOC_PATH,
                JSON.stringify(tmpMd),
                '-o', JSON.stringify(tmpDocx),
                '-f', 'markdown',
                '-t', 'docx',
                '--standalone',
                '--wrap=none',
                '--highlight-style=tango',
                `--reference-doc=${JSON.stringify(refDoc)}`,
            ].join(' ');

            this.logger.log(`Running Pandoc: ${pandocCmd}`);
            execSync(pandocCmd, { timeout: 60_000 });

            // Post-process DOCX: add gray background + border to code blocks
            const postprocessScript = path.join(process.cwd(), 'assets', 'docx_postprocess.py');
            const tmpDocxStyled = tmpDocx.replace('.docx', '_styled.docx');
            try {
                // Auto-install python-docx if not available
                try {
                    execSync('python3 -c "import docx"', { timeout: 5_000, stdio: 'pipe' });
                } catch {
                    this.logger.log('python-docx not found, installing...');
                    execSync('pip3 install --break-system-packages python-docx', { timeout: 60_000, stdio: 'pipe' });
                    this.logger.log('python-docx installed successfully');
                }
                execSync(`python3 ${JSON.stringify(postprocessScript)} ${JSON.stringify(tmpDocx)} ${JSON.stringify(tmpDocxStyled)}`, { timeout: 30_000 });
                // Use styled version if post-processing succeeded
                if (fs.existsSync(tmpDocxStyled)) {
                    const styledBuffer = fs.readFileSync(tmpDocxStyled);
                    this.logger.log(`Post-processed DOCX: ${styledBuffer.length} bytes (code blocks styled)`);
                    return Buffer.from(styledBuffer);
                }
            } catch (ppErr: any) {
                this.logger.warn(`Post-processing failed (using raw Pandoc output): ${ppErr.message}`);
            } finally {
                try { fs.unlinkSync(tmpDocxStyled); } catch { /* ignore */ }
            }

            // Fallback: use raw Pandoc output
            const docxBuffer = fs.readFileSync(tmpDocx);
            this.logger.log(`Pandoc DOCX generated: ${docxBuffer.length} bytes`);

            return Buffer.from(docxBuffer);
        } finally {
            // Cleanup temp files
            try { fs.unlinkSync(tmpMd); } catch { /* ignore */ }
            try { fs.unlinkSync(tmpDocx); } catch { /* ignore */ }
        }
    }
}
