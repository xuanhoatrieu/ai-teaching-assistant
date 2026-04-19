import {
    Injectable,
    Logger,
    NotFoundException,
    BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TTSService } from '../tts/tts.service';
import { ModelConfigService } from '../model-config/model-config.service';
import { AiProviderService } from '../ai/ai-provider.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import * as fs from 'fs';
import * as path from 'path';

export interface ParsedSlide {
    index: number;
    title: string;
    content: string[];
    noteFull: string;
    noteEN: string;
    noteVN: string;
    hasDual: boolean;
    audioUrl: string | null;
    audioDuration: number | null;
    audioStatus: string; // pending | generating | done | error
    errorMessage: string | null;
}

export interface TTSOptions {
    multilingualMode?: string;
    vittsMode?: string;
    vittsDesignInstruct?: string;
    vittsNormalize?: boolean;
}

@Injectable()
export class PptxAudioToolService {
    private readonly logger = new Logger(PptxAudioToolService.name);
    private readonly uploadsDir = path.join(process.cwd(), 'uploads', 'pptx-tool');
    private readonly pythonServiceUrl: string;

    constructor(
        private readonly prisma: PrismaService,
        private readonly ttsService: TTSService,
        private readonly modelConfigService: ModelConfigService,
        private readonly aiProvider: AiProviderService,
        private readonly apiKeysService: ApiKeysService,
    ) {
        this.pythonServiceUrl = process.env.PPTX_SERVICE_URL || 'http://localhost:3002';
        if (!fs.existsSync(this.uploadsDir)) {
            fs.mkdirSync(this.uploadsDir, { recursive: true });
        }
    }

    // ========== SESSION MANAGEMENT ==========

    async listSessions(userId: string) {
        const sessions = await this.prisma.pptxAudioSession.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                fileName: true,
                status: true,
                language: true,
                createdAt: true,
                updatedAt: true,
                slidesJson: true,
            },
        });

        return sessions.map(s => {
            let totalSlides = 0;
            let audioCount = 0;
            if (s.slidesJson) {
                try {
                    const slides = JSON.parse(s.slidesJson);
                    totalSlides = slides.length;
                    audioCount = slides.filter((sl: any) => sl.audioStatus === 'done').length;
                } catch { /* empty */ }
            }
            return {
                id: s.id,
                fileName: s.fileName,
                status: s.status,
                language: s.language,
                createdAt: s.createdAt,
                updatedAt: s.updatedAt,
                totalSlides,
                audioCount,
            };
        });
    }

    async deleteSession(sessionId: string, userId: string) {
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
        });
        if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
        if (session.userId !== userId) throw new BadRequestException('Not authorized');

        // Delete files on disk
        const sessionDir = path.join(this.uploadsDir, sessionId);
        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        }

        // Delete DB record
        await this.prisma.pptxAudioSession.delete({ where: { id: sessionId } });

        return { deleted: true };
    }

    private getSessionDir(sessionId: string): string {
        const dir = path.join(this.uploadsDir, sessionId);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return dir;
    }

    private getAudioDir(sessionId: string): string {
        const dir = path.join(this.getSessionDir(sessionId), 'audio');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return dir;
    }

    // ========== 1. UPLOAD & PARSE ==========

    async uploadAndParse(file: Express.Multer.File, userId: string) {
        this.logger.log(`Uploading PPTX: ${file.originalname} (${file.size} bytes)`);

        // Create session first to get ID
        const session = await this.prisma.pptxAudioSession.create({
            data: {
                userId,
                fileName: file.originalname,
                filePath: '', // Will update after moving file
                status: 'uploaded',
            },
        });

        // Move file to session directory
        const sessionDir = this.getSessionDir(session.id);
        const destPath = path.join(sessionDir, 'original.pptx');
        fs.renameSync(file.path, destPath);

        // Update session with file path
        await this.prisma.pptxAudioSession.update({
            where: { id: session.id },
            data: { filePath: destPath },
        });

        // Call Python service to parse PPTX
        try {
            const formData = new FormData();
            const fileBuffer = fs.readFileSync(destPath);
            const blob = new Blob([fileBuffer], {
                type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            });
            formData.append('file', blob, file.originalname);

            const response = await fetch(`${this.pythonServiceUrl}/parse-pptx`, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Python service error: ${errorText}`);
            }

            const result = await response.json() as { slides: any[]; totalSlides: number };

            // Build slides JSON with audio status
            const slides: ParsedSlide[] = result.slides.map((s: any) => ({
                index: s.index,
                title: s.title || `Slide ${s.index + 1}`,
                content: s.content || [],
                noteFull: s.noteFull || '',
                noteEN: s.noteEN || '',
                noteVN: s.noteVN || '',
                hasDual: s.hasDual || false,
                audioUrl: null,
                audioDuration: null,
                audioStatus: 'pending',
                errorMessage: null,
            }));

            // Build content JSON
            const content = result.slides.map((s: any) => ({
                index: s.index,
                title: s.title || `Slide ${s.index + 1}`,
                content: s.content || [],
            }));

            // Update session
            const updated = await this.prisma.pptxAudioSession.update({
                where: { id: session.id },
                data: {
                    slidesJson: JSON.stringify(slides),
                    contentJson: JSON.stringify(content),
                    status: 'notes_extracted',
                },
            });

            return {
                sessionId: session.id,
                fileName: file.originalname,
                totalSlides: slides.length,
                slides,
                status: 'notes_extracted',
            };
        } catch (error) {
            this.logger.error(`Failed to parse PPTX: ${error.message}`);
            // Clean up on failure
            await this.prisma.pptxAudioSession.delete({ where: { id: session.id } }).catch(() => {});
            throw new BadRequestException(`Failed to parse PPTX file: ${error.message}`);
        }
    }

    // ========== 2. GET SESSION / SLIDES ==========

    async getSession(sessionId: string) {
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
        });
        if (!session) {
            throw new NotFoundException(`Session ${sessionId} not found`);
        }
        const slides = session.slidesJson ? JSON.parse(session.slidesJson) : [];
        return {
            ...session,
            slides,
            totalSlides: slides.length,
        };
    }

    async getSlides(sessionId: string): Promise<ParsedSlide[]> {
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
            select: { slidesJson: true },
        });
        if (!session) {
            throw new NotFoundException(`Session ${sessionId} not found`);
        }
        return session.slidesJson ? JSON.parse(session.slidesJson) : [];
    }

    // ========== 3. LANGUAGE TOGGLE ==========

    async setLanguage(sessionId: string, language: 'en' | 'vi') {
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
        });
        if (!session) {
            throw new NotFoundException(`Session ${sessionId} not found`);
        }

        const updated = await this.prisma.pptxAudioSession.update({
            where: { id: sessionId },
            data: { language },
        });

        return { language: updated.language };
    }

    // ========== 4. EDIT NOTE ==========

    async updateNote(sessionId: string, slideIndex: number, note: string) {
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
        });
        if (!session) {
            throw new NotFoundException(`Session ${sessionId} not found`);
        }

        const slides: ParsedSlide[] = session.slidesJson ? JSON.parse(session.slidesJson) : [];
        const slide = slides.find(s => s.index === slideIndex);
        if (!slide) {
            throw new NotFoundException(`Slide ${slideIndex} not found`);
        }

        // Update the active language note
        if (session.language === 'en') {
            slide.noteEN = note;
        } else {
            slide.noteVN = note;
        }
        slide.noteFull = note; // Also update full

        await this.prisma.pptxAudioSession.update({
            where: { id: sessionId },
            data: { slidesJson: JSON.stringify(slides) },
        });

        return slide;
    }

    // ========== 5. GENERATE AUDIO ==========

    async generateAudio(sessionId: string, slideIndex: number, userId: string, options?: TTSOptions) {
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
        });
        if (!session) {
            throw new NotFoundException(`Session ${sessionId} not found`);
        }

        const slides: ParsedSlide[] = session.slidesJson ? JSON.parse(session.slidesJson) : [];
        const slide = slides.find(s => s.index === slideIndex);
        if (!slide) {
            throw new NotFoundException(`Slide ${slideIndex} not found`);
        }

        // Get the note based on active language
        const ttsText = session.language === 'en' ? slide.noteEN : slide.noteVN;
        if (!ttsText?.trim()) {
            throw new BadRequestException(`Slide ${slideIndex} has no speaker note for language: ${session.language}`);
        }

        // Update status to generating
        slide.audioStatus = 'generating';
        slide.errorMessage = null;
        await this.prisma.pptxAudioSession.update({
            where: { id: sessionId },
            data: { slidesJson: JSON.stringify(slides) },
        });

        try {
            // Get TTS config (reuse existing logic from SlideAudioService)
            const modelConfig = await this.modelConfigService.getModelForTask(userId, 'TTS');
            let provider = modelConfig.provider || 'GEMINI';
            let voiceName = 'Puck';
            const defaultTTSConfig = await this.modelConfigService.getDefaultForTask('TTS');
            let modelName = defaultTTSConfig.modelName;

            if (modelConfig.modelName?.startsWith('gemini-voice:')) {
                voiceName = modelConfig.modelName.split(':')[1];
                if (modelConfig.provider === 'CLIPROXY') {
                    provider = 'CLIPROXY';
                    const cliproxyTTSConfig = await this.prisma.systemConfig.findUnique({
                        where: { key: 'cliproxy.defaultTTSModel' },
                    });
                    if (cliproxyTTSConfig?.value) modelName = cliproxyTTSConfig.value;
                } else {
                    provider = 'GEMINI';
                }
            } else if (modelConfig.modelName?.startsWith('vbee:')) {
                provider = 'VBEE';
                voiceName = modelConfig.modelName.split(':')[1];
                modelName = 'vbee-tts';
            } else if (modelConfig.modelName?.startsWith('vitts:')) {
                provider = 'VITTS';
                voiceName = modelConfig.modelName;
                modelName = 'vitts';
                if (!options?.vittsMode) {
                    if (modelConfig.modelName.startsWith('vitts:ref:')) options = { ...options, vittsMode: 'clone' };
                    else if (modelConfig.modelName === 'vitts:design') options = { ...options, vittsMode: 'design' };
                    else options = { ...options, vittsMode: 'auto' };
                }
            } else if (modelConfig.modelName) {
                voiceName = modelConfig.modelName;
            }

            this.logger.log(`[PptxAudioTool] TTS: provider=${provider}, model=${modelName}, voice=${voiceName}`);

            // Generate audio
            const result = await this.ttsService.generateAudio(userId, {
                text: ttsText,
                voiceId: voiceName,
                model: modelName,
                provider: provider,
                multilingualMode: options?.multilingualMode,
                vittsMode: options?.vittsMode as any,
                vittsDesignInstruct: options?.vittsDesignInstruct,
                vittsNormalize: options?.vittsNormalize,
            });

            // Save audio file
            const audioDir = this.getAudioDir(sessionId);
            const fileExt = result.format === 'wav' ? 'wav' : 'mp3';
            const fileName = `slide_${String(slideIndex).padStart(2, '0')}.${fileExt}`;
            const filePath = path.join(audioDir, fileName);

            if (result.audio) {
                if (result.format === 'wav' && !this.hasWavHeader(result.audio)) {
                    const wavBuffer = this.addWavHeader(result.audio, 24000, 1, 16);
                    fs.writeFileSync(filePath, wavBuffer);
                } else {
                    fs.writeFileSync(filePath, result.audio);
                }
            }

            // Calculate duration
            const audioDuration = result.audio
                ? result.audio.length / (24000 * 2 * 1)
                : null;

            // Update slide status
            slide.audioStatus = 'done';
            slide.audioUrl = `/uploads/pptx-tool/${sessionId}/audio/${fileName}`;
            slide.audioDuration = audioDuration;
            slide.errorMessage = null;

            await this.prisma.pptxAudioSession.update({
                where: { id: sessionId },
                data: { slidesJson: JSON.stringify(slides) },
            });

            return slide;
        } catch (error) {
            this.logger.error(`Failed to generate audio for slide ${slideIndex}: ${error.message}`);

            slide.audioStatus = 'error';
            slide.errorMessage = error.message || 'Audio generation failed';

            await this.prisma.pptxAudioSession.update({
                where: { id: sessionId },
                data: { slidesJson: JSON.stringify(slides) },
            });

            throw error;
        }
    }

    // ========== 6. GENERATE ALL AUDIO ==========

    async generateAllAudio(sessionId: string, userId: string, options?: TTSOptions) {
        const slides = await this.getSlides(sessionId);
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
            select: { language: true },
        });
        if (!session) throw new NotFoundException(`Session ${sessionId} not found`);

        const results: any[] = [];
        for (const slide of slides) {
            const noteText = session.language === 'en' ? slide.noteEN : slide.noteVN;
            if (!noteText?.trim()) {
                this.logger.log(`Skipping slide ${slide.index} — no speaker note`);
                continue;
            }
            if (slide.audioStatus === 'done' && slide.audioUrl) {
                this.logger.log(`Skipping slide ${slide.index} — already has audio`);
                continue;
            }

            try {
                const result = await this.generateAudio(sessionId, slide.index, userId, options);
                results.push(result);
            } catch (error) {
                this.logger.error(`Failed slide ${slide.index}: ${error.message}`);
                results.push({ index: slide.index, audioStatus: 'error', errorMessage: error.message });
            }
        }

        // Update session status
        await this.prisma.pptxAudioSession.update({
            where: { id: sessionId },
            data: { status: 'audio_done' },
        });

        return results;
    }

    // ========== 7. DELETE AUDIO ==========

    async deleteAudio(sessionId: string, slideIndex: number) {
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
        });
        if (!session) throw new NotFoundException(`Session ${sessionId} not found`);

        const slides: ParsedSlide[] = session.slidesJson ? JSON.parse(session.slidesJson) : [];
        const slide = slides.find(s => s.index === slideIndex);
        if (!slide) throw new NotFoundException(`Slide ${slideIndex} not found`);

        // Delete audio file
        if (slide.audioUrl) {
            const audioDir = this.getAudioDir(sessionId);
            const fileName = `slide_${String(slideIndex).padStart(2, '0')}`;
            // Try both extensions
            for (const ext of ['wav', 'mp3']) {
                const filePath = path.join(audioDir, `${fileName}.${ext}`);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    this.logger.log(`Deleted audio: ${filePath}`);
                }
            }
        }

        // Reset slide audio status
        slide.audioUrl = null;
        slide.audioDuration = null;
        slide.audioStatus = 'pending';
        slide.errorMessage = null;

        await this.prisma.pptxAudioSession.update({
            where: { id: sessionId },
            data: { slidesJson: JSON.stringify(slides) },
        });

        return slide;
    }

    // ========== 8. DOWNLOAD PPTX WITH AUDIO ==========

    async downloadPptxWithAudio(sessionId: string): Promise<{ buffer: Buffer; filename: string }> {
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
        });
        if (!session) throw new NotFoundException(`Session ${sessionId} not found`);

        const slides: ParsedSlide[] = session.slidesJson ? JSON.parse(session.slidesJson) : [];

        // Build audio files list for injection
        const audioFiles: { slideIndex: number; audioPath: string }[] = [];
        const audioDir = this.getAudioDir(sessionId);

        for (const slide of slides) {
            if (slide.audioStatus === 'done' && slide.audioUrl) {
                // Find actual audio file
                const fileName = `slide_${String(slide.index).padStart(2, '0')}`;
                for (const ext of ['wav', 'mp3']) {
                    const filePath = path.join(audioDir, `${fileName}.${ext}`);
                    if (fs.existsSync(filePath)) {
                        audioFiles.push({ slideIndex: slide.index, audioPath: filePath });
                        break;
                    }
                }
            }
        }

        if (audioFiles.length === 0) {
            throw new BadRequestException('No audio files to inject. Generate audio first.');
        }

        // Call Python service to inject audio
        const response = await fetch(`${this.pythonServiceUrl}/inject-audio`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pptxPath: session.filePath,
                audioFiles,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new BadRequestException(`Failed to inject audio: ${errorText}`);
        }

        const result = await response.json() as { buffer: string };
        const buffer = Buffer.from(result.buffer, 'base64');

        // Generate filename
        const baseName = path.basename(session.fileName, '.pptx');
        const filename = `${baseName}_with_audio.pptx`;

        return { buffer, filename };
    }

    // ========== 9. GENERATE QUESTIONS ==========

    async generateQuestions(
        sessionId: string,
        userId: string,
        counts: { level1Count?: number; level2Count?: number; level3Count?: number },
    ) {
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
        });
        if (!session) throw new NotFoundException(`Session ${sessionId} not found`);

        const content = session.contentJson ? JSON.parse(session.contentJson) : [];
        if (content.length === 0) {
            throw new BadRequestException('No slide content available for question generation');
        }

        // Build content text for AI prompt
        const contentText = content.map((s: any) =>
            `Slide ${s.index + 1}: ${s.title}\n${(s.content || []).join('\n')}`
        ).join('\n\n');

        // Get AI model config
        const modelConfig = await this.modelConfigService.getModelForTask(userId, 'QUESTIONS');

        const level1 = counts.level1Count ?? 20;
        const level2 = counts.level2Count ?? 20;
        const level3 = counts.level3Count ?? 10;

        // Build prompt for question generation
        const prompt = `Bạn là giảng viên đại học. Hãy tạo bộ câu hỏi trắc nghiệm từ nội dung bài giảng sau.

NỘI DUNG BÀI GIẢNG:
${contentText}

YÊU CẦU:
- Tạo ${level1} câu hỏi mức 1 (Biết/Remember - Kiến thức cơ bản)
- Tạo ${level2} câu hỏi mức 2 (Hiểu/Understand - Phân tích, so sánh)
- Tạo ${level3} câu hỏi mức 3 (Vận dụng/Apply - Tình huống thực tế)
- Mỗi câu có 4 đáp án A, B, C, D
- Đáp án A LUÔN là đáp án đúng
- Có giải thích ngắn gọn vì sao A đúng

Trả lời dưới dạng JSON:
\`\`\`json
{
  "questions": [
    {
      "id": "Q1",
      "level": 1,
      "question": "Nội dung câu hỏi?",
      "correctAnswer": "Đáp án đúng",
      "optionB": "Đáp án sai B",
      "optionC": "Đáp án sai C",
      "optionD": "Đáp án sai D",
      "explanation": "Giải thích vì sao A đúng"
    }
  ]
}
\`\`\``;

        // Use AiProviderService (CLIProxy → Gemini SDK fallback)
        const apiKey = await this.apiKeysService.getActiveKey(userId, 'GEMINI');
        const modelName = modelConfig.modelName || 'gemini-2.0-flash';

        this.logger.log(`[PptxAudioTool] Generating questions with model: ${modelName}`);
        const aiResult = await this.aiProvider.generateText(prompt, modelName, apiKey || undefined, { maxTokens: 32768 });
        const responseText = aiResult.content;
        this.logger.log(`[PptxAudioTool] Questions generated via ${aiResult.provider} (${aiResult.model})`);

        if (!responseText) {
            this.logger.error(`AI returned null/empty content. Provider: ${aiResult.provider}, model: ${aiResult.model}`);
            throw new BadRequestException('AI returned empty response. Please try again or switch model.');
        }

        // Parse response — clean markdown code blocks
        let questions: any[] = [];
        try {
            const cleanedResponse = this.cleanJsonResponse(responseText);
            const parsed = JSON.parse(cleanedResponse);
            questions = parsed.questions || parsed;
        } catch (parseError) {
            this.logger.error(`Failed to parse questions JSON: ${parseError.message}`);
            this.logger.debug(`Raw response (first 500 chars): ${responseText?.substring(0, 500)}`);
            throw new BadRequestException('Failed to parse generated questions. AI response was not valid JSON.');
        }

        if (!Array.isArray(questions) || questions.length === 0) {
            this.logger.error('Parsed questions is empty or not an array');
            throw new BadRequestException('AI generated 0 questions. Please try again.');
        }

        // Save to session
        await this.prisma.pptxAudioSession.update({
            where: { id: sessionId },
            data: {
                questionsJson: JSON.stringify(questions),
                status: 'completed',
            },
        });

        return {
            questions,
            totalCount: questions.length,
            counts: {
                level1: questions.filter((q: any) => q.level === 1).length,
                level2: questions.filter((q: any) => q.level === 2).length,
                level3: questions.filter((q: any) => q.level === 3).length,
            },
        };
    }

    // ========== 10. GET QUESTIONS (for export) ==========

    async getQuestions(sessionId: string): Promise<any[]> {
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
        });
        if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
        if (!session.questionsJson) return [];
        try {
            return JSON.parse(session.questionsJson);
        } catch {
            return [];
        }
    }

    // ========== JSON PARSING UTILITIES ==========

    private cleanJsonResponse(response: string): string {
        let cleaned = response.trim();

        // Remove markdown code block wrapper
        if (cleaned.startsWith('```json')) {
            cleaned = cleaned.slice(7);
        } else if (cleaned.startsWith('```')) {
            cleaned = cleaned.slice(3);
        }

        if (cleaned.endsWith('```')) {
            cleaned = cleaned.slice(0, -3);
        }

        return cleaned.trim();
    }

    // ========== WAV UTILITIES (copied from SlideAudioService) ==========

    private hasWavHeader(buffer: Buffer): boolean {
        if (buffer.length < 4) return false;
        return buffer.toString('ascii', 0, 4) === 'RIFF';
    }

    private addWavHeader(pcmData: Buffer, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
        const byteRate = sampleRate * channels * (bitsPerSample / 8);
        const blockAlign = channels * (bitsPerSample / 8);
        const dataSize = pcmData.length;
        const headerSize = 44;
        const fileSize = headerSize + dataSize - 8;

        const header = Buffer.alloc(headerSize);
        header.write('RIFF', 0);
        header.writeUInt32LE(fileSize, 4);
        header.write('WAVE', 8);
        header.write('fmt ', 12);
        header.writeUInt32LE(16, 16);
        header.writeUInt16LE(1, 20);
        header.writeUInt16LE(channels, 22);
        header.writeUInt32LE(sampleRate, 24);
        header.writeUInt32LE(byteRate, 28);
        header.writeUInt16LE(blockAlign, 32);
        header.writeUInt16LE(bitsPerSample, 34);
        header.write('data', 36);
        header.writeUInt32LE(dataSize, 40);

        return Buffer.concat([header, pcmData]);
    }
}
