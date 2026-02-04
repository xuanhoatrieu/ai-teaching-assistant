import { Injectable, Logger, BadRequestException } from '@nestjs/common';

/**
 * Service for parsing outline files (.docx, .md) into structured text
 */
@Injectable()
export class OutlineParserService {
    private readonly logger = new Logger(OutlineParserService.name);

    /**
     * Parse a file buffer based on its mimetype
     */
    async parseFile(buffer: Buffer, mimetype: string, filename: string): Promise<string> {
        this.logger.log(`Parsing file: ${filename} (${mimetype})`);

        if (this.isDocx(mimetype, filename)) {
            return this.parseDocx(buffer);
        }

        if (this.isMarkdown(mimetype, filename)) {
            return this.parseMarkdown(buffer);
        }

        if (this.isPlainText(mimetype)) {
            return buffer.toString('utf-8');
        }

        throw new BadRequestException(
            `Unsupported file type: ${mimetype}. Supported: .docx, .md, .txt`,
        );
    }

    /**
     * Parse DOCX file using mammoth
     */
    private async parseDocx(buffer: Buffer): Promise<string> {
        try {
            // Dynamic import to avoid loading mammoth if not needed
            const mammoth = await import('mammoth');
            const result = await mammoth.extractRawText({ buffer });
            return result.value.trim();
        } catch (error) {
            this.logger.error(`Failed to parse DOCX: ${error}`);
            throw new BadRequestException('Failed to parse DOCX file');
        }
    }

    /**
     * Parse Markdown file - extract plain text (strip markdown syntax)
     */
    private async parseMarkdown(buffer: Buffer): Promise<string> {
        try {
            const content = buffer.toString('utf-8');

            // Simple markdown stripping - remove common markdown syntax
            // For structured parsing, we keep the text as-is since Gemini can understand markdown
            return content.trim();
        } catch (error) {
            this.logger.error(`Failed to parse Markdown: ${error}`);
            throw new BadRequestException('Failed to parse Markdown file');
        }
    }

    /**
     * Check if file is DOCX
     */
    private isDocx(mimetype: string, filename: string): boolean {
        return (
            mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            filename.toLowerCase().endsWith('.docx')
        );
    }

    /**
     * Check if file is Markdown
     */
    private isMarkdown(mimetype: string, filename: string): boolean {
        return (
            mimetype === 'text/markdown' ||
            mimetype === 'text/x-markdown' ||
            filename.toLowerCase().endsWith('.md')
        );
    }

    /**
     * Check if file is plain text
     */
    private isPlainText(mimetype: string): boolean {
        return mimetype === 'text/plain';
    }

    /**
     * Validate outline content
     */
    validateOutline(content: string): { valid: boolean; error?: string } {
        if (!content || content.trim().length === 0) {
            return { valid: false, error: 'Outline content is empty' };
        }

        if (content.length > 50000) {
            return { valid: false, error: 'Outline content exceeds 50,000 characters limit' };
        }

        // Check for minimum structure (at least a few lines)
        const lines = content.split('\n').filter(line => line.trim().length > 0);
        if (lines.length < 2) {
            return { valid: false, error: 'Outline should have at least 2 lines of content' };
        }

        return { valid: true };
    }
}
