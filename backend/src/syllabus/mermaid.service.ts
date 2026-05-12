import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { writeFile, readFile, unlink, mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * MermaidService — Render mermaid diagram code → PNG buffer.
 * Uses @mermaid-js/mermaid-cli (mmdc) locally, falls back to mermaid.ink API.
 */
@Injectable()
export class MermaidService {
    private readonly logger = new Logger(MermaidService.name);
    private mmdcAvailable: boolean | null = null;

    /**
     * Check if mmdc CLI is available on the system.
     */
    private async checkMmdc(): Promise<boolean> {
        if (this.mmdcAvailable !== null) return this.mmdcAvailable;

        return new Promise((resolve) => {
            execFile('mmdc', ['--version'], { timeout: 5000 }, (error) => {
                this.mmdcAvailable = !error;
                if (this.mmdcAvailable) {
                    this.logger.log('mmdc CLI available');
                } else {
                    this.logger.warn('mmdc CLI not found — will use mermaid.ink API fallback');
                }
                resolve(this.mmdcAvailable);
            });
        });
    }

    /**
     * Render mermaid code to PNG buffer.
     * Tries local mmdc first, falls back to mermaid.ink API.
     */
    async renderToPng(mermaidCode: string): Promise<Buffer> {
        const hasLocal = await this.checkMmdc();
        if (hasLocal) {
            try {
                return await this.renderWithMmdc(mermaidCode);
            } catch (err: any) {
                this.logger.warn(`mmdc render failed: ${err.message}, trying mermaid.ink fallback`);
            }
        }
        return this.renderWithMermaidInk(mermaidCode);
    }

    /**
     * Render using local mmdc CLI.
     */
    private async renderWithMmdc(mermaidCode: string): Promise<Buffer> {
        const tmpDir = await mkdtemp(join(tmpdir(), 'mermaid-'));
        const inputPath = join(tmpDir, 'input.mmd');
        const outputPath = join(tmpDir, 'output.png');

        try {
            await writeFile(inputPath, mermaidCode, 'utf-8');

            await new Promise<void>((resolve, reject) => {
                execFile(
                    'mmdc',
                    ['-i', inputPath, '-o', outputPath, '-b', 'white', '-w', '800', '-s', '2'],
                    { timeout: 30_000 },
                    (error, _stdout, stderr) => {
                        if (error) {
                            reject(new Error(`mmdc error: ${stderr || error.message}`));
                            return;
                        }
                        resolve();
                    },
                );
            });

            const png = await readFile(outputPath);
            this.logger.log(`mmdc rendered ${png.length} bytes PNG`);
            return png;
        } finally {
            // Cleanup temp files
            try { await unlink(inputPath); } catch { /* ignore */ }
            try { await unlink(outputPath); } catch { /* ignore */ }
        }
    }

    /**
     * Render using mermaid.ink public API (fallback).
     * GET https://mermaid.ink/img/{base64encodedCode}
     */
    private async renderWithMermaidInk(mermaidCode: string): Promise<Buffer> {
        const encoded = Buffer.from(mermaidCode, 'utf-8').toString('base64url');
        const url = `https://mermaid.ink/img/${encoded}?type=png&bgColor=white&width=800`;

        this.logger.log(`Fetching mermaid.ink: ${url.substring(0, 80)}...`);

        const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });

        if (!response.ok) {
            throw new Error(`mermaid.ink returned HTTP ${response.status}`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        this.logger.log(`mermaid.ink rendered ${buffer.length} bytes PNG`);
        return buffer;
    }
}
