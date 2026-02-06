import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Slide } from '@prisma/client';

interface ParsedSlide {
    slideIndex: number;
    slideType: string;
    title: string;
    content: string | null;
    visualIdea: string | null;
    speakerNote: string | null;
}

@Injectable()
export class SlideDataService {
    constructor(private prisma: PrismaService) { }

    /**
     * Get all slides for a lesson, ordered by slideIndex
     */
    async getSlides(lessonId: string): Promise<Slide[]> {
        const slides = await this.prisma.slide.findMany({
            where: { lessonId },
            orderBy: { slideIndex: 'asc' },
        });

        console.log(`[DEBUG getSlides] lessonId: ${lessonId} -> Found ${slides.length} slides`);
        return slides;
    }

    /**
     * Get a specific slide by lessonId and slideIndex
     */
    async getSlide(lessonId: string, slideIndex: number): Promise<Slide | null> {
        return this.prisma.slide.findUnique({
            where: {
                lessonId_slideIndex: {
                    lessonId,
                    slideIndex,
                },
            },
        });
    }

    /**
     * Update a specific slide's content
     */
    async updateSlide(
        lessonId: string,
        slideIndex: number,
        data: Partial<Pick<Slide, 'title' | 'content' | 'visualIdea' | 'speakerNote' | 'imagePrompt' | 'imageUrl' | 'audioUrl' | 'audioDuration' | 'status'>>
    ): Promise<Slide> {
        const slide = await this.prisma.slide.findUnique({
            where: {
                lessonId_slideIndex: { lessonId, slideIndex },
            },
        });

        if (!slide) {
            throw new NotFoundException(`Slide ${slideIndex} not found in lesson ${lessonId}`);
        }

        return this.prisma.slide.update({
            where: {
                lessonId_slideIndex: { lessonId, slideIndex },
            },
            data,
        });
    }

    /**
     * Parse slideScript markdown and save as Slide records
     * This replaces storing raw markdown in lesson.slideScript
     * IMPORTANT: Preserves optimizedContentJson and imageUrl from existing slides
     */
    async parseAndSaveSlides(lessonId: string, slideScript: string): Promise<Slide[]> {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
        });

        if (!lesson) {
            throw new NotFoundException(`Lesson ${lessonId} not found`);
        }

        // Parse the slideScript into structured data
        const parsedSlides = this.parseSlideScript(slideScript);

        if (parsedSlides.length === 0) {
            throw new BadRequestException('No slides found in script');
        }

        // DEBUG: Log stack trace to identify caller
        console.log(`[DEBUG parseAndSaveSlides] Called for lessonId: ${lessonId}`);
        console.log(`[DEBUG parseAndSaveSlides] slideScript length: ${slideScript.length}`);
        console.log(`[DEBUG parseAndSaveSlides] Parsed ${parsedSlides.length} slides`);
        console.log(`[DEBUG parseAndSaveSlides] Stack trace: ${new Error().stack?.split('\n').slice(1, 5).join(' -> ')}`);

        // IMPORTANT: Get existing slides to preserve AI-generated content
        const existingSlides = await this.prisma.slide.findMany({
            where: { lessonId },
            select: {
                slideIndex: true,
                optimizedContentJson: true,
                imageUrl: true,
                imagePrompt: true,
            },
        });

        // Create a map of existing slide data by slideIndex
        const existingDataMap = new Map(
            existingSlides.map(s => [s.slideIndex, {
                optimizedContentJson: s.optimizedContentJson,
                imageUrl: s.imageUrl,
                imagePrompt: s.imagePrompt,
            }])
        );

        // Delete existing slides for this lesson
        await this.prisma.slide.deleteMany({
            where: { lessonId },
        });

        // Create all new slides, preserving AI-generated content where slideIndex matches
        const createdSlides = await this.prisma.$transaction(
            parsedSlides.map((slide) => {
                const existingData = existingDataMap.get(slide.slideIndex);
                return this.prisma.slide.create({
                    data: {
                        lessonId,
                        slideIndex: slide.slideIndex,
                        slideType: slide.slideType,
                        title: slide.title,
                        content: slide.content,
                        visualIdea: slide.visualIdea,
                        speakerNote: slide.speakerNote,
                        // Preserve AI-generated content from existing slides
                        optimizedContentJson: existingData?.optimizedContentJson || null,
                        imageUrl: existingData?.imageUrl || null,
                        imagePrompt: existingData?.imagePrompt || null,
                        status: existingData?.optimizedContentJson ? 'optimized' : 'parsed',
                    },
                });
            })
        );

        return createdSlides;
    }

    /**
     * Parse slideScript into structured slide objects
     * Supports both JSON and markdown formats
     */
    parseSlideScript(slideScript: string): ParsedSlide[] {
        // Try JSON format first (may be wrapped in ```json code blocks)
        const jsonSlides = this.tryParseAsJson(slideScript);
        if (jsonSlides && jsonSlides.length > 0) {
            return jsonSlides;
        }

        // Fall back to markdown format parsing
        return this.parseMarkdownFormat(slideScript);
    }

    /**
     * Try to parse slideScript as JSON
     * Handles both raw JSON and JSON wrapped in code blocks
     * Also extracts slides from outline-format JSON if no slides array exists
     */
    private tryParseAsJson(slideScript: string): ParsedSlide[] | null {
        try {
            let jsonStr = slideScript.trim();

            // Try multiple patterns to extract JSON from code blocks
            // Pattern 1: ```json ... ``` (with newlines)
            // Pattern 2: ```json...``` (without newlines)
            // Pattern 3: ``` ... ``` (plain code block)
            const patterns = [
                /```json\s*\n([\s\S]*?)\n\s*```/,  // ```json\n...\n```
                /```json\s*([\s\S]*?)```/,          // ```json...```
                /```\s*\n([\s\S]*?)\n\s*```/,      // ```\n...\n```
                /```([\s\S]*?)```/,                 // ```...```
            ];

            for (const pattern of patterns) {
                const match = jsonStr.match(pattern);
                if (match && match[1]) {
                    const extracted = match[1].trim();
                    // Verify it looks like JSON
                    if (extracted.startsWith('{') || extracted.startsWith('[')) {
                        jsonStr = extracted;
                        console.log(`[DEBUG tryParseAsJson] Extracted JSON using pattern: ${pattern.source.substring(0, 30)}...`);
                        break;
                    }
                }
            }

            // Try parsing as JSON
            const parsed = JSON.parse(jsonStr);

            // Handle different JSON structures
            let slides = parsed.slides || (Array.isArray(parsed) ? parsed : null);

            // If no slides array, try to extract from outline format
            if (!slides || !Array.isArray(slides) || slides.length === 0) {
                slides = this.extractSlidesFromOutline(parsed);
            }

            if (!slides || !Array.isArray(slides) || slides.length === 0) {
                console.log(`[DEBUG tryParseAsJson] No slides array found in parsed JSON`);
                return null;
            }

            console.log(`[DEBUG tryParseAsJson] Successfully parsed ${slides.length} slides from JSON`);

            return slides.map((slide: any, index: number) => ({
                slideIndex: slide.slideIndex ?? slide.slide_index ?? index,
                slideType: this.inferSlideType(slide.slideType ?? slide.slide_type ?? 'content', slide.title ?? '', index),
                title: slide.title ?? `Slide ${index + 1}`,
                content: Array.isArray(slide.content) ? slide.content.join('\n') : slide.content ?? null,
                visualIdea: slide.visualIdea ?? slide.visual_idea ?? slide['Visual Idea'] ?? null,
                speakerNote: slide.speakerNote ?? slide.speaker_note ?? slide['Speaker Notes'] ?? null,
            }));
        } catch (error) {
            console.log(`[DEBUG tryParseAsJson] JSON parse failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return null;
        }
    }

    /**
     * Extract slides from outline-format JSON (when AI returns outline instead of slides)
     * Converts: { title, agenda, objectives, sections } -> slides array
     */
    private extractSlidesFromOutline(outline: any): any[] | null {
        if (!outline || typeof outline !== 'object') return null;

        const slides: any[] = [];
        let slideIndex = 1; // Start from 1, not 0

        // Slide 1: Title slide
        if (outline.title) {
            slides.push({
                slideIndex: slideIndex++,
                slideType: 'title',
                title: outline.title,
                content: null,
                visualIdea: null,
                speakerNote: `Chào mừng các em đến với bài học: ${outline.title}`,
            });
        }

        // Slide 2: Agenda
        if (outline.agenda && Array.isArray(outline.agenda)) {
            slides.push({
                slideIndex: slideIndex++,
                slideType: 'agenda',
                title: 'Nội dung bài học',
                content: outline.agenda,
                visualIdea: null,
                speakerNote: `Hôm nay chúng ta sẽ tìm hiểu: ${outline.agenda.join(', ')}`,
            });
        }

        // Slide 2: Objectives
        if (outline.objectives && Array.isArray(outline.objectives)) {
            slides.push({
                slideIndex: slideIndex++,
                slideType: 'objectives',
                title: 'Mục tiêu bài học',
                content: outline.objectives,
                visualIdea: 'Icons: target, lightbulb, steps',
                speakerNote: `Sau bài học này, các em sẽ: ${outline.objectives.join('; ')}`,
            });
        }

        // Content slides from sections
        if (outline.sections && Array.isArray(outline.sections)) {
            for (const section of outline.sections) {
                // Section header slide
                slides.push({
                    slideIndex: slideIndex++,
                    slideType: 'section_header',
                    title: section.title || `Phần ${section.id}`,
                    content: null,
                    visualIdea: null,
                    speakerNote: `Bây giờ chúng ta sẽ tìm hiểu: ${section.title}`,
                });

                // Subsection slides
                if (section.subsections && Array.isArray(section.subsections)) {
                    for (const subsection of section.subsections) {
                        slides.push({
                            slideIndex: slideIndex++,
                            slideType: 'content',
                            title: subsection.title || `Mục ${subsection.id}`,
                            content: subsection.keyPoints || [],
                            visualIdea: subsection.visualIdea || null,
                            speakerNote: subsection.keyPoints ?
                                `Trong phần này, chúng ta sẽ tìm hiểu về: ${subsection.keyPoints.join('. ')}` : null,
                        });
                    }
                }
            }
        }

        // Summary slide
        if (outline.summary && Array.isArray(outline.summary)) {
            slides.push({
                slideIndex: slideIndex++,
                slideType: 'summary',
                title: 'Tổng kết',
                content: outline.summary,
                visualIdea: 'Summary infographic',
                speakerNote: `Tóm lại, hôm nay chúng ta đã học: ${outline.summary.join('; ')}`,
            });
        }

        // Q&A slide
        if (outline.reviewQuestions && Array.isArray(outline.reviewQuestions)) {
            slides.push({
                slideIndex: slideIndex++,
                slideType: 'q&a',
                title: 'Câu hỏi ôn tập',
                content: outline.reviewQuestions,
                visualIdea: 'Question mark icons',
                speakerNote: `Hãy cùng nhau trả lời các câu hỏi ôn tập.`,
            });
        }

        return slides.length > 0 ? slides : null;
    }

    /**
     * Infer slide type from title and position
     */
    private inferSlideType(explicitType: string, title: string, index: number): string {
        if (explicitType && explicitType !== 'content') {
            return explicitType;
        }

        const titleLower = title.toLowerCase();
        if ((titleLower.includes('title') || titleLower.includes('tiêu đề')) && index === 1) {
            return 'title';
        } else if (titleLower.includes('nội dung bài học') || titleLower.includes('agenda')) {
            return 'agenda';
        } else if (titleLower.includes('mục tiêu') || titleLower.includes('objective')) {
            return 'objectives';
        } else if (titleLower.includes('tổng kết') || titleLower.includes('summary')) {
            return 'summary';
        }
        return 'content';
    }

    /**
     * Parse markdown format: **Slide N: Title**
     */
    private parseMarkdownFormat(slideScript: string): ParsedSlide[] {
        const slides: ParsedSlide[] = [];

        // Split by slide headers: **Slide N: Title**
        const slidePattern = /\*\*Slide\s+(\d+):\s*([^*\n]+)\*\*/gi;
        const slideSections: { index: number; title: string; startPos: number; endPos: number }[] = [];

        let match: RegExpExecArray | null;
        while ((match = slidePattern.exec(slideScript)) !== null) {
            slideSections.push({
                index: parseInt(match[1], 10),
                title: match[2].trim(),
                startPos: match.index,
                endPos: slideScript.length, // Will be updated
            });
        }

        // Update end positions
        for (let i = 0; i < slideSections.length - 1; i++) {
            slideSections[i].endPos = slideSections[i + 1].startPos;
        }

        // Parse each slide section
        for (const section of slideSections) {
            const sectionContent = slideScript.substring(section.startPos, section.endPos);

            // Determine slide type
            const slideType = this.inferSlideType('content', section.title, section.index);

            // Extract content (bullet points under **Content:** or regular bullets)
            const content = this.extractSection(sectionContent, 'Content');

            // Extract Visual Idea
            const visualIdea = this.extractSection(sectionContent, 'Visual Idea');

            // Extract Speaker Notes
            const speakerNote = this.extractSection(sectionContent, 'Speaker Notes');

            slides.push({
                slideIndex: section.index,
                slideType,
                title: section.title,
                content,
                visualIdea,
                speakerNote,
            });
        }

        return slides;
    }

    /**
     * Extract a specific section from slide content
     * Handles both **[Section]:** and * **[Section]:** formats
     */
    private extractSection(content: string, sectionName: string): string | null {
        // Pattern 1: * **[Section Name]:** content
        const pattern1 = new RegExp(
            `\\*\\s*\\*\\*\\[${sectionName}\\]:\\*\\*\\s*([\\s\\S]*?)(?=\\n\\*\\s*\\*\\*\\[|\\n\\*\\*Slide|$)`,
            'i'
        );

        // Pattern 2: **Section Name:** content (without brackets)
        const pattern2 = new RegExp(
            `\\*\\s*\\*\\*${sectionName}:\\*\\*\\s*([\\s\\S]*?)(?=\\n\\*\\s*\\*\\*|\\n\\*\\*Slide|$)`,
            'i'
        );

        // Pattern 3: * **Content:** for bullet points
        const pattern3 = new RegExp(
            `\\*\\s*\\*\\*${sectionName}:\\*\\*([\\s\\S]*?)(?=\\n\\*\\s*\\*\\*\\[|\\n\\*\\*Slide|$)`,
            'i'
        );

        let match = content.match(pattern1);
        if (match && match[1].trim()) {
            return match[1].trim();
        }

        match = content.match(pattern2);
        if (match && match[1].trim()) {
            return match[1].trim();
        }

        match = content.match(pattern3);
        if (match && match[1].trim()) {
            return match[1].trim();
        }

        return null;
    }

    /**
     * Sync Slide records back to lesson.slideScript (for backward compatibility)
     * Rebuilds the markdown from structured data
     */
    async syncToSlideScript(lessonId: string): Promise<string> {
        const slides = await this.getSlides(lessonId);

        if (slides.length === 0) {
            return '';
        }

        const scriptParts: string[] = [];

        for (const slide of slides) {
            const parts: string[] = [];
            parts.push(`**Slide ${slide.slideIndex}: ${slide.title}**`);

            if (slide.content) {
                parts.push(`* **Content:**\n${slide.content}`);
            }

            if (slide.visualIdea) {
                parts.push(`* **[Visual Idea]:** ${slide.visualIdea}`);
            }

            if (slide.speakerNote) {
                parts.push(`* **[Speaker Notes]:** ${slide.speakerNote}`);
            }

            scriptParts.push(parts.join('\n'));
        }

        const slideScript = scriptParts.join('\n\n');

        // Update lesson.slideScript for backward compatibility
        await this.prisma.lesson.update({
            where: { id: lessonId },
            data: { slideScript },
        });

        return slideScript;
    }

    /**
     * Delete all slides for a lesson
     */
    async deleteAllSlides(lessonId: string): Promise<number> {
        const result = await this.prisma.slide.deleteMany({
            where: { lessonId },
        });
        return result.count;
    }

    /**
     * Get slide count for a lesson
     */
    async getSlideCount(lessonId: string): Promise<number> {
        return this.prisma.slide.count({
            where: { lessonId },
        });
    }

    /**
     * Check if slides exist for a lesson
     */
    async hasSlides(lessonId: string): Promise<boolean> {
        const count = await this.getSlideCount(lessonId);
        return count > 0;
    }
}
