import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { execFile } from 'child_process';
import { writeFile, unlink, mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

@Injectable()
export class MarkItDownService {
    private readonly logger = new Logger(MarkItDownService.name);

    /**
     * Convert a file buffer (DOCX, PDF, PPTX, XLSX) to Markdown via MarkItDown CLI.
     *
     * @param buffer - File buffer content
     * @param originalName - Original filename (used for temp file extension)
     * @returns Markdown string
     */
    async convertToMarkdown(buffer: Buffer, originalName: string): Promise<string> {
        // Create temp dir + write file
        const tmpDir = await mkdtemp(join(tmpdir(), 'markitdown-'));
        const tmpPath = join(tmpDir, originalName);

        try {
            await writeFile(tmpPath, buffer);

            const markdown = await new Promise<string>((resolve, reject) => {
                execFile(
                    'markitdown',
                    [tmpPath],
                    {
                        timeout: 0, // Vô hiệu hóa timeout (no timeout)
                        maxBuffer: 100 * 1024 * 1024, // 100MB output (đủ sức chứa text của hàng ngàn trang PDF)
                    },
                    (error, stdout, stderr) => {
                        if (error) {
                            this.logger.error(`MarkItDown error: ${stderr || error.message}`);
                            reject(new BadRequestException(`Không thể xử lý file: ${error.message}`));
                            return;
                        }
                        resolve(stdout);
                    },
                );
            });

            if (!markdown || markdown.trim().length < 10) {
                throw new BadRequestException('File không chứa nội dung có thể đọc được');
            }

            this.logger.log(`MarkItDown converted ${originalName}: ${markdown.length} chars`);
            return markdown;
        } finally {
            // Cleanup
            try {
                await unlink(tmpPath);
            } catch {
                // Ignore cleanup errors
            }
        }
    }
}
