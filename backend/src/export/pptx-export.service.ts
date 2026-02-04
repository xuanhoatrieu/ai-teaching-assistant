import { Injectable, Logger } from '@nestjs/common';
import PptxGenJS from 'pptxgenjs';
import { SlideContent } from '../ai/gemini.service';

export interface PptxOptions {
    title: string;
    author?: string;
    subject?: string;
    companyName?: string;
    audioFiles?: Map<number, Buffer>; // slideNumber -> audio buffer
}

@Injectable()
export class PptxExportService {
    private readonly logger = new Logger(PptxExportService.name);

    /**
     * Generate PPTX from slide content
     */
    async generatePptx(content: SlideContent, options?: PptxOptions): Promise<Buffer> {
        this.logger.log(`Generating PPTX: ${content.title}`);

        const pptx = new PptxGenJS();

        // Set presentation properties
        pptx.title = options?.title || content.title;
        pptx.author = options?.author || 'AI Teaching Assistant';
        pptx.subject = options?.subject || '';
        pptx.company = options?.companyName || '';

        // Define slide master layouts
        pptx.defineSlideMaster({
            title: 'TITLE_SLIDE',
            background: { color: '0F172A' },
            objects: [
                {
                    placeholder: {
                        options: { name: 'title', type: 'title', x: 0.5, y: '40%', w: '90%', h: 1.5, align: 'center' },
                        text: '(title)'
                    }
                },
            ],
        });

        pptx.defineSlideMaster({
            title: 'CONTENT_SLIDE',
            background: { color: 'FFFFFF' },
            objects: [
                { rect: { x: 0, y: 0, w: '100%', h: 0.8, fill: { color: '3B82F6' } } },
                {
                    placeholder: {
                        options: { name: 'title', type: 'title', x: 0.5, y: 0.15, w: '90%', h: 0.5, color: 'FFFFFF' },
                        text: '(title)'
                    }
                },
            ],
        });

        // Generate slides
        for (const slide of content.slides) {
            await this.addSlide(pptx, slide, options?.audioFiles?.get(slide.slideNumber));
        }

        // Generate buffer
        const data = await pptx.write({ outputType: 'nodebuffer' });
        return data as Buffer;
    }

    private async addSlide(
        pptx: PptxGenJS,
        slide: SlideContent['slides'][0],
        audioBuffer?: Buffer,
    ): Promise<void> {
        const pptxSlide = pptx.addSlide();

        switch (slide.type) {
            case 'title':
                this.addTitleSlide(pptxSlide, slide);
                break;
            case 'summary':
                this.addSummarySlide(pptxSlide, slide);
                break;
            default:
                this.addContentSlide(pptxSlide, slide);
        }

        // Add speaker notes
        if (slide.speakerNotes) {
            pptxSlide.addNotes(slide.speakerNotes);
        }

        // Add audio if provided
        if (audioBuffer) {
            // Note: PPTX.js doesn't directly support embedding audio from buffer
            // Audio would need to be added as a reference to a file
            // For now, we log this and audio will be handled separately
            this.logger.debug(`Audio available for slide ${slide.slideNumber}`);
        }
    }

    private addTitleSlide(pptxSlide: PptxGenJS.Slide, slide: SlideContent['slides'][0]): void {
        pptxSlide.background = { color: '0F172A' };

        // Main title
        pptxSlide.addText(slide.title, {
            x: 0.5,
            y: '35%',
            w: '90%',
            h: 1.5,
            fontSize: 44,
            bold: true,
            color: 'FFFFFF',
            align: 'center',
        });

        // Subtitle from first content item
        if (slide.content && slide.content.length > 0) {
            pptxSlide.addText(slide.content[0], {
                x: 0.5,
                y: '55%',
                w: '90%',
                h: 0.8,
                fontSize: 24,
                color: '94A3B8',
                align: 'center',
            });
        }
    }

    private addContentSlide(pptxSlide: PptxGenJS.Slide, slide: SlideContent['slides'][0]): void {
        pptxSlide.background = { color: 'FFFFFF' };

        // Header bar
        pptxSlide.addShape('rect', {
            x: 0,
            y: 0,
            w: '100%',
            h: 0.8,
            fill: { color: '3B82F6' },
        });

        // Title
        pptxSlide.addText(slide.title, {
            x: 0.5,
            y: 0.15,
            w: '90%',
            h: 0.5,
            fontSize: 28,
            bold: true,
            color: 'FFFFFF',
        });

        // Content bullets
        if (slide.content && slide.content.length > 0) {
            const bulletPoints = slide.content.map(point => ({
                text: point,
                options: { bullet: { type: 'bullet' as const }, fontSize: 18, color: '1E293B' },
            }));

            pptxSlide.addText(bulletPoints, {
                x: 0.5,
                y: 1.2,
                w: '90%',
                h: 4,
                valign: 'top',
            });
        }
    }

    private addSummarySlide(pptxSlide: PptxGenJS.Slide, slide: SlideContent['slides'][0]): void {
        pptxSlide.background = { color: '1E40AF' };

        // Title
        pptxSlide.addText(slide.title, {
            x: 0.5,
            y: 0.5,
            w: '90%',
            h: 1,
            fontSize: 36,
            bold: true,
            color: 'FFFFFF',
            align: 'center',
        });

        // Summary points
        if (slide.content && slide.content.length > 0) {
            const bulletPoints = slide.content.map((point, index) => ({
                text: `${index + 1}. ${point}`,
                options: { fontSize: 20, color: 'FFFFFF', breakLine: true },
            }));

            pptxSlide.addText(bulletPoints, {
                x: 1,
                y: 1.8,
                w: '80%',
                h: 3.5,
                valign: 'top',
            });
        }
    }
}
