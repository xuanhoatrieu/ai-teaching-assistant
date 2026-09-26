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
import { GenerationJobService } from '../generation-job/generation-job.service';
import * as fs from 'fs';
import * as path from 'path';
import type { Response } from 'express';
import * as ExcelJS from 'exceljs';
import {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
    WidthType,
    AlignmentType,
    BorderStyle,
} from 'docx';
import {
    buildMoodleXml,
    buildEnglishMoodleXml,
    ReviewQuestionData,
    EnglishQuestionData,
} from '../questions/moodle-xml.helper';
import { fixUtf8Filename } from '../common/string.util';

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
        private readonly jobService: GenerationJobService,
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
                fileName: fixUtf8Filename(s.fileName),
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
        const fileName = fixUtf8Filename(file.originalname);
        this.logger.log(`Uploading PPTX: ${fileName} (${file.size} bytes)`);

        // Create session first to get ID
        const session = await this.prisma.pptxAudioSession.create({
            data: {
                userId,
                fileName,
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
            // Since the python service mounts the same /uploads volume,
            // we can just pass the path to save memory and avoid Nginx bottlenecks!
            const reqBody = { file_path: destPath };

            const response = await fetch(`${this.pythonServiceUrl}/parse-pptx-local`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reqBody),
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
                fileName,
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
            fileName: fixUtf8Filename(session.fileName),
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

    // ========== 4B. GENERATE & OPTIMIZE SPEAKER NOTES (AI BACKGROUND JOBS) ==========

    async generateSpeakerNotesBackground(
        jobId: string,
        sessionId: string,
        userId: string,
        mode: 'all' | 'missing' = 'all',
    ) {
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
        });
        if (!session) {
            throw new NotFoundException(`Session ${sessionId} not found`);
        }

        const slides: ParsedSlide[] = session.slidesJson ? JSON.parse(session.slidesJson) : [];
        if (slides.length === 0) {
            throw new BadRequestException('No slides found in session');
        }

        const language = session.language || 'vi';

        // Filter target slides
        const targetSlides = mode === 'missing'
            ? slides.filter(s => {
                const note = language === 'en' ? s.noteEN : s.noteVN;
                return !note?.trim();
            })
            : slides;

        if (targetSlides.length === 0) {
            await this.jobService.updateProgress(jobId, 100, 'Tất cả các slide đã có lời giảng!');
            await this.jobService.completeJob(jobId);
            return;
        }

        const modelConfig = await this.modelConfigService.getModelForTask(userId, 'SPEAKER_NOTES');
        const modelName = modelConfig.modelName || 'gemini-2.5-flash';
        const BATCH_SIZE = 3;
        let previousSlideBridge = '';

        this.logger.log(`[PptxAudioTool] Generating speaker notes for ${targetSlides.length} slides (${mode}) using ${modelName}`);

        for (let i = 0; i < targetSlides.length; i += BATCH_SIZE) {
            if (await this.jobService.isJobCancelled(jobId)) {
                this.logger.log(`[generateSpeakerNotesBackground] Job ${jobId} was cancelled by user.`);
                return;
            }

            const batch = targetSlides.slice(i, i + BATCH_SIZE);
            const batchStart = i + 1;
            const batchEnd = Math.min(i + BATCH_SIZE, targetSlides.length);
            const percent = Math.round((i / targetSlides.length) * 90);

            await this.jobService.updateProgress(
                jobId,
                percent,
                `Đang soạn lời giảng (Slide ${batchStart} - ${batchEnd} / ${targetSlides.length})...`,
            );

            // Build slides content text
            const slidesContent = batch.map(s => {
                const existingNote = (language === 'en' ? s.noteEN : s.noteVN)?.trim() || s.noteFull?.trim();
                const contentLines = Array.isArray(s.content) ? s.content.join('\n  • ') : (s.content || '');
                let sText = `--- Slide ${s.index + 1} ---\nIndex: ${s.index}\nTiêu đề: ${s.title}\nNội dung chính:\n  • ${contentLines}`;
                if (existingNote) {
                    sText += `\nLời giảng / Ghi chú có sẵn của giảng viên:\n"${existingNote}"\n(Hướng dẫn: Hãy kết hợp ý tưởng của giảng viên với nội dung trên slide để hoàn thiện thành bài giảng chỉn chu, sâu sắc)`;
                }
                return sText;
            }).join('\n\n');

            const promptContent = previousSlideBridge
                ? `[Chủ đề vừa giải thích ở phần trước để nối mạch tự nhiên: "${previousSlideBridge}"]\n(Lưu ý: Tuyệt đối KHÔNG dùng từ "slide trước" hay "slide", hãy nối mạch kiến thức tự nhiên)\n\n${slidesContent}`
                : slidesContent;

            const langInstruction = language === 'en'
                ? 'Generate natural, academic, spoken English speaker notes for university lectures.'
                : 'Soạn lời giảng bằng tiếng Việt chuẩn mực, khẩu ngữ sư phạm tự nhiên như giảng viên đại học đang giảng trực tiếp.';

            const prompt = `**Nhiệm vụ: Soạn Lời Giảng Sư Phạm Cho Từng Slide Thuyết Trình (Academic Lecture Transcript)**

Bạn là một giảng viên đại học giàu kinh nghiệm, uyên bác và truyền cảm hứng.
Hãy chuyển đổi nội dung tóm tắt trên slide thành lời giảng nói trực tiếp trong lớp học cho từng slide dưới đây.

${langInstruction}

**Thông tin bài giảng:**
- Tên tệp: ${session.fileName}
- Ngôn ngữ: ${language === 'en' ? 'English' : 'Tiếng Việt'}

**Nội dung các slide cần soạn:**
${promptContent}

---

## ⏱️ QUY CHUẨN ĐỘ DÀI & THỜI LƯỢNG (RẤT QUAN TRỌNG):
- **Slide nội dung kiến thức:** **180 – 220 từ** (Tương đương 1.5 – 2.0 phút nói ở tốc độ giảng bài chuẩn).
- **Slide Tiêu đề / Mục tiêu / Tổng kết / Cảm ơn:** **60 – 100 từ** (30 – 45 giây).
- ⚠️ Không viết quá ngắn sơ sài dưới 120 từ, cũng không viết lan man quá 230 từ.

## 🎓 CẤU TRÚC 1 LỜI GIẢNG CHUẨN:
1. Mở đầu tự nhiên, gắn kết thực tế hoặc đặt vấn đề trọng tâm (1–2 câu). Đa dạng hóa câu mở đầu giữa các slide, tránh rập khuôn.
2. Diễn giải sâu sắc nguyên lý cốt lõi, cơ chế và ví dụ minh họa sinh động (3–4 câu).
3. Nhấn mạnh lưu ý thực tiễn hoặc sai lầm thường gặp (1–2 câu).
4. Đúc kết và chuyển tiếp mạch lạc sang ý tiếp theo (1 câu).

## 🚫 QUY TẮC CẤM NGHIÊM NGẶT (ANTI-AI & SƯ PHẠM):
- ❌ **TUYỆT ĐỐI KHÔNG dùng từ "slide":** KHÔNG nói "trên slide", "ở slide này", "slide trước", "slide tiếp theo", "nhìn vào slide", "bản trình chiếu". Hãy dùng: "Ở đây chúng ta thấy...", "Xem xét sơ đồ này...", "Tiếp theo, chúng ta sẽ khảo sát...".
- ❌ **HẠN CHẾ từ "các bạn":** Không mở đầu câu nào cũng "Các bạn...". Dùng "chúng ta", câu chủ động hoặc câu mệnh lệnh học thuật ("Hãy chú ý...", "Cần lưu ý rằng...").
- ❌ **KHÔNG dùng khẩu khí AI sáo rỗng:** "khám phá", "chìa khóa vàng", "vũ khí đắc lực", "bức tranh toàn cảnh", "không chỉ dừng lại ở đó", "vô cùng tuyệt vời".

---

## ĐỊNH DẠNG ĐẦU RA (CHỈ TRẢ VỀ JSON DUY NHẤT):
\`\`\`json
{
  "speakerNotes": [
    {
      "slideIndex": 0,
      "speakerNote": "Lời giảng học thuật tự nhiên 180 - 220 từ cho slide..."
    }
  ]
}
\`\`\`
Return JSON only.`;

            try {
                const aiResult = await this.aiProvider.generateText(prompt, modelName, userId, { maxTokens: 16384 });
                const notesList = this.parseBatchNotesJson(aiResult.content);

                if (notesList.length > 0) {
                    for (const item of notesList) {
                        const sIdx = Number(item.slideIndex);
                        const target = slides.find(s => s.index === sIdx) || batch.find(s => s.index === sIdx) || batch[0];
                        if (target && item.speakerNote) {
                            const cleanedText = this.cleanAntiAIPhrases(item.speakerNote);
                            if (language === 'en') {
                                target.noteEN = cleanedText;
                            } else {
                                target.noteVN = cleanedText;
                            }
                            target.noteFull = cleanedText;
                            if (target.audioStatus === 'done' || target.audioStatus === 'error') {
                                target.audioStatus = 'pending';
                            }
                        }
                    }

                    const lastItem = notesList[notesList.length - 1];
                    if (lastItem?.speakerNote) {
                        previousSlideBridge = lastItem.speakerNote.substring(0, 140);
                    }

                    await this.prisma.pptxAudioSession.update({
                        where: { id: sessionId },
                        data: { slidesJson: JSON.stringify(slides) },
                    });
                }
            } catch (err: any) {
                this.logger.warn(`[generateSpeakerNotesBackground] Error generating batch ${batchStart}-${batchEnd}: ${err.message}`);
            }
        }

        await this.prisma.pptxAudioSession.update({
            where: { id: sessionId },
            data: {
                slidesJson: JSON.stringify(slides),
                status: 'notes_ready',
            },
        });

        await this.jobService.updateProgress(jobId, 100, `Hoàn tất tạo lời giảng cho ${targetSlides.length} slide!`);
        await this.jobService.completeJob(jobId);
    }

    async optimizeSpeakerNotesBackground(
        jobId: string,
        sessionId: string,
        userId: string,
    ) {
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
        });
        if (!session) {
            throw new NotFoundException(`Session ${sessionId} not found`);
        }

        const slides: ParsedSlide[] = session.slidesJson ? JSON.parse(session.slidesJson) : [];
        const language = session.language || 'vi';

        const slidesWithNotes = slides.filter(s => {
            const note = language === 'en' ? s.noteEN : s.noteVN;
            return note?.trim();
        });

        if (slidesWithNotes.length === 0) {
            throw new BadRequestException('Không có slide nào có lời giảng để tối ưu');
        }

        const modelConfig = await this.modelConfigService.getModelForTask(userId, 'SPEAKER_NOTES');
        const modelName = modelConfig.modelName || 'gemini-2.5-flash';
        const BATCH_SIZE = 3;

        this.logger.log(`[PptxAudioTool] Optimizing speaker notes for ${slidesWithNotes.length} slides using ${modelName}`);

        for (let i = 0; i < slidesWithNotes.length; i += BATCH_SIZE) {
            if (await this.jobService.isJobCancelled(jobId)) {
                this.logger.log(`[optimizeSpeakerNotesBackground] Job ${jobId} was cancelled by user.`);
                return;
            }

            const batch = slidesWithNotes.slice(i, i + BATCH_SIZE);
            const batchStart = i + 1;
            const batchEnd = Math.min(i + BATCH_SIZE, slidesWithNotes.length);
            const percent = Math.round((i / slidesWithNotes.length) * 90);

            await this.jobService.updateProgress(
                jobId,
                percent,
                `Đang tối ưu & kiểm duyệt nhịp điệu đọc TTS (Slide ${batchStart} - ${batchEnd} / ${slidesWithNotes.length})...`,
            );

            const slidesContent = batch.map(s => {
                const currentNote = (language === 'en' ? s.noteEN : s.noteVN)?.trim() || s.noteFull?.trim();
                const contentLines = Array.isArray(s.content) ? s.content.join(', ') : (s.content || '');
                return `--- Slide ${s.index + 1} (Index: ${s.index}) ---\nTiêu đề: ${s.title}\nNội dung slide: ${contentLines}\nLời giảng hiện tại cần tối ưu:\n"${currentNote}"`;
            }).join('\n\n');

            const prompt = `**Tối Ưu & Kiểm Duyệt Lời Giảng Cho Giọng Đọc AI (TTS Polish & Duration Control)**

Bạn là Đạo diễn Giọng đọc và Chuyên gia Sư phạm. Hãy trau chuốt các đoạn lời giảng dưới đây để sẵn sàng tạo audio với công cụ Text-To-Speech (ViTTS / AI voice):
1. **Ngắt nhịp tự nhiên:** Thêm dấu phẩy (,), dấu chấm (.) hợp lý để khi máy đọc có nhịp thở tự nhiên, êm tai, không bị dồn dập hay ngắt quãng vụng về.
2. **Chuẩn hóa phát âm:** Các từ viết tắt, số liệu, công thức, ký hiệu chuyên môn cần được viết dạng dễ phát âm chính xác nhất cho TTS.
3. **Độ dài chuẩn xác:** Giữ thời lượng 180 – 220 từ/slide nội dung (khoảng 1.5 – 2.0 phút). KHÔNG bổ sung ý lan man làm kéo dài thời gian quá mức.
4. **Lọc sạch từ ngữ AI sáo rỗng & cấm từ "slide".**

**Nội dung các slide cần tối ưu:**
${slidesContent}

---

## ĐỊNH DẠNG ĐẦU RA (CHỈ TRẢ VỀ JSON DUY NHẤT):
\`\`\`json
{
  "speakerNotes": [
    {
      "slideIndex": 0,
      "speakerNote": "Lời giảng đã tối ưu nhịp thở và dấu câu cho TTS..."
    }
  ]
}
\`\`\`
Return JSON only.`;

            try {
                const aiResult = await this.aiProvider.generateText(prompt, modelName, userId, { maxTokens: 16384 });
                const notesList = this.parseBatchNotesJson(aiResult.content);

                if (notesList.length > 0) {
                    for (const item of notesList) {
                        const sIdx = Number(item.slideIndex);
                        const target = slides.find(s => s.index === sIdx) || batch.find(s => s.index === sIdx);
                        if (target && item.speakerNote) {
                            const cleanedText = this.cleanAntiAIPhrases(item.speakerNote);
                            if (language === 'en') {
                                target.noteEN = cleanedText;
                            } else {
                                target.noteVN = cleanedText;
                            }
                            target.noteFull = cleanedText;
                        }
                    }

                    await this.prisma.pptxAudioSession.update({
                        where: { id: sessionId },
                        data: { slidesJson: JSON.stringify(slides) },
                    });
                }
            } catch (err: any) {
                this.logger.warn(`[optimizeSpeakerNotesBackground] Error optimizing batch ${batchStart}-${batchEnd}: ${err.message}`);
            }
        }

        await this.prisma.pptxAudioSession.update({
            where: { id: sessionId },
            data: { slidesJson: JSON.stringify(slides) },
        });

        await this.jobService.updateProgress(jobId, 100, `Hoàn tất tối ưu lời giảng cho ${slidesWithNotes.length} slide!`);
        await this.jobService.completeJob(jobId);
    }

    async importSpeakerNotes(
        sessionId: string,
        notes: Array<{ slideIndex: number; speakerNote: string }>,
    ) {
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
        });
        if (!session) {
            throw new NotFoundException(`Session ${sessionId} not found`);
        }

        const slides: ParsedSlide[] = session.slidesJson ? JSON.parse(session.slidesJson) : [];
        const language = session.language || 'vi';
        let updatedCount = 0;

        for (const item of notes) {
            // Match slide by 1-based index (item.slideIndex matches slide.index + 1) or 0-based index
            const target = slides.find(s => (s.index + 1) === item.slideIndex) || slides.find(s => s.index === item.slideIndex);
            if (target && item.speakerNote && typeof item.speakerNote === 'string' && item.speakerNote.trim()) {
                const note = this.cleanAntiAIPhrases(item.speakerNote.trim());
                if (language === 'en') {
                    target.noteEN = note;
                } else {
                    target.noteVN = note;
                }
                target.noteFull = note;
                // If slide had audio, reset to pending so it can be re-generated
                if (target.audioStatus === 'done' || target.audioStatus === 'error') {
                    target.audioStatus = 'pending';
                }
                updatedCount++;
            }
        }

        await this.prisma.pptxAudioSession.update({
            where: { id: sessionId },
            data: {
                slidesJson: JSON.stringify(slides),
                status: 'notes_ready',
            },
        });

        this.logger.log(`[importSpeakerNotes] Successfully imported ${updatedCount} speaker notes for session ${sessionId}`);

        return {
            success: true,
            importedCount: updatedCount,
            slides,
        };
    }

    private parseBatchNotesJson(responseText: string): Array<{ slideIndex: number; speakerNote: string }> {
        const cleaned = this.cleanJsonResponse(responseText);
        let parsedData: any = null;
        try {
            parsedData = JSON.parse(cleaned);
        } catch {
            const firstBrace = cleaned.indexOf('{');
            const lastBrace = cleaned.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace > firstBrace) {
                try {
                    parsedData = JSON.parse(cleaned.substring(firstBrace, lastBrace + 1));
                } catch {
                    const firstBracket = cleaned.indexOf('[');
                    const lastBracket = cleaned.lastIndexOf(']');
                    if (firstBracket !== -1 && lastBracket > firstBracket) {
                        try {
                            parsedData = JSON.parse(cleaned.substring(firstBracket, lastBracket + 1));
                        } catch { /* empty */ }
                    }
                }
            }
        }

        if (!parsedData) return [];
        const list = Array.isArray(parsedData)
            ? parsedData
            : (parsedData.speakerNotes || parsedData.slides || parsedData.notes || []);
        if (!Array.isArray(list)) return [];
        return list.map((item: any, idx: number) => ({
            slideIndex: item.slideIndex !== undefined ? Number(item.slideIndex) : idx,
            speakerNote: item.speakerNote || item.note || item.content || '',
        })).filter(n => n.speakerNote && typeof n.speakerNote === 'string' && n.speakerNote.trim().length > 0);
    }

    private cleanAntiAIPhrases(text: string): string {
        if (!text) return '';
        let cleaned = text;

        const replacements: Array<[RegExp, string]> = [
            [/\b(?:ở|tại|trong|trên|quan sát|hãy nhìn vào)\s+(?:bản trình chiếu|trang chiếu|slide)\s*(?:này|ở đây)?\b/gi, 'ở đây'],
            [/\b(?:infographic|lưu\s+đồ|hình\s+ảnh)\s+trên\s+slide\b/gi, 'sơ đồ minh họa'],
            [/\b(?:quan\s+sát\s+)?infographic\s+(?:ở\s+đây|này)?\b/gi, 'sơ đồ này'],
            [/\btrên\s+slide\b/gi, 'ở đây'],
            [/\bslide\s+này\b/gi, 'phần này'],
            [/\bslide\s+tiếp\s+theo\b/gi, 'bước tiếp theo'],
            [/\bslide\s+trước\b/gi, 'phần trước'],
            [/\bcác\s+bạn\s+hãy\s+quan\s+sát\b/gi, 'quan sát'],
            [/\bcác\s+bạn\s+hãy\s+nhìn\s+vào\b/gi, 'nhìn vào'],
            [/\bcác\s+bạn\s+hãy\s+chú\s+ý\b/gi, 'hãy chú ý'],
            [/\bcác\s+bạn\s+hãy\b/gi, 'hãy'],
            [/\b(?:hãy\s+cùng\s+(?:tôi|chúng\s+ta)\s+khám\s+phá|bước\s+vào\s+hành\s+trình\s+khám\s+phá)\b/gi, 'bây giờ chúng ta sẽ tìm hiểu'],
            [/\b(?:cung\s+cấp\s+(?:một\s+)?cái\s+nhìn\s+sâu\s+sắc|mang\s+lại\s+cái\s+nhìn\s+toàn\s+diện)\b/gi, 'giúp chúng ta hiểu rõ'],
            [/\b(?:chiếc\s+)?chìa\s+khóa\s+vàng\b/gi, 'yếu tố then chốt'],
            [/\b(?:vũ\s+khí\s+đắc\s+lực|công\s+cụ\s+vạn\s+năng)\b/gi, 'công cụ hiệu quả'],
            [/\b(?:bức\s+tranh\s+toàn\s+cảnh|bức\s+tranh\s+tổng\s+thể)\b/gi, 'tổng quan toàn bộ'],
            [/\b(?:đóng\s+vai\s+trò\s+(?:vô\s+cùng|hết\s+sức|cực\s+kỳ)\s+(?:quan\s+trọng|then\s+chốt|quan\s+yếu))\b/gi, 'rất quan trọng'],
            [/\b(?:không\s+chỉ\s+dừng\s+lại\s+ở\s+đó|chưa\s+dừng\s+lại\s+ở\s+đó)[,\s]*/gi, 'Bên cạnh đó, '],
            [/\b(?:mở\s+ra\s+(?:một\s+)?cánh\s+cửa|mở\s+ra\s+chân\s+trời\s+mới)\b/gi, 'tạo điều kiện'],
            [/\b(?:vô\s+cùng\s+thú\s+vị|hết\s+sức\s+tuyệt\s+vời|đầy\s+hứa\s+hẹn)\b/gi, 'đáng chú ý'],
            [/\b(?:như\s+chúng\s+ta\s+đã\s+biết|như\s+ai\s+cũng\s+biết)[,\s]*/gi, ''],
            [/\b(?:trải\s+nghiệm\s+tuyệt\s+vời|sức\s+mạnh\s+kỳ\s+diệu)\b/gi, 'hiệu quả thực tế'],
            [/\b(?:kinh\s+điển)\b/gi, 'thường gặp'],
            [/\b(?:chí\s+mạng)\b/gi, 'lớn'],
            [/\b(?:vô\s+cùng|hết\s+sức|cực\s+kỳ)\s+/gi, ''],
        ];

        for (const [pattern, replacement] of replacements) {
            cleaned = cleaned.replace(pattern, replacement);
        }

        cleaned = this.deduplicatePronouns(cleaned);
        cleaned = cleaned
            .replace(/[*#_~`]/g, '')
            .replace(/\[\s*slide\s*\d+\s*\]/gi, '')
            .replace(/\s{2,}/g, ' ')
            .trim();

        return cleaned;
    }

    private deduplicatePronouns(text: string): string {
        if (!text) return '';
        let count = 0;
        return text.replace(/\b([Cc]ác\s+bạn)\b/g, (match) => {
            count++;
            if (count === 1) return match;
            const isCapital = match[0] === 'C';
            return isCapital ? 'Chúng ta' : 'chúng ta';
        });
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
                // Set default design instruct if mode is 'design' and no instruct provided
                if (options?.vittsMode === 'design' && !options?.vittsDesignInstruct) {
                    try {
                        const adminInstruct = await this.prisma.systemConfig.findUnique({ where: { key: 'vitts.designInstruct' } });
                        options = { ...options, vittsDesignInstruct: adminInstruct?.value || 'female, young adult' };
                    } catch {
                        options = { ...options, vittsDesignInstruct: 'female, young adult' };
                    }
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

    // ========== 6B. GENERATE ALL AUDIO (BACKGROUND JOB) ==========

    async generateAllAudioBackground(jobId: string, sessionId: string, userId: string, options?: TTSOptions) {
        const slides = await this.getSlides(sessionId);
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
            select: { language: true },
        });
        if (!session) throw new NotFoundException(`Session ${sessionId} not found`);

        const toGenerate = slides.filter(slide => {
            const noteText = session.language === 'en' ? slide.noteEN : slide.noteVN;
            return noteText?.trim() && slide.audioStatus !== 'done';
        });

        const total = toGenerate.length;
        if (total === 0) {
            await this.jobService.completeJob(jobId, { completedCount: 0, total: 0 });
            return;
        }

        let completedCount = 0;
        let isFirst = true;

        for (const slide of toGenerate) {
            // Check cancellation
            if (await this.jobService.isJobCancelled(jobId)) {
                this.logger.log(`[generateAllAudioBackground] Job ${jobId} was cancelled by user.`);
                break;
            }

            const pct = Math.round((completedCount / total) * 100);
            await this.jobService.updateProgress(
                jobId,
                pct,
                `Đang tạo audio cho slide ${slide.index + 1} (${completedCount + 1}/${total})...`,
            );

            try {
                await this.generateAudio(sessionId, slide.index, userId, options);
                completedCount++;
            } catch (error: any) {
                this.logger.error(`Failed to generate audio for slide ${slide.index}: ${error.message}`);
            }

            // Delay between TTS requests to avoid rate limit
            const delayMs = isFirst ? 5000 : 2000;
            isFirst = false;
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }

        const isCancelled = await this.jobService.isJobCancelled(jobId);
        if (!isCancelled) {
            await this.prisma.pptxAudioSession.update({
                where: { id: sessionId },
                data: { status: 'audio_done' },
            });
            await this.jobService.completeJob(jobId, { completedCount, total });
        }
    }

    // ========== 6C. QUESTION BACKGROUND WORKERS ==========

    async generateReviewQuestionsBackground(
        jobId: string,
        sessionId: string,
        userId: string,
        counts: { level1Count?: number; level2Count?: number; level3Count?: number },
        isAppend = false,
    ) {
        await this.jobService.updateProgress(jobId, 10, 'Đang phân tích slide và chuẩn bị tạo câu hỏi ôn tập...');
        const result = await this.generateReviewQuestions(sessionId, userId, counts, isAppend);
        await this.jobService.completeJob(jobId, result);
        return result;
    }

    async generateInteractiveQuestionsBackground(
        jobId: string,
        sessionId: string,
        userId: string,
        count: number,
        isAppend = false,
    ) {
        await this.jobService.updateProgress(jobId, 10, 'Đang phân tích slide và chuẩn bị tạo câu hỏi tương tác...');
        const result = await this.generateInteractiveQuestions(sessionId, userId, count, isAppend);
        await this.jobService.completeJob(jobId, result);
        return result;
    }

    async generateEnglishQuestionsBackground(
        jobId: string,
        sessionId: string,
        userId: string,
        options: {
            level1?: number;
            level2?: number;
            level3?: number;
            questionTypes?: string[];
            subDiscipline?: string;
        },
        isAppend = false,
    ) {
        await this.jobService.updateProgress(jobId, 10, 'Đang phân tích slide và chuẩn bị tạo câu hỏi tiếng Anh...');
        const result = await this.generateEnglishQuestions(sessionId, userId, options, isAppend);
        await this.jobService.completeJob(jobId, result);
        return result;
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

    // ========== 9. QUESTION MANAGEMENT (REVIEW, INTERACTIVE, ENGLISH) ==========

    async getSessionQuestions(sessionId: string): Promise<{ review: any[]; interactive: any[]; english: any[] }> {
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
            select: { questionsJson: true },
        });
        if (!session || !session.questionsJson) {
            return { review: [], interactive: [], english: [] };
        }
        try {
            const parsed = JSON.parse(session.questionsJson);
            if (Array.isArray(parsed)) {
                return { review: parsed, interactive: [], english: [] };
            }
            return {
                review: Array.isArray(parsed.review) ? parsed.review : [],
                interactive: Array.isArray(parsed.interactive) ? parsed.interactive : [],
                english: Array.isArray(parsed.english) ? parsed.english : [],
            };
        } catch {
            return { review: [], interactive: [], english: [] };
        }
    }

    async saveSessionQuestions(
        sessionId: string,
        questions: { review?: any[]; interactive?: any[]; english?: any[] },
    ) {
        const current = await this.getSessionQuestions(sessionId);
        const updated = {
            review: questions.review !== undefined ? questions.review : current.review,
            interactive: questions.interactive !== undefined ? questions.interactive : current.interactive,
            english: questions.english !== undefined ? questions.english : current.english,
        };
        await this.prisma.pptxAudioSession.update({
            where: { id: sessionId },
            data: {
                questionsJson: JSON.stringify(updated),
            },
        });
        return updated;
    }

    private async getSessionContentText(sessionId: string): Promise<string> {
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
        });
        if (!session) throw new NotFoundException(`Session ${sessionId} not found`);

        const content = session.contentJson ? JSON.parse(session.contentJson) : [];
        const slides = session.slidesJson ? JSON.parse(session.slidesJson) : [];

        if (content.length > 0) {
            return content.map((s: any, idx: number) => {
                const slideNote = slides[idx]?.noteFull || slides[idx]?.noteVN || slides[idx]?.noteEN || '';
                return `Slide ${s.index + 1}: ${s.title || ''}\nNội dung:\n${(s.content || []).join('\n')}${slideNote ? `\nSpeaker note:\n${slideNote}` : ''}`;
            }).join('\n\n---\n\n');
        }

        if (slides.length > 0) {
            return slides.map((s: any) =>
                `Slide ${s.index + 1}: ${s.title || ''}\nSpeaker note:\n${s.noteFull || s.noteVN || s.noteEN || ''}`
            ).join('\n\n---\n\n');
        }

        throw new BadRequestException('Không tìm thấy nội dung bài giảng để tạo câu hỏi.');
    }

    // ─────────────────────────────────────────────────────────────
    // 9A. REVIEW QUESTIONS (BLOOM TAXONOMY)
    // ─────────────────────────────────────────────────────────────

    async generateReviewQuestions(
        sessionId: string,
        userId: string,
        counts: { level1Count?: number; level2Count?: number; level3Count?: number },
        isAppend = false,
    ) {
        const contentText = await this.getSessionContentText(sessionId);
        const modelConfig = await this.modelConfigService.getModelForTask(userId, 'QUESTIONS');

        const level1 = counts.level1Count ?? 20;
        const level2 = counts.level2Count ?? 20;
        const level3 = counts.level3Count ?? 10;

        const prompt = `Bạn là giảng viên đại học. Hãy tạo bộ câu hỏi trắc nghiệm ôn tập (Bloom Taxonomy) từ nội dung bài giảng sau.

NỘI DUNG BÀI GIẢNG:
${contentText}

YÊU CẦU:
- Tạo ${level1} câu hỏi mức 1 (Biết/Remember - Kiến thức cơ bản, định nghĩa)
- Tạo ${level2} câu hỏi mức 2 (Hiểu/Understand - Phân tích, so sánh, bản chất)
- Tạo ${level3} câu hỏi mức 3 (Vận dụng/Apply - Tình huống, ứng dụng thực tế)
- Mỗi câu có 4 đáp án A, B, C, D
- Đáp án A LUÔN là đáp án đúng
- Có giải thích rõ ràng vì sao A đúng
- Đánh số mã câu hỏi theo format: B1-1-01, B1-2-01, v.v.

Trả lời CHỈ bằng JSON hợp lệ:
\`\`\`json
{
  "questions": [
    {
      "id": "REV-${Date.now()}-1",
      "questionId": "B1-1-01",
      "level": 1,
      "question": "Nội dung câu hỏi?",
      "correctAnswer": "Đáp án đúng A",
      "optionB": "Đáp án sai B",
      "optionC": "Đáp án sai C",
      "optionD": "Đáp án sai D",
      "explanation": "Giải thích vì sao A đúng"
    }
  ]
}
\`\`\``;

        const modelName = modelConfig.modelName || 'gemini-2.0-flash';
        this.logger.log(`[PptxAudioTool] Generating review questions with model: ${modelName}`);
        const aiResult = await this.aiProvider.generateText(prompt, modelName, userId, { maxTokens: 32768 });
        const responseText = aiResult.content;

        if (!responseText) {
            throw new BadRequestException('AI returned empty response. Please try again.');
        }

        let newQuestions: any[] = [];
        try {
            const cleaned = this.cleanJsonResponse(responseText);
            const parsed = JSON.parse(cleaned);
            newQuestions = parsed.questions || parsed;
        } catch (err) {
            this.logger.error(`Failed to parse review questions JSON: ${err.message}`);
            throw new BadRequestException('AI response was not valid JSON.');
        }

        if (!Array.isArray(newQuestions) || newQuestions.length === 0) {
            throw new BadRequestException('AI generated 0 questions. Please try again.');
        }

        // Normalize ids
        const formatted = newQuestions.map((q, idx) => ({
            id: q.id || `REV-${Date.now()}-${idx + 1}`,
            questionId: q.questionId || `B1-${q.level || 1}-${String(idx + 1).padStart(2, '0')}`,
            level: Number(q.level) || 1,
            question: q.question || '',
            correctAnswer: q.correctAnswer || '',
            optionB: q.optionB || '',
            optionC: q.optionC || '',
            optionD: q.optionD || '',
            explanation: q.explanation || '',
        }));

        const current = await this.getSessionQuestions(sessionId);
        const finalReview = isAppend ? [...current.review, ...formatted] : formatted;
        await this.saveSessionQuestions(sessionId, { review: finalReview });

        return {
            questions: finalReview,
            addedCount: formatted.length,
            totalCount: finalReview.length,
            counts: {
                level1: finalReview.filter((q: any) => q.level === 1).length,
                level2: finalReview.filter((q: any) => q.level === 2).length,
                level3: finalReview.filter((q: any) => q.level === 3).length,
            },
        };
    }

    async exportReviewQuestionsExcel(sessionId: string, res: Response) {
        const questions = (await this.getSessionQuestions(sessionId)).review;
        const session = await this.prisma.pptxAudioSession.findUnique({ where: { id: sessionId } });

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Câu hỏi ôn tập');

        worksheet.columns = [
            { header: 'STT', key: 'stt', width: 6 },
            { header: 'Mã câu', key: 'questionId', width: 14 },
            { header: 'Mức độ', key: 'level', width: 12 },
            { header: 'Câu hỏi', key: 'question', width: 50 },
            { header: 'A (Đáp án đúng)', key: 'correctAnswer', width: 30 },
            { header: 'Phương án B', key: 'optionB', width: 30 },
            { header: 'Phương án C', key: 'optionC', width: 30 },
            { header: 'Phương án D', key: 'optionD', width: 30 },
            { header: 'Giải thích chi tiết', key: 'explanation', width: 45 },
        ];

        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4472C4' },
        };

        questions.forEach((q: any, i: number) => {
            worksheet.addRow({
                stt: i + 1,
                questionId: q.questionId || `Q${i + 1}`,
                level: q.level === 1 ? 'Mức 1 (Biết)' : q.level === 2 ? 'Mức 2 (Hiểu)' : 'Mức 3 (Vận dụng)',
                question: q.question,
                correctAnswer: q.correctAnswer,
                optionB: q.optionB,
                optionC: q.optionC,
                optionD: q.optionD,
                explanation: q.explanation || '',
            });
        });

        const filename = `${session?.fileName?.replace('.pptx', '') || 'pptx'}_review_questions.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        await workbook.xlsx.write(res);
        res.end();
    }

    async exportReviewQuestionsWord(sessionId: string, res: Response) {
        const questions = (await this.getSessionQuestions(sessionId)).review;
        const session = await this.prisma.pptxAudioSession.findUnique({ where: { id: sessionId } });
        const docTitle = `NGÂN HÀNG CÂU HỎI ÔN TẬP - ${session?.fileName?.replace('.pptx', '') || 'BÀI GIẢNG'}`;

        const docChildren: (Paragraph | Table)[] = [];

        // Title
        docChildren.push(
            new Paragraph({
                text: docTitle,
                heading: HeadingLevel.HEADING_1,
                alignment: AlignmentType.CENTER,
                spacing: { after: 200 },
            }),
            new Paragraph({
                children: [
                    new TextRun({ text: `Tổng số câu hỏi: ${questions.length} câu`, bold: true }),
                    new TextRun(` (Biết: ${questions.filter(q => q.level === 1).length}, Hiểu: ${questions.filter(q => q.level === 2).length}, Vận dụng: ${questions.filter(q => q.level === 3).length})`),
                ],
                alignment: AlignmentType.CENTER,
                spacing: { after: 400 },
            }),
            new Paragraph({
                text: 'I. NỘI DUNG ĐỀ THI / CÂU HỎI',
                heading: HeadingLevel.HEADING_2,
                spacing: { before: 200, after: 200 },
            }),
        );

        // Questions block
        questions.forEach((q: any, i: number) => {
            const levelLabel = q.level === 1 ? 'Mức 1 - Biết' : q.level === 2 ? 'Mức 2 - Hiểu' : 'Mức 3 - Vận dụng';
            docChildren.push(
                new Paragraph({
                    children: [
                        new TextRun({ text: `Câu ${i + 1} (${q.questionId || 'ID'}` }),
                        new TextRun({ text: ` - ${levelLabel}): `, italics: true }),
                        new TextRun({ text: q.question, bold: true }),
                    ],
                    spacing: { before: 150, after: 100 },
                }),
                new Paragraph({ children: [new TextRun({ text: `A. ${q.correctAnswer}` })], spacing: { after: 50 }, indent: { left: 400 } }),
                new Paragraph({ children: [new TextRun({ text: `B. ${q.optionB}` })], spacing: { after: 50 }, indent: { left: 400 } }),
                new Paragraph({ children: [new TextRun({ text: `C. ${q.optionC}` })], spacing: { after: 50 }, indent: { left: 400 } }),
                new Paragraph({ children: [new TextRun({ text: `D. ${q.optionD}` })], spacing: { after: 150 }, indent: { left: 400 } }),
            );
        });

        // Answer Key & Explanation Table
        docChildren.push(
            new Paragraph({
                text: 'II. BẢNG ĐÁP ÁN VÀ HƯỚNG DẪN GIẢI CHI TIẾT',
                heading: HeadingLevel.HEADING_2,
                spacing: { before: 400, after: 200 },
            }),
        );

        const tableRows: TableRow[] = [
            new TableRow({
                children: [
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Câu', bold: true })], alignment: AlignmentType.CENTER })], width: { size: 10, type: WidthType.PERCENTAGE } }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Mức độ', bold: true })], alignment: AlignmentType.CENTER })], width: { size: 18, type: WidthType.PERCENTAGE } }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Đáp án đúng', bold: true })] })], width: { size: 27, type: WidthType.PERCENTAGE } }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Giải thích chi tiết', bold: true })] })], width: { size: 45, type: WidthType.PERCENTAGE } }),
                ],
            }),
            ...questions.map((q: any, i: number) =>
                new TableRow({
                    children: [
                        new TableCell({ children: [new Paragraph({ text: `${i + 1}`, alignment: AlignmentType.CENTER })] }),
                        new TableCell({ children: [new Paragraph({ text: q.level === 1 ? 'Biết' : q.level === 2 ? 'Hiểu' : 'Vận dụng' })] }),
                        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `A. ${q.correctAnswer}`, bold: true })] })] }),
                        new TableCell({ children: [new Paragraph({ text: q.explanation || '-' })] }),
                    ],
                }),
            ),
        ];

        docChildren.push(
            new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                rows: tableRows,
            }),
        );

        const doc = new Document({
            sections: [{ properties: {}, children: docChildren }],
        });

        const buffer = await Packer.toBuffer(doc);
        const filename = `${session?.fileName?.replace('.pptx', '') || 'pptx'}_review_questions.docx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        res.send(buffer);
    }

    async exportReviewQuestionsMoodleXml(sessionId: string, res: Response) {
        const questions = (await this.getSessionQuestions(sessionId)).review;
        const session = await this.prisma.pptxAudioSession.findUnique({ where: { id: sessionId } });

        const mapped: ReviewQuestionData[] = questions.map((q: any, i: number) => ({
            questionId: q.questionId || `Q${i + 1}`,
            level: Number(q.level) || 1,
            question: q.question,
            correctAnswer: q.correctAnswer,
            optionB: q.optionB,
            optionC: q.optionC,
            optionD: q.optionD,
            explanation: q.explanation || null,
        }));

        const xml = buildMoodleXml(mapped, session?.fileName?.replace('.pptx', '') || 'pptx_lesson');
        const filename = `${session?.fileName?.replace('.pptx', '') || 'pptx'}_review_moodle.xml`;
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        res.send(xml);
    }

    async downloadReviewTemplate(res: Response) {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Câu hỏi ôn tập');

        worksheet.columns = [
            { header: 'Level', key: 'level', width: 10 },
            { header: 'Question', key: 'question', width: 50 },
            { header: 'Correct Answer (A)', key: 'correctAnswer', width: 30 },
            { header: 'Option B', key: 'optionB', width: 30 },
            { header: 'Option C', key: 'optionC', width: 30 },
            { header: 'Option D', key: 'optionD', width: 30 },
            { header: 'Explanation', key: 'explanation', width: 40 },
        ];

        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4472C4' },
        };
        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

        worksheet.addRow({
            level: 1,
            question: 'Thủ đô của Việt Nam là thành phố nào?',
            correctAnswer: 'Hà Nội',
            optionB: 'TP. Hồ Chí Minh',
            optionC: 'Đà Nẵng',
            optionD: 'Hải Phòng',
            explanation: 'Hà Nội là thủ đô của Việt Nam.',
        });
        worksheet.addRow({
            level: 2,
            question: 'Vì sao nước biển có vị mặn?',
            correctAnswer: 'Do hòa tan muối khoáng từ đất đá',
            optionB: 'Do cá thải ra muối',
            optionC: 'Do ánh nắng mặt trời',
            optionD: 'Do gió biển',
            explanation: 'Nước mưa bào mòn đất đá cuốn muối khoáng ra biển.',
        });

        const guide = workbook.addWorksheet('Hướng dẫn');
        guide.columns = [{ width: 90 }];
        const guideLines = [
            'HƯỚNG DẪN ĐIỀN FILE CÂU HỎI ÔN TẬP',
            '',
            '1. Điền câu hỏi ở sheet "Câu hỏi ôn tập".',
            '2. Cột Level: 1 = Biết, 2 = Hiểu, 3 = Vận dụng.',
            '3. Cột "Correct Answer (A)" LUÔN là đáp án đúng.',
            '4. Các cột Option B, C, D là các phương án gây nhiễu.',
            '5. Cột Explanation là giải thích vì sao A đúng.',
        ];
        guideLines.forEach(l => guide.addRow([l]));
        guide.getRow(1).font = { bold: true, size: 14 };

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent('mau_cau_hoi_on_tap.xlsx')}"`);
        await workbook.xlsx.write(res);
        res.end();
    }

    async importReviewQuestionsExcel(sessionId: string, file: Express.Multer.File) {
        if (!file) throw new BadRequestException('Vui lòng chọn file Excel.');
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(file.buffer as any);
        const worksheet = workbook.worksheets[0];
        if (!worksheet) throw new BadRequestException('File Excel không có sheet dữ liệu.');

        const imported: any[] = [];
        for (let r = 2; r <= worksheet.rowCount; r++) {
            const row = worksheet.getRow(r);
            const levelVal = parseInt(String(row.getCell(1).value || '1')) || 1;
            const question = String(row.getCell(2).value || '').trim();
            const correctAnswer = String(row.getCell(3).value || '').trim();
            const optionB = String(row.getCell(4).value || '').trim();
            const optionC = String(row.getCell(5).value || '').trim();
            const optionD = String(row.getCell(6).value || '').trim();
            const explanation = String(row.getCell(7).value || '').trim();

            if (!question || !correctAnswer || !optionB) continue;

            imported.push({
                id: `REV-${Date.now()}-${r}`,
                questionId: `B1-${levelVal}-${String(imported.length + 1).padStart(2, '0')}`,
                level: levelVal,
                question,
                correctAnswer,
                optionB,
                optionC: optionC || '-',
                optionD: optionD || '-',
                explanation,
            });
        }

        const current = await this.getSessionQuestions(sessionId);
        const merged = [...current.review, ...imported];
        await this.saveSessionQuestions(sessionId, { review: merged });

        return {
            imported: imported.length,
            total: merged.length,
        };
    }

    // ─────────────────────────────────────────────────────────────
    // 9B. INTERACTIVE QUESTIONS (MC / MR)
    // ─────────────────────────────────────────────────────────────

    async generateInteractiveQuestions(
        sessionId: string,
        userId: string,
        count = 5,
        isAppend = false,
    ) {
        const contentText = await this.getSessionContentText(sessionId);
        const modelConfig = await this.modelConfigService.getModelForTask(userId, 'QUESTIONS');

        const prompt = `Bạn là chuyên gia thiết kế câu hỏi tương tác kiểm tra độ tập trung của người học (E-Learning Interactive Questions).
Hãy tạo ${count} câu hỏi tương tác từ nội dung bài giảng sau:

NỘI DUNG BÀI GIẢNG:
${contentText}

YÊU CẦU:
- Gồm câu hỏi Multiple Choice (MC: 1 đáp án đúng) và Multiple Response (MR: nhiều đáp án đúng)
- Phương án đúng PHẢI có dấu hoa thị (*) ở đầu (ví dụ: "*Đáp án đúng", "Đáp án sai")
- Có phản hồi khi trả lời đúng (correctFeedback) và phản hồi khi trả lời sai (incorrectFeedback)
- Điểm mặc định mỗi câu: 1

Trả lời CHỈ bằng JSON hợp lệ:
\`\`\`json
{
  "questions": [
    {
      "id": "INT-${Date.now()}-1",
      "questionOrder": 1,
      "questionType": "MC",
      "questionText": "Câu hỏi tương tác?",
      "answers": ["*Đáp án đúng 1", "Đáp án sai 2", "Đáp án sai 3", "Đáp án sai 4"],
      "correctFeedback": "Chính xác! Bạn đã nắm vững nội dung.",
      "incorrectFeedback": "Chưa chính xác. Vui lòng xem lại slide trước.",
      "points": 1
    }
  ]
}
\`\`\``;

        const modelName = modelConfig.modelName || 'gemini-2.0-flash';
        this.logger.log(`[PptxAudioTool] Generating interactive questions with model: ${modelName}`);
        const aiResult = await this.aiProvider.generateText(prompt, modelName, userId, { maxTokens: 16384 });
        const responseText = aiResult.content;

        if (!responseText) throw new BadRequestException('AI returned empty response.');

        let newQuestions: any[] = [];
        try {
            const cleaned = this.cleanJsonResponse(responseText);
            const parsed = JSON.parse(cleaned);
            newQuestions = parsed.questions || parsed;
        } catch (err) {
            throw new BadRequestException('AI response was not valid JSON.');
        }

        const formatted = newQuestions.map((q, idx) => ({
            id: q.id || `INT-${Date.now()}-${idx + 1}`,
            questionOrder: idx + 1,
            questionType: q.questionType || 'MC',
            questionText: q.questionText || '',
            answers: Array.isArray(q.answers) ? q.answers : [],
            correctFeedback: q.correctFeedback || 'Chính xác!',
            incorrectFeedback: q.incorrectFeedback || 'Chưa đúng, hãy xem lại.',
            points: Number(q.points) || 1,
        }));

        const current = await this.getSessionQuestions(sessionId);
        const finalInteractive = isAppend ? [...current.interactive, ...formatted] : formatted;
        await this.saveSessionQuestions(sessionId, { interactive: finalInteractive });

        return {
            questions: finalInteractive,
            addedCount: formatted.length,
            totalCount: finalInteractive.length,
        };
    }

    async exportInteractiveQuestionsExcel(sessionId: string, res: Response) {
        const questions = (await this.getSessionQuestions(sessionId)).interactive;
        const session = await this.prisma.pptxAudioSession.findUnique({ where: { id: sessionId } });

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Câu hỏi tương tác');

        worksheet.columns = [
            { header: 'STT', key: 'stt', width: 6 },
            { header: 'Loại câu', key: 'questionType', width: 12 },
            { header: 'Nội dung câu hỏi', key: 'questionText', width: 50 },
            { header: 'Đáp án 1', key: 'ans1', width: 25 },
            { header: 'Đáp án 2', key: 'ans2', width: 25 },
            { header: 'Đáp án 3', key: 'ans3', width: 25 },
            { header: 'Đáp án 4', key: 'ans4', width: 25 },
            { header: 'Phản hồi đúng', key: 'correctFeedback', width: 35 },
            { header: 'Phản hồi sai', key: 'incorrectFeedback', width: 35 },
            { header: 'Điểm', key: 'points', width: 8 },
        ];

        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF70AD47' },
        };

        questions.forEach((q: any, i: number) => {
            const ans = q.answers || [];
            worksheet.addRow({
                stt: i + 1,
                questionType: q.questionType,
                questionText: q.questionText,
                ans1: ans[0] || '',
                ans2: ans[1] || '',
                ans3: ans[2] || '',
                ans4: ans[3] || '',
                correctFeedback: q.correctFeedback,
                incorrectFeedback: q.incorrectFeedback,
                points: q.points || 1,
            });
        });

        const filename = `${session?.fileName?.replace('.pptx', '') || 'pptx'}_interactive_questions.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        await workbook.xlsx.write(res);
        res.end();
    }

    async exportInteractiveQuestionsWord(sessionId: string, res: Response) {
        const questions = (await this.getSessionQuestions(sessionId)).interactive;
        const session = await this.prisma.pptxAudioSession.findUnique({ where: { id: sessionId } });
        const docTitle = `BỘ CÂU HỎI TƯƠNG TÁC (INTERACTIVE) - ${session?.fileName?.replace('.pptx', '') || 'BÀI GIẢNG'}`;

        const docChildren: (Paragraph | Table)[] = [
            new Paragraph({
                text: docTitle,
                heading: HeadingLevel.HEADING_1,
                alignment: AlignmentType.CENTER,
                spacing: { after: 200 },
            }),
            new Paragraph({
                children: [new TextRun({ text: `Tổng số: ${questions.length} câu hỏi tương tác`, bold: true })],
                alignment: AlignmentType.CENTER,
                spacing: { after: 400 },
            }),
        ];

        questions.forEach((q: any, i: number) => {
            docChildren.push(
                new Paragraph({
                    children: [
                        new TextRun({ text: `Câu ${i + 1} [${q.questionType} - ${q.points}đ]: `, bold: true, color: '2E7D32' }),
                        new TextRun({ text: q.questionText, bold: true }),
                    ],
                    spacing: { before: 150, after: 100 },
                }),
            );

            (q.answers || []).forEach((ans: string) => {
                const isCorrect = ans.startsWith('*');
                const cleanText = ans.replace(/^\*/, '');
                docChildren.push(
                    new Paragraph({
                        children: [
                            new TextRun({ text: isCorrect ? '☑ ' : '☐ ', bold: isCorrect, color: isCorrect ? '2E7D32' : '000000' }),
                            new TextRun({ text: cleanText, bold: isCorrect }),
                            isCorrect ? new TextRun({ text: ' (Đáp án đúng)', italics: true, color: '2E7D32' }) : new TextRun(''),
                        ],
                        indent: { left: 400 },
                        spacing: { after: 40 },
                    }),
                );
            });

            docChildren.push(
                new Paragraph({
                    children: [
                        new TextRun({ text: `✓ Phản hồi đúng: `, bold: true }),
                        new TextRun(q.correctFeedback || '-'),
                        new TextRun({ text: ` | ✗ Phản hồi sai: `, bold: true }),
                        new TextRun(q.incorrectFeedback || '-'),
                    ],
                    indent: { left: 400 },
                    spacing: { before: 60, after: 150 },
                }),
            );
        });

        const doc = new Document({ sections: [{ properties: {}, children: docChildren }] });
        const buffer = await Packer.toBuffer(doc);
        const filename = `${session?.fileName?.replace('.pptx', '') || 'pptx'}_interactive_questions.docx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        res.send(buffer);
    }

    // ─────────────────────────────────────────────────────────────
    // 9C. ENGLISH QUESTIONS (7 SPECIALIZED TYPES)
    // ─────────────────────────────────────────────────────────────

    async generateEnglishQuestions(
        sessionId: string,
        userId: string,
        dto: {
            level1?: number;
            level2?: number;
            level3?: number;
            questionTypes?: string[];
            subDiscipline?: string;
        },
        isAppend = false,
    ) {
        const contentText = await this.getSessionContentText(sessionId);
        const modelConfig = await this.modelConfigService.getModelForTask(userId, 'QUESTIONS');

        const level1 = dto.level1 ?? 20;
        const level2 = dto.level2 ?? 20;
        const level3 = dto.level3 ?? 10;
        const total = level1 + level2 + level3;
        const types = dto.questionTypes && dto.questionTypes.length > 0
            ? dto.questionTypes.join(', ')
            : 'MC, MR, MATCH, CLOZE, SHORTANSWER, TRUEFALSE, ESSAY';
        const subDiscipline = dto.subDiscipline || 'ALL';

        const prompt = `You are a Professor of English Linguistics and Higher Education Assessment.
Generate ${total} specialized English questions based on the lesson slides below.

LESSON CONTENT:
${contentText}

SPECIFICATIONS:
- Sub-Discipline: ${subDiscipline}
- Allowed Question Types: ${types}
- Bloom Distribution: Level 1 (Remember/Biết): ${level1}, Level 2 (Understand/Hiểu): ${level2}, Level 3 (Apply/Vận dụng): ${level3}

SUPPORTED TYPES & dataJson STRUCTURE:
1. "MC" (Multiple Choice - 1 correct):
   dataJson: {"options": [{"text": "Option A", "isCorrect": true}, {"text": "Option B", "isCorrect": false}, ...]}
2. "MR" (Multiple Response - multiple correct):
   dataJson: {"options": [{"text": "Option A", "isCorrect": true}, {"text": "Option B", "isCorrect": true}, ...]}
3. "MATCH" (Matching pairs):
   dataJson: {"pairs": [{"left": "Term 1", "right": "Definition 1"}, {"left": "Term 2", "right": "Definition 2"}]}
4. "CLOZE" (Moodle Embedded Cloze sentence):
   questionText: "Sentence with embedded Moodle Cloze like {1:SHORTANSWER:=word} or {1:MULTICHOICE:=correct~wrong}"
   dataJson: {"rawCloze": "..."}
5. "SHORTANSWER" (Fill-in word / IPA / phonetic form):
   dataJson: {"acceptedAnswers": ["word1", "word2"]}
6. "TRUEFALSE" (True/False):
   dataJson: {"isTrue": true}
7. "ESSAY" (Essay/Analytical question with rubric):
   dataJson: {"rubric": {"totalPoints": 10, "criteria": [{"criterion": "Accuracy", "points": 5}, {"criterion": "Depth", "points": 5}]}}

Return ONLY valid JSON format:
\`\`\`json
{
  "questions": [
    {
      "id": "ENG-${Date.now()}-1",
      "questionOrder": 1,
      "questionType": "MC",
      "subDiscipline": "${subDiscipline}",
      "difficulty": 1,
      "title": "ENG-01",
      "questionText": "Question text here?",
      "dataJson": "{\\"options\\": [{...}]}",
      "explanation": "Why this is correct",
      "points": 1
    }
  ]
}
\`\`\``;

        const modelName = modelConfig.modelName || 'gemini-2.0-flash';
        this.logger.log(`[PptxAudioTool] Generating English questions with model: ${modelName}`);
        const aiResult = await this.aiProvider.generateText(prompt, modelName, userId, { maxTokens: 32768 });
        const responseText = aiResult.content;

        if (!responseText) throw new BadRequestException('AI returned empty response.');

        let newQuestions: any[] = [];
        try {
            const cleaned = this.cleanJsonResponse(responseText);
            const parsed = JSON.parse(cleaned);
            newQuestions = parsed.questions || parsed;
        } catch (err) {
            throw new BadRequestException('AI response was not valid JSON.');
        }

        const formatted = newQuestions.map((q, idx) => ({
            id: q.id || `ENG-${Date.now()}-${idx + 1}`,
            questionOrder: idx + 1,
            questionType: (q.questionType || 'MC').toUpperCase(),
            subDiscipline: q.subDiscipline || subDiscipline,
            difficulty: Number(q.difficulty) || 1,
            title: q.title || `ENG-${String(idx + 1).padStart(2, '0')}`,
            questionText: q.questionText || '',
            dataJson: typeof q.dataJson === 'string' ? q.dataJson : JSON.stringify(q.dataJson || {}),
            explanation: q.explanation || '',
            points: Number(q.points) || 1,
        }));

        const current = await this.getSessionQuestions(sessionId);
        const finalEnglish = isAppend ? [...current.english, ...formatted] : formatted;
        await this.saveSessionQuestions(sessionId, { english: finalEnglish });

        return {
            questions: finalEnglish,
            addedCount: formatted.length,
            totalCount: finalEnglish.length,
        };
    }

    async exportEnglishQuestionsMoodleXml(sessionId: string, res: Response) {
        const questions = (await this.getSessionQuestions(sessionId)).english;
        const session = await this.prisma.pptxAudioSession.findUnique({ where: { id: sessionId } });

        const mapped: EnglishQuestionData[] = questions.map((q: any, i: number) => ({
            id: q.id || `ENG-${i + 1}`,
            questionOrder: i + 1,
            questionType: (q.questionType || 'MC').toUpperCase(),
            subDiscipline: q.subDiscipline || 'ALL',
            difficulty: Number(q.difficulty) || 1,
            title: q.title || `ENG-${i + 1}`,
            questionText: q.questionText,
            dataJson: q.dataJson,
            explanation: q.explanation || null,
            points: q.points || 1,
        }));

        const xml = buildEnglishMoodleXml(mapped, session?.fileName?.replace('.pptx', '') || 'pptx_english');
        const filename = `${session?.fileName?.replace('.pptx', '') || 'pptx'}_english_moodle.xml`;
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        res.send(xml);
    }

    async exportEnglishQuestionsExcel(sessionId: string, res: Response) {
        const questions = (await this.getSessionQuestions(sessionId)).english;
        const session = await this.prisma.pptxAudioSession.findUnique({ where: { id: sessionId } });

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('English Questions');

        worksheet.columns = [
            { header: 'Order', key: 'order', width: 6 },
            { header: 'Type', key: 'type', width: 12 },
            { header: 'Discipline', key: 'discipline', width: 18 },
            { header: 'Level', key: 'level', width: 8 },
            { header: 'Question Text', key: 'questionText', width: 50 },
            { header: 'Structure (JSON)', key: 'dataJson', width: 40 },
            { header: 'Explanation', key: 'explanation', width: 35 },
            { header: 'Points', key: 'points', width: 8 },
        ];

        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF800080' },
        };

        questions.forEach((q: any, i: number) => {
            worksheet.addRow({
                order: i + 1,
                type: q.questionType,
                discipline: q.subDiscipline,
                level: q.difficulty,
                questionText: q.questionText,
                dataJson: q.dataJson,
                explanation: q.explanation || '',
                points: q.points || 1,
            });
        });

        const filename = `${session?.fileName?.replace('.pptx', '') || 'pptx'}_english_questions.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        await workbook.xlsx.write(res);
        res.end();
    }

    async exportEnglishQuestionsWord(sessionId: string, res: Response) {
        const questions = (await this.getSessionQuestions(sessionId)).english;
        const session = await this.prisma.pptxAudioSession.findUnique({ where: { id: sessionId } });
        const docTitle = `BỘ CÂU HỎI TIẾNG ANH CHUYÊN NGÀNH - ${session?.fileName?.replace('.pptx', '') || 'BÀI GIẢNG'}`;

        const docChildren: (Paragraph | Table)[] = [
            new Paragraph({
                text: docTitle,
                heading: HeadingLevel.HEADING_1,
                alignment: AlignmentType.CENTER,
                spacing: { after: 200 },
            }),
            new Paragraph({
                children: [new TextRun({ text: `Tổng số: ${questions.length} câu hỏi`, bold: true })],
                alignment: AlignmentType.CENTER,
                spacing: { after: 400 },
            }),
        ];

        questions.forEach((q: any, i: number) => {
            docChildren.push(
                new Paragraph({
                    children: [
                        new TextRun({ text: `Item ${i + 1} [${q.questionType} - Level ${q.difficulty}]: `, bold: true, color: '6A1B9A' }),
                        new TextRun({ text: q.questionText, bold: true }),
                    ],
                    spacing: { before: 150, after: 100 },
                }),
            );

            // Display details according to dataJson
            try {
                const data = typeof q.dataJson === 'string' ? JSON.parse(q.dataJson) : q.dataJson;
                if (data.options && Array.isArray(data.options)) {
                    data.options.forEach((opt: any, optIdx: number) => {
                        const letter = String.fromCharCode(65 + optIdx);
                        docChildren.push(
                            new Paragraph({
                                children: [
                                    new TextRun({ text: `${letter}. ${opt.text || opt}` }),
                                    opt.isCorrect ? new TextRun({ text: ' (Correct)', italics: true, color: '2E7D32' }) : new TextRun(''),
                                ],
                                indent: { left: 400 },
                                spacing: { after: 40 },
                            }),
                        );
                    });
                } else if (data.pairs && Array.isArray(data.pairs)) {
                    data.pairs.forEach((p: any) => {
                        docChildren.push(
                            new Paragraph({
                                text: `• [${p.left}] ➔ [${p.right}]`,
                                indent: { left: 400 },
                                spacing: { after: 40 },
                            }),
                        );
                    });
                } else if (data.acceptedAnswers && Array.isArray(data.acceptedAnswers)) {
                    docChildren.push(
                        new Paragraph({
                            children: [new TextRun({ text: `Accepted: ${data.acceptedAnswers.join(', ')}`, italics: true })],
                            indent: { left: 400 },
                        }),
                    );
                }
            } catch {
                // Ignore parse errors in word preview
            }

            if (q.explanation) {
                docChildren.push(
                    new Paragraph({
                        children: [new TextRun({ text: `💡 Explanation: `, bold: true }), new TextRun(q.explanation)],
                        indent: { left: 400 },
                        spacing: { before: 60, after: 150 },
                    }),
                );
            }
        });

        const doc = new Document({ sections: [{ properties: {}, children: docChildren }] });
        const buffer = await Packer.toBuffer(doc);
        const filename = `${session?.fileName?.replace('.pptx', '') || 'pptx'}_english_questions.docx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        res.send(buffer);
    }

    // ─────────────────────────────────────────────────────────────
    // 9D. COMMON QUESTION CRUD METHODS
    // ─────────────────────────────────────────────────────────────

    async updateQuestion(sessionId: string, type: 'review' | 'interactive' | 'english', id: string, data: any) {
        const current = await this.getSessionQuestions(sessionId);
        const list = current[type] || [];
        const updatedList = list.map((item: any) => (item.id === id ? { ...item, ...data } : item));
        await this.saveSessionQuestions(sessionId, { [type]: updatedList });
        return { success: true, updatedList };
    }

    async deleteQuestion(sessionId: string, type: 'review' | 'interactive' | 'english', id: string) {
        const current = await this.getSessionQuestions(sessionId);
        const list = current[type] || [];
        const filtered = list.filter((item: any) => item.id !== id);
        await this.saveSessionQuestions(sessionId, { [type]: filtered });
        return { success: true, remainingCount: filtered.length };
    }

    async deleteAllQuestions(sessionId: string, type: 'review' | 'interactive' | 'english') {
        await this.saveSessionQuestions(sessionId, { [type]: [] });
        return { success: true };
    }

    async updateQuestionsList(sessionId: string, type: 'review' | 'interactive' | 'english', list: any[]) {
        await this.saveSessionQuestions(sessionId, { [type]: list });
        return { success: true, count: list.length };
    }

    // Backward-compatible wrappers for old endpoints
    async generateQuestions(sessionId: string, userId: string, counts: any) {
        const res = await this.generateReviewQuestions(sessionId, userId, counts, false);
        return { questions: res.questions, totalCount: res.totalCount, counts: res.counts };
    }

    async getQuestions(sessionId: string): Promise<any[]> {
        const all = await this.getSessionQuestions(sessionId);
        return all.review;
    }

    // ========== JSON PARSING UTILITIES ==========

    private cleanJsonResponse(response: string): string {
        let cleaned = response.trim();
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

