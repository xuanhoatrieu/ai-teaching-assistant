import {
    Injectable,
    Logger,
    NotFoundException,
    BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TTSService } from '../tts/tts.service';
import { ModelConfigService } from '../model-config/model-config.service';
import * as fs from 'fs';
import * as path from 'path';
import * as archiver from 'archiver';

// Interface for parsed slide data
interface ParsedSlide {
    index: number;
    title: string;
    speakerNote: string;
}

@Injectable()
export class SlideAudioService {
    private readonly logger = new Logger(SlideAudioService.name);
    private readonly uploadsDir = path.join(process.cwd(), 'uploads');

    constructor(
        private readonly prisma: PrismaService,
        private readonly ttsService: TTSService,
        private readonly modelConfigService: ModelConfigService,
    ) {
        // Ensure uploads directory exists
        this.ensureUploadsDir();
    }

    private ensureUploadsDir() {
        if (!fs.existsSync(this.uploadsDir)) {
            fs.mkdirSync(this.uploadsDir, { recursive: true });
        }
    }

    private getAudioDir(lessonId: string): string {
        const dir = path.join(this.uploadsDir, 'lessons', lessonId, 'audio');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return dir;
    }

    // Get all slide audios for a lesson (ordered by slideIndex)
    async getSlideAudios(lessonId: string) {
        return this.prisma.slideAudio.findMany({
            where: { lessonId },
            orderBy: { slideIndex: 'asc' },
        });
    }

    // Parse speaker notes from slide script (JSON or Markdown)
    parseSpeakerNotesFromScript(slideScript: string): ParsedSlide[] {
        // Try JSON format first (new prompt architecture)
        const jsonSlides = this.parseJsonSlideScript(slideScript);
        if (jsonSlides.length > 0) {
            this.logger.debug(`Parsed ${jsonSlides.length} slides from JSON format`);
            return jsonSlides;
        }

        // Fallback to Markdown format (legacy)
        const markdownSlides = this.parseMarkdownSlideScript(slideScript);
        if (markdownSlides.length > 0) {
            this.logger.debug(`Parsed ${markdownSlides.length} slides from Markdown format`);
            return markdownSlides;
        }

        this.logger.warn('Could not parse any slides from script');
        return [];
    }

    // Parse JSON format slide script
    private parseJsonSlideScript(slideScript: string): ParsedSlide[] {
        const slides: ParsedSlide[] = [];

        try {
            // Extract JSON from markdown code block if present
            // Use indexOf/lastIndexOf instead of regex to handle nested code blocks
            let jsonStr = slideScript;

            // Check for markdown code block wrapper
            const jsonStartTag = slideScript.indexOf('```json');
            const jsonStartTagAlt = slideScript.indexOf('```');

            if (jsonStartTag !== -1) {
                // Found ```json - extract content between first ```json and last ```
                const contentStart = jsonStartTag + '```json'.length;
                const lastBackticks = slideScript.lastIndexOf('```');

                if (lastBackticks > contentStart) {
                    jsonStr = slideScript.substring(contentStart, lastBackticks);
                    this.logger.log(`[parseJsonSlideScript] Extracted JSON from markdown block: ${jsonStr.length} chars`);
                }
            } else if (jsonStartTagAlt !== -1 && jsonStartTagAlt < 10) {
                // Found ``` at start (without json tag) - try same extraction
                const contentStart = slideScript.indexOf('\n', jsonStartTagAlt) + 1;
                const lastBackticks = slideScript.lastIndexOf('```');

                if (lastBackticks > contentStart) {
                    jsonStr = slideScript.substring(contentStart, lastBackticks);
                    this.logger.log(`[parseJsonSlideScript] Extracted JSON from plain code block: ${jsonStr.length} chars`);
                }
            }

            // Try to parse the JSON
            const data = JSON.parse(jsonStr.trim());
            this.logger.log(`[parseJsonSlideScript] Parsed data type: ${typeof data}, has slides: ${!!data.slides}, isArray: ${Array.isArray(data)}`);

            // Handle { slides: [...] } format or direct array
            const slidesArray = data.slides || data;
            if (!Array.isArray(slidesArray)) {
                this.logger.warn(`[parseJsonSlideScript] slidesArray is not an array: ${typeof slidesArray}`);
                return [];
            }

            this.logger.log(`[parseJsonSlideScript] Found ${slidesArray.length} slides`);

            for (let i = 0; i < slidesArray.length; i++) {
                const slide = slidesArray[i];
                const slideIndex = slide.slideIndex ?? i;
                const title = slide.title || `Slide ${slideIndex + 1}`;
                const speakerNote = slide.speakerNote || slide.speaker_note || slide['Speaker Notes'] || slide['Speaker Note'] || '';

                if (i === 0) {
                    this.logger.log(`[parseJsonSlideScript] First slide keys: ${Object.keys(slide).join(', ')}`);
                    this.logger.log(`[parseJsonSlideScript] First slide speakerNote preview: ${speakerNote?.substring(0, 100)}`);
                }

                slides.push({
                    index: slideIndex,
                    title,
                    speakerNote,
                });
            }

            this.logger.log(`[parseJsonSlideScript] Successfully parsed ${slides.length} slides with speakerNotes`);
            return slides;
        } catch (e) {
            // Not valid JSON, return empty to trigger markdown fallback
            this.logger.warn(`[parseJsonSlideScript] JSON parse error: ${e.message}`);
            return [];
        }
    }

    // Parse Markdown format slide script (legacy)
    private parseMarkdownSlideScript(slideScript: string): ParsedSlide[] {
        const slides: ParsedSlide[] = [];

        // Split by slide markers: **Slide N: Title** or **Slide N: Title**
        const slideMatches = [...slideScript.matchAll(/\*\*Slide\s*\d+[:\s]+[^*]+\*\*/gi)];

        for (let i = 0; i < slideMatches.length; i++) {
            const match = slideMatches[i];
            const fullMatch = match[0];
            const startPos = match.index || 0;
            const endPos = i < slideMatches.length - 1
                ? (slideMatches[i + 1].index || slideScript.length)
                : slideScript.length;

            // Extract slide number and title from the header
            const headerMatch = fullMatch.match(/\*\*Slide\s*(\d+)[:\s]+([^*]+)\*\*/i);
            if (!headerMatch) continue;

            const title = headerMatch[2].trim();

            // Get the content for this slide (between this header and next)
            const content = slideScript.substring(startPos, endPos);

            // Extract speaker notes
            const speakerNote = this.extractSpeakerNoteFromContent(content);

            slides.push({
                index: slides.length,
                title,
                speakerNote,
            });
        }

        // Fallback: If no slides found with bold pattern, try ## headers
        if (slides.length === 0) {
            const sections = slideScript.split(/\n(?=##\s+)/);
            sections.forEach((section) => {
                const lines = section.split('\n');
                const headerLine = lines[0]?.trim();
                if (!headerLine || !headerLine.startsWith('##')) return;

                const title = headerLine.replace(/^##\s*/, '').trim();
                const content = lines.slice(1).join('\n');

                const noteMatch = content.match(
                    /\*\*\[?Speaker Notes?\]?\*\*[:\s]*([^]*?)(?=\n\*\*|$)/i
                );
                const speakerNote = noteMatch?.[1]?.replace(/^["']|["']$/g, '').trim() || '';

                if (title) {
                    slides.push({
                        index: slides.length,
                        title,
                        speakerNote,
                    });
                }
            });
        }

        return slides;
    }

    // Helper: Extract speaker note from slide content using indexOf-based method
    private extractSpeakerNoteFromContent(content: string): string {
        // Possible markers for speaker notes
        const markers = ['**[Speaker Notes]:**', '**[Speaker Notes]**:', '**[Speaker Note]:**'];

        let markerIdx = -1;
        let markerLength = 0;
        for (const marker of markers) {
            const idx = content.indexOf(marker);
            if (idx !== -1) {
                markerIdx = idx;
                markerLength = marker.length;
                break;
            }
        }

        if (markerIdx === -1) return '';

        // Get content after the marker
        const afterMarker = content.substring(markerIdx + markerLength);

        // Find the end boundary (--- separator, next **[ section, or end)
        const endPatterns = ['---', '\n**[', '\n*   **['];
        let endIdx = afterMarker.length;
        for (const pattern of endPatterns) {
            const pos = afterMarker.indexOf(pattern);
            if (pos !== -1 && pos < endIdx) {
                endIdx = pos;
            }
        }

        const noteSection = afterMarker.substring(0, endIdx);

        // Extract content from blockquote format: > "content" or > content
        // Try with quotes first
        const matchWithQuotes = noteSection.match(/>\s*"([^"]+)"/);
        if (matchWithQuotes) {
            return matchWithQuotes[1].trim();
        }

        // Try without quotes (blockquote lines)
        const blockquoteLines = noteSection.split('\n')
            .map(line => line.replace(/^\s*>\s*/, '').trim())
            .filter(line => line.length > 0 && !line.startsWith('*'));

        if (blockquoteLines.length > 0) {
            return blockquoteLines.join(' ')
                .replace(/^["']|["']$/g, '')
                .trim();
        }

        // Fallback: just return trimmed content
        return noteSection.trim().replace(/^["']|["']$/g, '').replace(/^>\s*/, '');
    }

    // Initialize slide audios from slide script
    async initializeSlideAudios(lessonId: string) {
        this.logger.log(`[initializeSlideAudios] Starting for lessonId: ${lessonId}`);

        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
            select: { slideScript: true, title: true },
        });

        if (!lesson) {
            throw new NotFoundException(`Lesson ${lessonId} not found`);
        }

        if (!lesson.slideScript) {
            throw new BadRequestException('Slide script is required. Complete Step 3 first.');
        }

        this.logger.debug(`[initializeSlideAudios] slideScript length: ${lesson.slideScript.length}, preview: ${lesson.slideScript.substring(0, 300)}`);

        // Parse speaker notes from script
        let parsedSlides = this.parseSpeakerNotesFromScript(lesson.slideScript);
        this.logger.log(`[initializeSlideAudios] parsedSlides from script: ${parsedSlides.length}`);

        // FALLBACK: If no slides parsed or all speakerNotes empty, try reading from Slides table
        const hasValidSpeakerNotes = parsedSlides.some(s => s.speakerNote?.trim());
        this.logger.debug(`[initializeSlideAudios] hasValidSpeakerNotes: ${hasValidSpeakerNotes}`);

        if (parsedSlides.length === 0 || !hasValidSpeakerNotes) {
            this.logger.warn('No speaker notes from slideScript, falling back to Slides table');

            const slidesFromDb = await this.prisma.slide.findMany({
                where: { lessonId },
                orderBy: { slideIndex: 'asc' },
                select: { slideIndex: true, title: true, speakerNote: true },
            });

            this.logger.log(`[initializeSlideAudios] Slides from DB: ${slidesFromDb.length}`);
            if (slidesFromDb.length > 0) {
                this.logger.debug(`[initializeSlideAudios] First DB slide speakerNote: ${slidesFromDb[0].speakerNote?.substring(0, 100)}`);
            }

            if (slidesFromDb.length > 0) {
                parsedSlides = slidesFromDb.map(s => ({
                    index: s.slideIndex,
                    title: s.title,
                    speakerNote: s.speakerNote || '',
                }));
                this.logger.log(`Loaded ${parsedSlides.length} slides from Slides table`);
            }
        }

        if (parsedSlides.length === 0) {
            this.logger.error(`[initializeSlideAudios] FAILED: No slides found from either slideScript or Slides table`);
            throw new BadRequestException('No speaker notes found. Please regenerate slides in Step 3.');
        }

        // Delete existing slide audios for this lesson
        await this.prisma.slideAudio.deleteMany({
            where: { lessonId },
        });

        // Create new slide audio records
        const slideAudios = await Promise.all(
            parsedSlides.map((slide) =>
                this.prisma.slideAudio.create({
                    data: {
                        lessonId,
                        slideIndex: slide.index,
                        slideTitle: slide.title,
                        speakerNote: slide.speakerNote,
                        status: 'pending',
                    },
                }),
            ),
        );

        return slideAudios;
    }

    // Generate audio for a single slide
    async generateSingleAudio(lessonId: string, slideIndex: number, userId: string, multilingualMode?: string) {
        const slideAudio = await this.prisma.slideAudio.findUnique({
            where: {
                lessonId_slideIndex: { lessonId, slideIndex },
            },
        });

        if (!slideAudio) {
            throw new NotFoundException(`Slide audio at index ${slideIndex} not found`);
        }

        if (!slideAudio.speakerNote?.trim()) {
            throw new BadRequestException('Speaker note is empty');
        }

        // Update status to generating
        await this.prisma.slideAudio.update({
            where: { id: slideAudio.id },
            data: { status: 'generating', errorMessage: null },
        });

        try {
            // Get TTS model config
            const modelConfig = await this.modelConfigService.getModelForTask(userId, 'TTS');

            // Parse voice configuration
            // Format: "gemini-voice:VoiceName" or "vbee:voiceId" or "vitts:ref:3"
            let provider = modelConfig.provider || 'GEMINI';
            let voiceName = 'Puck';
            let modelName = 'gemini-2.5-flash-preview-tts';

            if (modelConfig.modelName?.startsWith('gemini-voice:')) {
                // Gemini voice format: "gemini-voice:Puck"
                provider = 'GEMINI';
                voiceName = modelConfig.modelName.split(':')[1];
                modelName = 'gemini-2.5-flash-preview-tts';
            } else if (modelConfig.modelName?.startsWith('vbee:')) {
                // Vbee voice format: "vbee:hn_female_thutrang_news_48k-fhg"
                provider = 'VBEE';
                voiceName = modelConfig.modelName.split(':')[1];
                modelName = 'vbee-tts';
            } else if (modelConfig.modelName?.startsWith('vitts:')) {
                // ViTTS voice format: "vitts:ref:3" or "vitts:trained_xxx" or "vitts:male"
                provider = 'VITTS';
                voiceName = modelConfig.modelName; // Keep full format, provider will strip prefix
                modelName = 'vitts';
            } else if (modelConfig.modelName) {
                // Fallback: treat as voice name directly
                voiceName = modelConfig.modelName;
            }

            this.logger.log(`TTS Config: provider=${provider}, model=${modelName}, voice=${voiceName}, multilingualMode=${multilingualMode || 'none'}`);

            // Generate audio using TTS service
            const result = await this.ttsService.generateAudio(userId, {
                text: slideAudio.speakerNote,
                voiceId: voiceName,
                model: modelName,
                provider: provider,
                multilingualMode: multilingualMode,
            });

            // Save audio file - Gemini TTS returns WAV format
            const audioDir = this.getAudioDir(lessonId);
            const fileExt = result.format === 'wav' ? 'wav' : 'mp3';
            const fileName = `slide_${String(slideIndex).padStart(2, '0')}.${fileExt}`;
            const filePath = path.join(audioDir, fileName);

            // Write audio buffer to file
            if (result.audio) {
                // For Gemini TTS (WAV format), we need to add WAV header
                if (result.format === 'wav' && !this.hasWavHeader(result.audio)) {
                    const wavBuffer = this.addWavHeader(result.audio, 24000, 1, 16);
                    fs.writeFileSync(filePath, wavBuffer);
                } else {
                    fs.writeFileSync(filePath, result.audio);
                }
            }

            // Update record with audio info
            // Calculate duration from audio data: PCM 24kHz, 16-bit, mono
            // Duration (seconds) = bytes / (sampleRate * bytesPerSample * channels)
            const audioDurationSeconds = result.audio
                ? result.audio.length / (24000 * 2 * 1)  // 24kHz, 2 bytes per sample, mono
                : null;

            const updated = await this.prisma.slideAudio.update({
                where: { id: slideAudio.id },
                data: {
                    status: 'done',
                    audioFileName: fileName,
                    audioUrl: `/uploads/lessons/${lessonId}/audio/${fileName}`,
                    audioDuration: audioDurationSeconds,
                    voiceId: modelConfig.modelName,
                },
            });

            return updated;
        } catch (error) {
            this.logger.error(`Failed to generate audio for slide ${slideIndex}:`, error);

            await this.prisma.slideAudio.update({
                where: { id: slideAudio.id },
                data: {
                    status: 'error',
                    errorMessage: error.message || 'Audio generation failed',
                },
            });

            throw error;
        }
    }

    // Generate audio for all slides
    async generateAllAudios(lessonId: string, userId: string) {
        const slideAudios = await this.getSlideAudios(lessonId);

        if (slideAudios.length === 0) {
            throw new BadRequestException('No slide audios found. Initialize first.');
        }

        const results: any[] = [];
        for (const slideAudio of slideAudios) {
            if (slideAudio.speakerNote?.trim()) {
                try {
                    const result = await this.generateSingleAudio(lessonId, slideAudio.slideIndex, userId);
                    results.push(result);
                } catch (error) {
                    this.logger.error(`Failed slide ${slideAudio.slideIndex}:`, error.message);
                    results.push({ ...slideAudio, status: 'error', errorMessage: error.message });
                }
            }
        }

        // Update lesson step
        await this.prisma.lesson.update({
            where: { id: lessonId },
            data: { currentStep: 4 },
        });

        return results;
    }

    // Delete audio for a single slide (reset to pending)
    async deleteSlideAudio(lessonId: string, slideIndex: number) {
        const slideAudio = await this.prisma.slideAudio.findUnique({
            where: {
                lessonId_slideIndex: { lessonId, slideIndex },
            },
        });

        if (!slideAudio) {
            throw new NotFoundException(`Slide audio at index ${slideIndex} not found`);
        }

        // Delete audio file if exists
        if (slideAudio.audioFileName) {
            const audioDir = this.getAudioDir(lessonId);
            const filePath = path.join(audioDir, slideAudio.audioFileName);
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    this.logger.log(`Deleted audio file: ${filePath}`);
                }
            } catch (err) {
                this.logger.warn(`Failed to delete audio file: ${filePath}`, err);
            }
        }

        // Reset record to pending
        const updated = await this.prisma.slideAudio.update({
            where: { id: slideAudio.id },
            data: {
                status: 'pending',
                audioFileName: null,
                audioUrl: null,
                audioDuration: null,
                voiceId: null,
                errorMessage: null,
            },
        });

        return updated;
    }

    // Update speaker note for a slide and sync to slideScript
    async updateSpeakerNote(lessonId: string, slideIndex: number, newNote: string) {
        const slideAudio = await this.prisma.slideAudio.findUnique({
            where: {
                lessonId_slideIndex: { lessonId, slideIndex },
            },
        });

        if (!slideAudio) {
            throw new NotFoundException(`Slide audio at index ${slideIndex} not found`);
        }

        // Update SlideAudio record
        const updated = await this.prisma.slideAudio.update({
            where: { id: slideAudio.id },
            data: {
                speakerNote: newNote,
                // Reset status since note changed
                status: slideAudio.audioUrl ? 'done' : 'pending',
            },
        });

        // Auto-sync to slideScript
        try {
            await this.syncSingleNoteToSlideScript(lessonId, slideIndex, newNote);
        } catch (error) {
            this.logger.warn(`Failed to auto-sync speaker note: ${error.message}`);
        }

        return updated;
    }

    // Sync a single speaker note back to slide script (JSON or Markdown)
    private async syncSingleNoteToSlideScript(
        lessonId: string,
        slideIndex: number,
        newNote: string,
    ) {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
            select: { slideScript: true },
        });

        if (!lesson?.slideScript) return;

        // Try JSON format first
        const jsonSynced = await this.syncJsonSlideScript(lessonId, lesson.slideScript, slideIndex, newNote);
        if (jsonSynced) {
            this.logger.debug(`Synced speaker note to JSON slideScript at index ${slideIndex}`);
            return;
        }

        // Fallback to Markdown format
        await this.syncMarkdownSlideScript(lessonId, lesson.slideScript, slideIndex, newNote);
    }

    // Sync speaker note to JSON format slideScript
    private async syncJsonSlideScript(
        lessonId: string,
        slideScript: string,
        slideIndex: number,
        newNote: string,
    ): Promise<boolean> {
        try {
            // Extract JSON from markdown code block if present
            const jsonMatch = slideScript.match(/```json?\s*([\s\S]*?)```/);
            const jsonStr = jsonMatch ? jsonMatch[1] : slideScript;

            const data = JSON.parse(jsonStr.trim());
            const slidesArray = data.slides || data;

            if (!Array.isArray(slidesArray)) {
                return false;
            }

            // Find slide by slideIndex field or array index
            let targetSlide = slidesArray.find(s => s.slideIndex === slideIndex);
            if (!targetSlide && slideIndex < slidesArray.length) {
                targetSlide = slidesArray[slideIndex];
            }

            if (!targetSlide) {
                return false;
            }

            // Update speaker note
            targetSlide.speakerNote = newNote;

            // Rebuild JSON string
            const newJsonStr = JSON.stringify(data, null, 2);

            // Replace in original script (preserve markdown wrapper if present)
            let newScript: string;
            if (jsonMatch) {
                newScript = slideScript.replace(/```json?\s*[\s\S]*?```/, '```json\n' + newJsonStr + '\n```');
            } else {
                newScript = newJsonStr;
            }

            await this.prisma.lesson.update({
                where: { id: lessonId },
                data: { slideScript: newScript },
            });

            return true;
        } catch (e) {
            // Not valid JSON
            return false;
        }
    }

    // Sync speaker note to Markdown format slideScript (legacy)
    private async syncMarkdownSlideScript(
        lessonId: string,
        slideScript: string,
        slideIndex: number,
        newNote: string,
    ) {
        // Find slides using markdown pattern
        const slideMatches = [...slideScript.matchAll(/\*\*Slide\s*\d+[:\s]+[^*]+\*\*/gi)];

        if (slideIndex >= slideMatches.length) return;

        const match = slideMatches[slideIndex];
        const startPos = match.index || 0;
        const endPos = slideIndex < slideMatches.length - 1
            ? (slideMatches[slideIndex + 1].index || slideScript.length)
            : slideScript.length;

        const slideContent = slideScript.substring(startPos, endPos);

        // Find the speaker note section in this slide
        const speakerNoteMarkers = ['**[Speaker Notes]:**', '**[Speaker Notes]**:', '**[Speaker Note]:**'];
        let markerIdx = -1;
        let markerLength = 0;

        for (const marker of speakerNoteMarkers) {
            const idx = slideContent.indexOf(marker);
            if (idx !== -1) {
                markerIdx = idx;
                markerLength = marker.length;
                break;
            }
        }

        if (markerIdx === -1) return;

        // Find where the note content ends
        const afterMarker = slideContent.substring(markerIdx + markerLength);
        const endPatterns = ['---', '\n**[', '\n*   **['];
        let noteEndIdx = afterMarker.length;
        for (const pattern of endPatterns) {
            const pos = afterMarker.indexOf(pattern);
            if (pos !== -1 && pos < noteEndIdx) {
                noteEndIdx = pos;
            }
        }

        // Build the new slide content
        const beforeNote = slideContent.substring(0, markerIdx + markerLength);
        const afterNote = slideContent.substring(markerIdx + markerLength + noteEndIdx);
        const newSlideContent = beforeNote + '\n    > "' + newNote + '"\n' + afterNote;

        // Replace in full script
        const newScript = slideScript.substring(0, startPos) +
            newSlideContent +
            slideScript.substring(endPos);

        await this.prisma.lesson.update({
            where: { id: lessonId },
            data: { slideScript: newScript },
        });
    }

    // Sync all speaker notes back to slide script
    async syncSpeakerNotesToSlideScript(lessonId: string) {
        const slideAudios = await this.getSlideAudios(lessonId);

        for (const audio of slideAudios) {
            if (audio.speakerNote) {
                await this.syncSingleNoteToSlideScript(
                    lessonId,
                    audio.slideIndex,
                    audio.speakerNote,
                );
            }
        }

        return { success: true, message: 'Synced speaker notes to slide script' };
    }

    // Get audio file path for download
    getAudioFilePath(lessonId: string, slideIndex: number): string {
        return path.join(
            this.getAudioDir(lessonId),
            `slide_${String(slideIndex).padStart(2, '0')}.mp3`,
        );
    }

    // Helper: Get lesson info for download
    async getLessonForDownload(lessonId: string): Promise<{ title: string } | null> {
        return this.prisma.lesson.findUnique({
            where: { id: lessonId },
            select: { title: true },
        });
    }

    // Helper: Get audio files ready for download
    async getAudioFilesForDownload(lessonId: string): Promise<Array<{ slideIndex: number; audioFileName: string | null }>> {
        return this.prisma.slideAudio.findMany({
            where: { lessonId, status: 'done' },
            orderBy: { slideIndex: 'asc' },
            select: { slideIndex: true, audioFileName: true },
        });
    }

    // Download all audios as ZIP
    async downloadAllAudios(lessonId: string): Promise<{ filePath: string; fileName: string }> {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
            select: { title: true },
        });

        if (!lesson) {
            throw new NotFoundException(`Lesson ${lessonId} not found`);
        }

        const slideAudios = await this.prisma.slideAudio.findMany({
            where: { lessonId, status: 'done' },
            orderBy: { slideIndex: 'asc' },
        });

        if (slideAudios.length === 0) {
            throw new BadRequestException('No audio files available for download');
        }

        // Sanitize lesson title for filename
        const safeTitle = lesson.title
            .replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF ]/g, '_')
            .replace(/\s+/g, '_')
            .substring(0, 50);

        const zipFileName = `${safeTitle}_audio.zip`;
        const audioDir = this.getAudioDir(lessonId);
        const zipFilePath = path.join(audioDir, zipFileName);

        // Delete existing ZIP file if exists
        if (fs.existsSync(zipFilePath)) {
            this.logger.log(`Deleting existing ZIP: ${zipFilePath}`);
            fs.unlinkSync(zipFilePath);
        }

        this.logger.log(`Creating ZIP at: ${zipFilePath}`);
        this.logger.log(`Found ${slideAudios.length} audio records with status=done`);

        // Create ZIP file
        const output = fs.createWriteStream(zipFilePath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        return new Promise((resolve, reject) => {
            output.on('close', () => {
                this.logger.log(`ZIP created successfully: ${zipFilePath} (${archive.pointer()} bytes)`);
                resolve({ filePath: zipFilePath, fileName: zipFileName });
            });

            output.on('error', (err) => {
                this.logger.error(`Output stream error: ${err.message}`);
                reject(err);
            });

            archive.on('error', (err) => {
                this.logger.error(`Archive error: ${err.message}`);
                reject(err);
            });

            archive.on('warning', (err) => {
                this.logger.warn(`Archive warning: ${err.message}`);
            });

            archive.pipe(output);

            // Add each audio file - use actual audioFileName from database
            let addedCount = 0;
            for (const audio of slideAudios) {
                if (!audio.audioFileName) {
                    this.logger.warn(`Slide ${audio.slideIndex} has no audioFileName, skipping`);
                    continue;
                }

                const audioPath = path.join(audioDir, audio.audioFileName);
                if (fs.existsSync(audioPath)) {
                    // Use same extension as source file
                    const ext = path.extname(audio.audioFileName);
                    const downloadName = `${safeTitle}_slide_${audio.slideIndex + 1}${ext}`;
                    archive.file(audioPath, { name: downloadName });
                    addedCount++;
                    this.logger.debug(`Added to ZIP: ${audio.audioFileName} -> ${downloadName}`);
                } else {
                    this.logger.warn(`Audio file not found: ${audioPath}`);
                }
            }

            this.logger.log(`Added ${addedCount} files to ZIP, finalizing...`);
            archive.finalize();
        });
    }

    // Get download info for single slide audio
    async getSlideAudioDownload(lessonId: string, slideIndex: number): Promise<{ filePath: string; fileName: string }> {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
            select: { title: true },
        });

        const slideAudio = await this.prisma.slideAudio.findUnique({
            where: {
                lessonId_slideIndex: { lessonId, slideIndex },
            },
        });

        if (!lesson || !slideAudio) {
            throw new NotFoundException('Audio not found');
        }

        if (slideAudio.status !== 'done' || !slideAudio.audioFileName) {
            throw new BadRequestException('Audio not yet generated');
        }

        const filePath = this.getAudioFilePath(lessonId, slideIndex);
        if (!fs.existsSync(filePath)) {
            throw new NotFoundException('Audio file not found');
        }

        const safeTitle = lesson.title
            .replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF ]/g, '_')
            .replace(/\s+/g, '_')
            .substring(0, 50);

        return {
            filePath,
            fileName: `${safeTitle}_slide_${slideIndex + 1}.mp3`,
        };
    }

    /**
     * Check if buffer already has WAV header
     */
    private hasWavHeader(buffer: Buffer): boolean {
        if (buffer.length < 4) return false;
        // WAV files start with "RIFF"
        return buffer.toString('ascii', 0, 4) === 'RIFF';
    }

    /**
     * Add WAV header to raw PCM data
     * Based on utils/gemini_tts_generator.py write_wav function
     */
    private addWavHeader(pcmData: Buffer, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
        const byteRate = sampleRate * channels * (bitsPerSample / 8);
        const blockAlign = channels * (bitsPerSample / 8);
        const dataSize = pcmData.length;
        const headerSize = 44;
        const fileSize = headerSize + dataSize - 8;

        const header = Buffer.alloc(headerSize);

        // RIFF header
        header.write('RIFF', 0);
        header.writeUInt32LE(fileSize, 4);
        header.write('WAVE', 8);

        // fmt chunk
        header.write('fmt ', 12);
        header.writeUInt32LE(16, 16); // fmt chunk size
        header.writeUInt16LE(1, 20); // audio format (PCM)
        header.writeUInt16LE(channels, 22);
        header.writeUInt32LE(sampleRate, 24);
        header.writeUInt32LE(byteRate, 28);
        header.writeUInt16LE(blockAlign, 32);
        header.writeUInt16LE(bitsPerSample, 34);

        // data chunk
        header.write('data', 36);
        header.writeUInt32LE(dataSize, 40);

        return Buffer.concat([header, pcmData]);
    }
}

