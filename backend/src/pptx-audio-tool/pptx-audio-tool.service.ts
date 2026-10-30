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
import { ImagenService, GeneratedImage } from '../ai/imagen.service';
import { GeminiService } from '../ai/gemini.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { GenerationJobService } from '../generation-job/generation-job.service';
import { APIService } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
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
    extractAndNormalizeLesson,
    ReviewQuestionData,
    EnglishQuestionData,
    stripOptionPrefix,
    cleanExplanation,
    isMatchingQuestionText,
    extractMatchPairs,
    escapeForCdata,
    escapeXmlText,
    upgradeClozeToMultichoice,
    normalizeInteractiveQuestions,
} from '../questions/moodle-xml.helper';
import { fixUtf8Filename } from '../common/string.util';
import { packageScormZip, resolveLocalMediaFile } from '../slides/scorm-export.helper';
import { packageH5pZip } from '../slides/h5p-export.helper';

const execFileAsync = promisify(execFile);

export interface ParsedSlide {
    index: number;
    originalSlideIndex?: number | null;
    slideType?: string;
    layoutType?: string;
    title: string;
    content: string[];
    optimizedContent?: Array<{ emoji: string; point: string; description: string }> | null;
    interactiveData?: string | null;
    noteFull: string;
    noteEN: string;
    noteVN: string;
    hasDual: boolean;
    imageUrl?: string | null;
    renderedSlideUrl?: string | null;
    hasCustomImage?: boolean;
    audioUrl: string | null;
    audioDuration: number | null;
    audioStatus: string; // pending | generating | done | error
    errorMessage: string | null;
    extraAudioUrl?: string | null;
    extraAudioName?: string | null;
    extraAudioDuration?: number | null;
}

export interface PptxSubjectDto {
    name: string;
    description?: string;
    major?: string;
    majorName?: string;
    expertiseArea?: string;
    courseName?: string;
    targetAudience?: string;
    institutionType?: string;
    language?: string;
    additionalContext?: string;
}

export interface SessionUploadMeta {
    pptxSubjectId?: string | null;
    lessonTitle?: string;
    contextText?: string;
    contextFileName?: string | null;
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
        private readonly imagenService: ImagenService,
        private readonly geminiService: GeminiService,
        private readonly apiKeysService: ApiKeysService,
        private readonly jobService: GenerationJobService,
    ) {
        this.pythonServiceUrl = process.env.PPTX_SERVICE_URL || 'http://localhost:3002';
        if (!fs.existsSync(this.uploadsDir)) {
            fs.mkdirSync(this.uploadsDir, { recursive: true });
        }
    }

    // ========== PPTX SUBJECT MANAGEMENT ==========

    async listSubjects(userId: string) {
        const subjects = await this.prisma.pptxSubject.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            include: {
                _count: {
                    select: { sessions: true },
                },
            },
        });
        return subjects.map(sub => ({
            ...sub,
            major: sub.majorName || sub.expertiseArea || null,
            sessionCount: sub._count?.sessions || 0,
        }));
    }

    async createSubject(userId: string, dto: PptxSubjectDto) {
        if (!dto?.name?.trim()) {
            throw new BadRequestException('Vui lòng nhập tên môn học.');
        }
        const majorVal = (dto.majorName ?? dto.major)?.trim() || null;
        const created = await this.prisma.pptxSubject.create({
            data: {
                userId,
                name: dto.name.trim(),
                description: dto.description?.trim() || null,
                majorName: majorVal,
                expertiseArea: dto.expertiseArea?.trim() || majorVal,
                courseName: dto.courseName?.trim() || dto.name.trim(),
                targetAudience: dto.targetAudience?.trim() || null,
                institutionType: dto.institutionType?.trim() || null,
                language: dto.language || 'vi',
                additionalContext: dto.additionalContext?.trim() || null,
            },
        });
        return {
            ...created,
            major: created.majorName || created.expertiseArea || null,
            sessionCount: 0,
        };
    }

    async updateSubject(subjectId: string, userId: string, dto: Partial<PptxSubjectDto>) {
        const existing = await this.prisma.pptxSubject.findUnique({
            where: { id: subjectId },
        });
        if (!existing) throw new NotFoundException('Không tìm thấy môn học.');
        if (existing.userId !== userId) throw new BadRequestException('Không có quyền chỉnh sửa môn học này.');

        const majorInput = dto.majorName !== undefined ? dto.majorName : dto.major;
        const updated = await this.prisma.pptxSubject.update({
            where: { id: subjectId },
            data: {
                ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
                ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
                ...(majorInput !== undefined ? { majorName: majorInput?.trim() || null } : {}),
                ...(dto.expertiseArea !== undefined ? { expertiseArea: dto.expertiseArea?.trim() || null } : {}),
                ...(dto.courseName !== undefined ? { courseName: dto.courseName?.trim() || null } : {}),
                ...(dto.targetAudience !== undefined ? { targetAudience: dto.targetAudience?.trim() || null } : {}),
                ...(dto.institutionType !== undefined ? { institutionType: dto.institutionType?.trim() || null } : {}),
                ...(dto.language !== undefined ? { language: dto.language } : {}),
                ...(dto.additionalContext !== undefined ? { additionalContext: dto.additionalContext?.trim() || null } : {}),
            },
        });
        return {
            ...updated,
            major: updated.majorName || updated.expertiseArea || null,
        };
    }

    async deleteSubject(subjectId: string, userId: string) {
        const existing = await this.prisma.pptxSubject.findUnique({
            where: { id: subjectId },
        });
        if (!existing) throw new NotFoundException('Không tìm thấy môn học.');
        if (existing.userId !== userId) throw new BadRequestException('Không có quyền xóa môn học này.');

        await this.prisma.pptxSubject.delete({
            where: { id: subjectId },
        });
        return { deleted: true };
    }

    // ========== CONTEXT DOCUMENT EXTRACTION (.DOCX / .PDF / .TXT / .MD) ==========

    async extractTextFromDocument(file: Express.Multer.File): Promise<{ fileName: string; text: string; charCount: number }> {
        if (!file) {
            throw new BadRequestException('Vui lòng chọn file tài liệu (.docx, .pdf, .txt, .md).');
        }
        const safeFileName = fixUtf8Filename(file.originalname || 'document');
        const ext = path.extname(safeFileName).toLowerCase();
        const buffer = file.buffer && file.buffer.length > 0
            ? file.buffer
            : (file.path && fs.existsSync(file.path) ? fs.readFileSync(file.path) : Buffer.alloc(0));

        if (buffer.length === 0) {
            throw new BadRequestException('File tài liệu trống hoặc không thể đọc.');
        }

        let extractedText = '';
        if (ext === '.docx') {
            try {
                const mammoth = await import('mammoth');
                const res = await mammoth.extractRawText({ buffer });
                extractedText = res.value || '';
            } catch (err: any) {
                this.logger.error(`Failed to extract DOCX text: ${err.message}`);
                throw new BadRequestException(`Không thể đọc file Word (.docx): ${err.message}`);
            }
        } else if (ext === '.pdf') {
            const tmpPdfPath = path.join(
                os.tmpdir(),
                `ata_ctx_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.pdf`,
            );
            try {
                fs.writeFileSync(tmpPdfPath, buffer);
                const { stdout } = await execFileAsync('pdftotext', ['-layout', tmpPdfPath, '-'], {
                    maxBuffer: 25 * 1024 * 1024,
                });
                extractedText = stdout || '';
            } catch (err: any) {
                this.logger.error(`Failed to extract PDF text via pdftotext: ${err.message}`);
                throw new BadRequestException(`Không thể trích xuất văn bản từ file PDF: ${err.message}`);
            } finally {
                if (fs.existsSync(tmpPdfPath)) {
                    try { fs.unlinkSync(tmpPdfPath); } catch { /* ignore */ }
                }
            }
        } else if (ext === '.txt' || ext === '.md') {
            extractedText = buffer.toString('utf-8');
        } else {
            throw new BadRequestException('Định dạng file không hỗ trợ. Vui lòng chọn file .docx, .pdf, .txt hoặc .md.');
        }

        // Clean up temp upload file if stored on disk by multer
        if (file.path && fs.existsSync(file.path)) {
            try { fs.unlinkSync(file.path); } catch { /* ignore */ }
        }

        const cleanedText = extractedText
            .replace(/\r\n/g, '\n')
            .replace(/\u0000/g, '')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim()
            .substring(0, 80000);

        if (!cleanedText) {
            throw new BadRequestException('Không tìm thấy nội dung văn bản trong file (có thể là file PDF scan ảnh). Hãy nhập văn bản trực tiếp.');
        }

        return {
            fileName: safeFileName,
            text: cleanedText,
            charCount: cleanedText.length,
        };
    }

    async uploadSessionContextFile(
        sessionId: string,
        userId: string,
        file: Express.Multer.File,
        mode: 'replace' | 'append' = 'append',
    ) {
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
        });
        if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
        if (session.userId !== userId) throw new BadRequestException('Not authorized');

        const extracted = await this.extractTextFromDocument(file);
        const existingText = (session.contextText || '').trim();
        const combinedText = (mode === 'append' && existingText)
            ? `${existingText}\n\n--- [Tài liệu bổ sung: ${extracted.fileName}] ---\n${extracted.text}`.substring(0, 80000)
            : extracted.text;

        const existingFileName = (session.contextFileName || '').trim();
        const newFileName = (mode === 'append' && existingFileName && !existingFileName.includes(extracted.fileName))
            ? `${existingFileName}, ${extracted.fileName}`
            : extracted.fileName;

        const updated = await this.prisma.pptxAudioSession.update({
            where: { id: sessionId },
            data: {
                contextText: combinedText,
                contextFileName: newFileName,
            },
            include: { pptxSubject: true },
        });

        return {
            sessionId: updated.id,
            contextText: updated.contextText,
            contextFileName: updated.contextFileName,
            extractedCharCount: extracted.charCount,
            fileName: extracted.fileName,
        };
    }

    async updateSessionMeta(
        sessionId: string,
        userId: string,
        dto: {
            lessonTitle?: string;
            pptxSubjectId?: string | null;
            contextText?: string;
            contextFileName?: string | null;
        },
    ) {
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
        });
        if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
        if (session.userId !== userId) throw new BadRequestException('Not authorized');

        if (dto.pptxSubjectId) {
            const sub = await this.prisma.pptxSubject.findUnique({ where: { id: dto.pptxSubjectId } });
            if (!sub || sub.userId !== userId) {
                throw new BadRequestException('Môn học không hợp lệ.');
            }
        }

        const updated = await this.prisma.pptxAudioSession.update({
            where: { id: sessionId },
            data: {
                ...(dto.lessonTitle !== undefined ? { lessonTitle: dto.lessonTitle?.trim() || null } : {}),
                ...(dto.pptxSubjectId !== undefined ? { pptxSubjectId: dto.pptxSubjectId || null } : {}),
                ...(dto.contextText !== undefined ? { contextText: dto.contextText || null } : {}),
                ...(dto.contextFileName !== undefined ? { contextFileName: dto.contextFileName || null } : {}),
            },
            include: { pptxSubject: true },
        });

        const slides = updated.slidesJson ? JSON.parse(updated.slidesJson) : [];
        return {
            ...updated,
            fileName: fixUtf8Filename(updated.fileName),
            slides,
            totalSlides: slides.length,
        };
    }

    // ========== SESSION MANAGEMENT ==========

    async listSessions(userId: string) {
        const sessions = await this.prisma.pptxAudioSession.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                pptxSubjectId: true,
                lessonTitle: true,
                contextText: true,
                contextFileName: true,
                fileName: true,
                status: true,
                language: true,
                createdAt: true,
                updatedAt: true,
                slidesJson: true,
                pptxSubject: {
                    select: {
                        id: true,
                        name: true,
                        majorName: true,
                        expertiseArea: true,
                        language: true,
                    },
                },
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
            const cleanFileName = fixUtf8Filename(s.fileName);
            const subObj = (s as any).pptxSubject;
            return {
                id: s.id,
                pptxSubjectId: s.pptxSubjectId || null,
                pptxSubject: subObj
                    ? { ...subObj, major: subObj.majorName || subObj.expertiseArea || null }
                    : null,
                lessonTitle: s.lessonTitle || cleanFileName.replace(/\.pptx$/i, ''),
                hasContext: !!(s.contextText && s.contextText.trim().length > 0),
                contextFileName: s.contextFileName || null,
                contextLength: s.contextText ? s.contextText.length : 0,
                fileName: cleanFileName,
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

    async uploadAndParse(file: Express.Multer.File, userId: string, meta?: SessionUploadMeta) {
        const fileName = fixUtf8Filename(file.originalname);
        const lessonTitle = meta?.lessonTitle?.trim() || fileName.replace(/\.pptx$/i, '');
        this.logger.log(`Uploading PPTX: ${fileName} (lessonTitle="${lessonTitle}", ${file.size} bytes)`);

        let initialLang = 'vi';
        let validSubjectId: string | null = null;
        if (meta?.pptxSubjectId) {
            const sub = await this.prisma.pptxSubject.findUnique({
                where: { id: meta.pptxSubjectId },
            });
            if (sub && sub.userId === userId) {
                validSubjectId = sub.id;
                if (sub.language === 'en' || sub.language === 'vi') {
                    initialLang = sub.language;
                }
            }
        }

        // Create session first to get ID
        const session = await this.prisma.pptxAudioSession.create({
            data: {
                userId,
                pptxSubjectId: validSubjectId,
                lessonTitle,
                contextText: meta?.contextText?.trim() || null,
                contextFileName: meta?.contextFileName?.trim() || null,
                fileName,
                filePath: '', // Will update after moving file
                status: 'uploaded',
                language: initialLang,
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

            // Build slides JSON with audio status + rendered full-slide PNG + extracted imageUrl
            const slides: ParsedSlide[] = result.slides.map((s: any, idx: number) => {
                const extractedImgUrl = s.imageFileName ? `/uploads/pptx-tool/${session.id}/images/${s.imageFileName}` : null;
                const renderedSlideUrl = s.renderedSlideFileName
                    ? `/uploads/pptx-tool/${session.id}/rendered_slides/${s.renderedSlideFileName}`
                    : null;
                return {
                    index: s.index,
                    originalSlideIndex: s.index,
                    slideType: idx === 0 ? 'title' : 'content',
                    layoutType: renderedSlideUrl ? 'full_slide_canvas' : 'split_standard',
                    title: s.title || `Slide ${s.index + 1}`,
                    content: s.content || [],
                    optimizedContent: null,
                    interactiveData: null,
                    noteFull: s.noteFull || '',
                    noteEN: s.noteEN || '',
                    noteVN: s.noteVN || '',
                    hasDual: s.hasDual || false,
                    imageUrl: renderedSlideUrl || extractedImgUrl,
                    renderedSlideUrl,
                    hasCustomImage: false,
                    audioUrl: null,
                    audioDuration: null,
                    audioStatus: 'pending',
                    errorMessage: null,
                    extraAudioUrl: null,
                    extraAudioName: null,
                    extraAudioDuration: null,
                };
            });

            // Build content JSON
            const content = result.slides.map((s: any) => {
                const extractedImgUrl = s.imageFileName ? `/uploads/pptx-tool/${session.id}/images/${s.imageFileName}` : null;
                const renderedSlideUrl = s.renderedSlideFileName
                    ? `/uploads/pptx-tool/${session.id}/rendered_slides/${s.renderedSlideFileName}`
                    : null;
                return {
                    index: s.index,
                    title: s.title || `Slide ${s.index + 1}`,
                    content: s.content || [],
                    imageUrl: renderedSlideUrl || extractedImgUrl,
                };
            });

            // Update session
            await this.prisma.pptxAudioSession.update({
                where: { id: session.id },
                data: {
                    slidesJson: JSON.stringify(slides),
                    contentJson: JSON.stringify(content),
                    status: 'notes_extracted',
                },
            });

            return {
                sessionId: session.id,
                pptxSubjectId: validSubjectId,
                lessonTitle,
                contextText: session.contextText,
                contextFileName: session.contextFileName,
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

    // ========== CHUNKED UPLOAD SUPPORT ==========

    async initChunkUpload(userId: string, fileName: string, fileSize: number, totalChunks: number) {
        const safeFileName = fixUtf8Filename(fileName || 'presentation.pptx');
        const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const chunkDir = path.join(process.cwd(), 'uploads', 'pptx-tool', 'chunks', uploadId);

        if (!fs.existsSync(chunkDir)) {
            fs.mkdirSync(chunkDir, { recursive: true });
        }

        // Clean up stale chunk directories older than 2 hours asynchronously
        setImmediate(() => {
            this.cleanStaleChunkDirs().catch((err) =>
                this.logger.warn(`Failed cleaning stale chunks: ${err.message}`),
            );
        });

        this.logger.log(
            `Initialized chunked upload ${uploadId} for file "${safeFileName}" (${(fileSize / (1024 * 1024)).toFixed(1)} MB, ${totalChunks} chunks) by user ${userId}`,
        );

        return { uploadId, chunkSize: 10 * 1024 * 1024 };
    }

    async saveChunk(uploadId: string, chunkIndex: number, chunkFile: Express.Multer.File) {
        const safeUploadId = uploadId.replace(/[^a-zA-Z0-9_-]/g, '');
        const chunkDir = path.join(process.cwd(), 'uploads', 'pptx-tool', 'chunks', safeUploadId);

        if (!fs.existsSync(chunkDir)) {
            if (chunkFile.path && fs.existsSync(chunkFile.path)) {
                fs.unlinkSync(chunkFile.path);
            }
            throw new BadRequestException('Session upload không tồn tại hoặc đã bị hủy.');
        }

        const targetChunkPath = path.join(chunkDir, `chunk_${chunkIndex}`);
        try {
            fs.renameSync(chunkFile.path, targetChunkPath);
        } catch (err) {
            fs.copyFileSync(chunkFile.path, targetChunkPath);
            fs.unlinkSync(chunkFile.path);
        }

        return { success: true, chunkIndex };
    }

    async mergeChunksAndParse(uploadId: string, originalFileName: string, totalChunks: number, userId: string, meta?: SessionUploadMeta) {
        const safeUploadId = uploadId.replace(/[^a-zA-Z0-9_-]/g, '');
        const chunkDir = path.join(process.cwd(), 'uploads', 'pptx-tool', 'chunks', safeUploadId);

        if (!fs.existsSync(chunkDir)) {
            throw new BadRequestException('Session upload không tồn tại hoặc đã hết hạn.');
        }

        // Verify all chunks exist
        for (let i = 0; i < totalChunks; i++) {
            const chunkPath = path.join(chunkDir, `chunk_${i}`);
            if (!fs.existsSync(chunkPath)) {
                throw new BadRequestException(`Thiếu mảnh dữ liệu số ${i + 1}/${totalChunks}. Vui lòng thử lại.`);
            }
        }

        const tempDir = path.join(process.cwd(), 'uploads', 'pptx-tool', 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        const mergedPath = path.join(tempDir, `${safeUploadId}.pptx`);
        const writeStream = fs.createWriteStream(mergedPath);

        this.logger.log(`Merging ${totalChunks} chunks for uploadId ${safeUploadId} -> ${mergedPath}`);

        try {
            for (let i = 0; i < totalChunks; i++) {
                const chunkPath = path.join(chunkDir, `chunk_${i}`);
                await new Promise<void>((resolve, reject) => {
                    const readStream = fs.createReadStream(chunkPath);
                    readStream.on('error', reject);
                    readStream.pipe(writeStream, { end: false });
                    readStream.on('end', () => resolve());
                });
            }

            await new Promise<void>((resolve, reject) => {
                writeStream.end((err?: Error | null) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        } catch (err: any) {
            this.logger.error(`Error merging chunks for ${safeUploadId}: ${err.message}`);
            if (fs.existsSync(mergedPath)) {
                fs.unlinkSync(mergedPath);
            }
            throw new BadRequestException(`Lỗi khi ghép các mảnh file: ${err.message}`);
        } finally {
            // Always clean up chunk directory
            try {
                fs.rmSync(chunkDir, { recursive: true, force: true });
            } catch (err: any) {
                this.logger.warn(`Failed to clean up chunk directory ${chunkDir}: ${err.message}`);
            }
        }

        const stat = fs.statSync(mergedPath);
        this.logger.log(`Successfully merged ${safeUploadId}.pptx (${(stat.size / (1024 * 1024)).toFixed(2)} MB)`);

        const mockMulterFile: Express.Multer.File = {
            fieldname: 'file',
            originalname: originalFileName,
            encoding: '7bit',
            mimetype: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            size: stat.size,
            destination: tempDir,
            filename: `${safeUploadId}.pptx`,
            path: mergedPath,
            buffer: Buffer.alloc(0),
            stream: null as any,
        };

        return this.uploadAndParse(mockMulterFile, userId, meta);
    }

    private async cleanStaleChunkDirs() {
        const baseChunksDir = path.join(process.cwd(), 'uploads', 'pptx-tool', 'chunks');
        if (!fs.existsSync(baseChunksDir)) return;

        const entries = fs.readdirSync(baseChunksDir, { withFileTypes: true });
        const now = Date.now();
        const MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

        for (const entry of entries) {
            if (entry.isDirectory()) {
                const dirPath = path.join(baseChunksDir, entry.name);
                try {
                    const stat = fs.statSync(dirPath);
                    if (now - stat.mtimeMs > MAX_AGE_MS) {
                        fs.rmSync(dirPath, { recursive: true, force: true });
                        this.logger.log(`Cleaned up stale chunk directory: ${entry.name}`);
                    }
                } catch {
                    // Ignore individual folder errors
                }
            }
        }
    }

    // ========== 2. GET SESSION / SLIDES ==========

    async getSession(sessionId: string) {
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
            include: { pptxSubject: true },
        });
        if (!session) {
            throw new NotFoundException(`Session ${sessionId} not found`);
        }
        const slides = session.slidesJson ? JSON.parse(session.slidesJson) : [];
        const cleanFileName = fixUtf8Filename(session.fileName);
        return {
            ...session,
            fileName: cleanFileName,
            lessonTitle: session.lessonTitle || cleanFileName.replace(/\.pptx$/i, ''),
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

    async updateNote(sessionId: string, slideIndex: number, note: string, targetLang?: 'vi' | 'en') {
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

        const activeLang = targetLang || session.language || 'vi';

        // Update the active language note
        if (activeLang === 'en') {
            slide.noteEN = note;
        } else {
            slide.noteVN = note;
        }
        slide.noteFull = note; // Also update full
        slide.hasDual = !!(slide.noteVN?.trim() && slide.noteEN?.trim());

        await this.prisma.pptxAudioSession.update({
            where: { id: sessionId },
            data: { slidesJson: JSON.stringify(slides) },
        });

        return slide;
    }

    // ========== 4A. BUILD PEDAGOGICAL CONTEXT BLOCK FOR AI ==========

    private buildPedagogicalContextBlock(
        session: any,
        slides: ParsedSlide[],
        isEnglish: boolean,
        maxDocChars = 25000,
    ): string {
        const sub = session.pptxSubject;
        const lessonTitle = session.lessonTitle || fixUtf8Filename(session.fileName || '').replace(/\.pptx$/i, '');
        const slideMapLines = slides
            .map(s => `  ${s.index + 1}. ${s.title || `Slide ${s.index + 1}`}`)
            .join('\n');

        const parts: string[] = [];

        if (isEnglish) {
            parts.push(`**Course & Lesson Context:**`);
            parts.push(`- Lesson Title: ${lessonTitle}`);
            parts.push(`- Source File: ${fixUtf8Filename(session.fileName || '')}`);
            if (sub) {
                const subMajor = sub.majorName || sub.expertiseArea || sub.major;
                parts.push(`- Subject / Course: ${sub.name}`);
                if (subMajor) parts.push(`- Academic Discipline / Major: ${subMajor}`);
                if (sub.targetAudience) parts.push(`- Target Audience: ${sub.targetAudience}`);
                if (sub.institutionType) parts.push(`- Institution Level: ${sub.institutionType}`);
                if (sub.description) parts.push(`- Course Overview: ${sub.description}`);
                if (sub.additionalContext) parts.push(`- Pedagogical Guidelines: ${sub.additionalContext}`);
            }
            if (slideMapLines) {
                parts.push(`\n**Full Presentation Slide Map (for structural awareness & avoiding premature repetition):**\n${slideMapLines}`);
            }
            if (session.contextText && session.contextText.trim()) {
                const docSnippet = session.contextText.trim().substring(0, maxDocChars);
                parts.push(
                    `\n**Supplementary Reference Material / Textbook Context (${session.contextFileName || 'Instructor Notes'}):**\n` +
                    `Use the following detailed reference material to accurately explain abbreviated bullet points, formulas, tables, or diagrams on the slides:\n` +
                    `"""\n${docSnippet}\n"""`,
                );
            }
        } else {
            parts.push(`**Ngữ cảnh Môn học & Bài giảng:**`);
            parts.push(`- Tên bài học: ${lessonTitle}`);
            parts.push(`- Tệp trình chiếu: ${fixUtf8Filename(session.fileName || '')}`);
            if (sub) {
                const subMajor = sub.majorName || sub.expertiseArea || sub.major;
                parts.push(`- Môn học / Học phần: ${sub.name}`);
                if (subMajor) parts.push(`- Chuyên ngành / Lĩnh vực: ${subMajor}`);
                if (sub.targetAudience) parts.push(`- Đối tượng người học: ${sub.targetAudience}`);
                if (sub.institutionType) parts.push(`- Bậc đào tạo: ${sub.institutionType}`);
                if (sub.description) parts.push(`- Mô tả môn học: ${sub.description}`);
                if (sub.additionalContext) parts.push(`- Định hướng sư phạm bổ sung: ${sub.additionalContext}`);
            }
            if (slideMapLines) {
                parts.push(`\n**Bản đồ cấu trúc toàn bộ bài trình chiếu (để nắm mạch bài giảng tổng thể, không giảng chồng lấn sang phần sau):**\n${slideMapLines}`);
            }
            if (session.contextText && session.contextText.trim()) {
                const docSnippet = session.contextText.trim().substring(0, maxDocChars);
                parts.push(
                    `\n**Tài liệu tham khảo / Giáo trình chi tiết đính kèm (${session.contextFileName || 'Ghi chú giảng viên'}):**\n` +
                    `Hãy khai thác kiến thức chuyên sâu từ tài liệu tham khảo dưới đây để giải thích tường tận các gạch đầu dòng viết tắt, bảng biểu, số liệu hoặc sơ đồ trên slide:\n` +
                    `"""\n${docSnippet}\n"""`,
                );
            }
        }

        return parts.join('\n');
    }

    // ========== 4B. GENERATE & OPTIMIZE SPEAKER NOTES (AI BACKGROUND JOBS) ==========

    async generateSpeakerNotesBackground(
        jobId: string,
        sessionId: string,
        userId: string,
        mode: 'all' | 'missing' = 'all',
        targetLanguage?: 'vi' | 'en',
    ) {
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
            include: { pptxSubject: true },
        });
        if (!session) {
            throw new NotFoundException(`Session ${sessionId} not found`);
        }

        const slides: ParsedSlide[] = session.slidesJson ? JSON.parse(session.slidesJson) : [];
        if (slides.length === 0) {
            throw new BadRequestException('No slides found in session');
        }

        const language: 'vi' | 'en' = targetLanguage || (session.language as 'vi' | 'en') || 'vi';
        const isEnglish = language === 'en';
        const pedagogicalContext = this.buildPedagogicalContextBlock(session, slides, isEnglish, 25000);

        // Synchronize session language if changed
        if (targetLanguage && session.language !== targetLanguage) {
            await this.prisma.pptxAudioSession.update({
                where: { id: sessionId },
                data: { language: targetLanguage },
            });
        }

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
                const existingEnNote = s.noteEN?.trim();
                const existingVnNote = s.noteVN?.trim() || s.noteFull?.trim();
                const contentLines = Array.isArray(s.content) ? s.content.join('\n  • ') : (s.content || '');
                let sText = isEnglish
                    ? `--- Slide ${s.index + 1} ---\nIndex: ${s.index}\nTitle: ${s.title}\nContent:\n  • ${contentLines}`
                    : `--- Slide ${s.index + 1} ---\nIndex: ${s.index}\nTiêu đề: ${s.title}\nNội dung chính:\n  • ${contentLines}`;

                if (isEnglish) {
                    if (existingEnNote) {
                        sText += `\nExisting English Lecture Note:\n"${existingEnNote}"\n(Instruction: Expand and polish this into a comprehensive academic lecture script in English)`;
                    } else if (existingVnNote) {
                        sText += `\nInstructor's Original Draft (in Vietnamese):\n"${existingVnNote}"\n(Instruction: Translate and elaborate these ideas into a thorough, inspiring academic lecture in 100% fluent English)`;
                    }
                } else {
                    if (existingVnNote) {
                        sText += `\nLời giảng / Ghi chú có sẵn của giảng viên:\n"${existingVnNote}"\n(Hướng dẫn: Hãy kết hợp ý tưởng của giảng viên với nội dung trên slide để hoàn thiện thành bài giảng chỉn chu, sâu sắc)`;
                    }
                }
                return sText;
            }).join('\n\n');

            const promptContent = previousSlideBridge
                ? (isEnglish
                    ? `[Previous topic for natural transition: "${previousSlideBridge}"]\n(Note: NEVER use the word "slide", transition naturally)\n\n${slidesContent}`
                    : `[Chủ đề vừa giải thích ở phần trước để nối mạch tự nhiên: "${previousSlideBridge}"]\n(Lưu ý: Tuyệt đối KHÔNG dùng từ "slide trước" hay "slide", hãy nối mạch kiến thức tự nhiên)\n\n${slidesContent}`)
                : slidesContent;

            const prompt = isEnglish ? `**Task: Compose Academic English Lecture Transcripts (Speaker Notes) For Each Slide**

You are a distinguished university professor delivering an inspiring, academic lecture in English.
Your task is to write spoken lecture transcripts (speaker notes) for each slide in FLUENT, NATURAL ENGLISH.

CRITICAL INSTRUCTIONS:
1. **100% ENGLISH ONLY:** All speaker notes MUST be written entirely in fluent, professional, academic English.
2. **Translate & Explain:** If slide titles, bullet points, or instructor notes are in Vietnamese, translate all terms, concepts, and explanations accurately into standard English academic terminology.
3. **Spoken Lecture Style:** Write naturally as a real lecturer speaking directly to university students in an interactive auditorium.

${pedagogicalContext}

**Slide Content to compose:**
${promptContent}

---

## ⏱️ LENGTH & PACING STANDARDS:
- **Core content slides:** **180 – 220 words** (~1.5 – 2.0 minutes standard speaking pace).
- **Title / Objectives / Summary / Thank You slides:** **60 – 100 words** (30 – 45 seconds).
- ⚠️ Do NOT write shorter than 120 words for content slides, and do not exceed 230 words.

## 🎓 STRUCTURE OF AN ACADEMIC LECTURE SEGMENT:
1. Engaging opening connecting to real-world applications or posing the core problem (1–2 sentences).
2. Deep dive into principles, mechanisms, and vivid pedagogical examples (3–4 sentences).
3. Practical tips, common pitfalls, or best practices (1–2 sentences).
4. Smooth transition to the next concept (1 sentence).

## 🚫 STRICT RULES:
- ❌ **NEVER use the word "slide":** Do NOT say "on this slide", "as seen on the slide", "next slide", "in this presentation". Instead say: "Here we observe...", "Examining this architecture...", "Next, let us explore...".
- ❌ **Do not overuse "you guys" or repetitive "everyone":** Use "we", active scholarly voice ("Notice that...", "It is vital to understand that...").
- ❌ **Avoid clichéd AI buzzwords:** "delve into", "testament", "beacon", "game-changer", "dive right in", "unlock".

---

## OUTPUT FORMAT (STRICT JSON ONLY):
\`\`\`json
{
  "speakerNotes": [
    {
      "slideIndex": 0,
      "speakerNote": "Welcome everyone. In today's session, we examine the fundamental computational architecture of NumPy..."
    }
  ]
}
\`\`\`
Return JSON only.`
                : `**Nhiệm vụ: Soạn Lời Giảng Sư Phạm Cho Từng Slide Thuyết Trình (Academic Lecture Transcript)**

Bạn là một giảng viên đại học giàu kinh nghiệm, uyên bác và truyền cảm hứng.
Hãy chuyển đổi nội dung tóm tắt trên slide thành lời giảng nói trực tiếp trong lớp học cho từng slide dưới đây.

Soạn lời giảng bằng tiếng Việt chuẩn mực, khẩu ngữ sư phạm tự nhiên như giảng viên đại học đang giảng trực tiếp.

${pedagogicalContext}

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
                            target.hasDual = !!(target.noteVN?.trim() && target.noteEN?.trim());
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
                        data: {
                            slidesJson: JSON.stringify(slides),
                            language: language,
                        },
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
                language: language,
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

            const isEnglish = language === 'en';

            const slidesContent = batch.map(s => {
                const currentNote = (isEnglish ? s.noteEN : s.noteVN)?.trim() || s.noteFull?.trim();
                const contentLines = Array.isArray(s.content) ? s.content.join(', ') : (s.content || '');
                return isEnglish
                    ? `--- Slide ${s.index + 1} (Index: ${s.index}) ---\nTitle: ${s.title}\nSlide Content: ${contentLines}\nCurrent English Note to polish:\n"${currentNote}"`
                    : `--- Slide ${s.index + 1} (Index: ${s.index}) ---\nTiêu đề: ${s.title}\nNội dung slide: ${contentLines}\nLời giảng hiện tại cần tối ưu:\n"${currentNote}"`;
            }).join('\n\n');

            const prompt = isEnglish ? `**TTS Voice Polish & Duration Control (Academic English Lecture)**

You are a Voice Director and Pedagogical Specialist. Polish the following English speaker notes so they sound natural, engaging, and clear when converted into speech via Text-To-Speech (AI voice):
1. **Natural Pacing & Breath Marks:** Add natural commas (,) and periods (.) so that the AI voice pauses and breathes naturally without rushing or sounding robotic.
2. **Pronunciation Clarity:** Ensure all acronyms, technical terms, and formulas are written in phonetic or clear forms suitable for English TTS engines.
3. **Pacing & Length:** Maintain 180 – 220 words per content slide (~1.5 – 2.0 minutes). Do not bloat or remove core substance.
4. **Clean AI Clichés & Strict Rule:** NEVER use the word "slide".

**Slide Notes to Polish:**
${slidesContent}

---

## OUTPUT FORMAT (STRICT JSON ONLY):
\`\`\`json
{
  "speakerNotes": [
    {
      "slideIndex": 0,
      "speakerNote": "Polished lecture transcript with natural pauses and cadence..."
    }
  ]
}
\`\`\`
Return JSON only.`
                : `**Tối Ưu & Kiểm Duyệt Lời Giảng Cho Giọng Đọc AI (TTS Polish & Duration Control)**

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
                            target.hasDual = !!(target.noteVN?.trim() && target.noteEN?.trim());
                        }
                    }

                    await this.prisma.pptxAudioSession.update({
                        where: { id: sessionId },
                        data: {
                            slidesJson: JSON.stringify(slides),
                            language: language,
                        },
                    });
                }
            } catch (err: any) {
                this.logger.warn(`[optimizeSpeakerNotesBackground] Error optimizing batch ${batchStart}-${batchEnd}: ${err.message}`);
            }
        }

        await this.prisma.pptxAudioSession.update({
            where: { id: sessionId },
            data: {
                slidesJson: JSON.stringify(slides),
                language: language,
            },
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
            if (slide.audioUrl) {
                try {
                    const prevRel = slide.audioUrl.split('?')[0].replace(/^\//, '');
                    const prevPath = path.join(process.cwd(), prevRel);
                    if (fs.existsSync(prevPath)) fs.unlinkSync(prevPath);
                } catch { /* ignore */ }
            }
            const fileExt = result.format === 'wav' ? 'wav' : 'mp3';
            const fileName = `slide_${String(slideIndex).padStart(2, '0')}_${Date.now()}.${fileExt}`;
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
            try {
                const cleanRel = slide.audioUrl.split('?')[0].replace(/^\//, '');
                const directPath = path.join(process.cwd(), cleanRel);
                if (fs.existsSync(directPath)) {
                    fs.unlinkSync(directPath);
                    this.logger.log(`Deleted audio: ${directPath}`);
                }
            } catch { /* ignore */ }
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

        // Build audio files list for injection into original.pptx
        const audioFiles: { slideIndex: number; audioPath: string }[] = [];
        const audioDir = this.getAudioDir(sessionId);

        for (const slide of slides) {
            if (slide.audioStatus === 'done' && slide.audioUrl) {
                const origIdx = slide.originalSlideIndex !== undefined ? slide.originalSlideIndex : slide.index;
                if (origIdx === null || origIdx < 0) {
                    // Newly inserted slide (not in original.pptx) -> skip for raw PPTX audio injection
                    continue;
                }
                const cleanRel = slide.audioUrl.split('?')[0].replace(/^\//, '');
                const directPath = path.join(process.cwd(), cleanRel);
                if (fs.existsSync(directPath)) {
                    audioFiles.push({ slideIndex: origIdx, audioPath: directPath });
                    continue;
                }
                // Fallback to legacy filename pattern
                const fileName = `slide_${String(slide.index).padStart(2, '0')}`;
                for (const ext of ['wav', 'mp3']) {
                    const filePath = path.join(audioDir, `${fileName}.${ext}`);
                    if (fs.existsSync(filePath)) {
                        audioFiles.push({ slideIndex: origIdx, audioPath: filePath });
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
        const rawBase = session.lessonTitle?.trim() || path.basename(fixUtf8Filename(session.fileName), '.pptx');
        const filename = `${rawBase}_with_audio.pptx`;

        return { buffer, filename };
    }

    // ========== 8A. STEP 5 SLIDE WORKSPACE CRUD & AI METHODS ==========

    private async saveSlidesAndSyncContent(sessionId: string, slides: ParsedSlide[]) {
        // Re-index 0..N-1
        slides.forEach((s, idx) => {
            s.index = idx;
        });
        const content = slides.map(s => ({
            index: s.index,
            title: s.title || `Slide ${s.index + 1}`,
            content: Array.isArray(s.content) ? s.content : [],
            imageUrl: s.imageUrl || null,
        }));
        await this.prisma.pptxAudioSession.update({
            where: { id: sessionId },
            data: {
                slidesJson: JSON.stringify(slides),
                contentJson: JSON.stringify(content),
            },
        });
        return slides;
    }

    async updateSlideContent(
        sessionId: string,
        slideIndex: number,
        userId: string,
        dto: {
            title?: string;
            content?: string[] | string;
            optimizedContent?: Array<{ emoji: string; point: string; description: string }> | null;
            speakerNote?: string;
            slideType?: string;
            layoutType?: string;
            interactiveData?: any;
        },
    ) {
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
        });
        if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
        if (session.userId !== userId) throw new BadRequestException('Not authorized');

        const slides: ParsedSlide[] = session.slidesJson ? JSON.parse(session.slidesJson) : [];
        const slide = slides.find(s => s.index === slideIndex) || slides[slideIndex];
        if (!slide) throw new NotFoundException(`Slide ${slideIndex} not found`);

        if (dto.title !== undefined && dto.title !== null) {
            slide.title = dto.title.trim();
        }
        if (dto.content !== undefined && dto.content !== null) {
            if (Array.isArray(dto.content)) {
                slide.content = dto.content.map(l => String(l).trim()).filter(Boolean);
            } else if (typeof dto.content === 'string') {
                slide.content = dto.content
                    .split('\n')
                    .map(l => l.replace(/^[-*•]\s*/, '').trim())
                    .filter(Boolean);
            }
        }
        if (dto.optimizedContent !== undefined) {
            slide.optimizedContent = dto.optimizedContent;
            if (Array.isArray(dto.optimizedContent) && dto.optimizedContent.length > 0 && dto.content === undefined) {
                slide.content = dto.optimizedContent
                    .map(b => `${b.point || ''}${b.description ? `: ${b.description}` : ''}`.trim())
                    .filter(Boolean);
            }
        }
        if (dto.speakerNote !== undefined && dto.speakerNote !== null) {
            const note = dto.speakerNote.trim();
            if (session.language === 'en') {
                slide.noteEN = note;
            } else {
                slide.noteVN = note;
            }
            slide.noteFull = note;
            slide.hasDual = !!(slide.noteVN?.trim() && slide.noteEN?.trim());
        }
        if (dto.slideType !== undefined && dto.slideType !== null) {
            slide.slideType = dto.slideType.trim();
        }
        if (dto.layoutType !== undefined && dto.layoutType !== null) {
            slide.layoutType = dto.layoutType.trim();
        }
        if (dto.interactiveData !== undefined) {
            slide.interactiveData = dto.interactiveData === null
                ? null
                : (typeof dto.interactiveData === 'string'
                    ? dto.interactiveData
                    : JSON.stringify(dto.interactiveData));
        }

        await this.saveSlidesAndSyncContent(sessionId, slides);
        return slide;
    }

    async createSlide(
        sessionId: string,
        userId: string,
        dto: {
            title?: string;
            content?: string | string[];
            speakerNote?: string;
            slideType?: string;
            layoutType?: string;
            interactiveData?: any;
            insertAfterIndex?: number;
        },
    ) {
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
        });
        if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
        if (session.userId !== userId) throw new BadRequestException('Not authorized');

        const slides: ParsedSlide[] = session.slidesJson ? JSON.parse(session.slidesJson) : [];
        const total = slides.length;

        // insertAfterIndex convention (matching Step5GeneratePPTX):
        // 0 -> insert before first slide (array index 0)
        // 1..total -> insert right after 1-based slide #insertAfterIndex (array index insertAfterIndex)
        // -1 or undefined -> append at the end (array index total)
        let targetArrayPos = total;
        if (dto.insertAfterIndex !== undefined && dto.insertAfterIndex >= 0 && dto.insertAfterIndex <= total) {
            targetArrayPos = dto.insertAfterIndex;
        }

        let contentArr: string[] = [];
        if (Array.isArray(dto.content)) {
            contentArr = dto.content.map(l => String(l).trim()).filter(Boolean);
        } else if (typeof dto.content === 'string' && dto.content.trim()) {
            contentArr = dto.content
                .split('\n')
                .map(l => l.replace(/^[-*•]\s*/, '').trim())
                .filter(Boolean);
        }

        const noteText = (dto.speakerNote || '').trim();
        const isEn = session.language === 'en';
        const slideType = dto.slideType || 'content';
        const layoutType = dto.layoutType || (
            slideType === 'checkpoint_quiz'
                ? 'checkpoint_gate'
                : (slideType === 'interactive_audio' ? 'audio_lab' : 'split_standard')
        );

        const newSlide: ParsedSlide = {
            index: targetArrayPos,
            originalSlideIndex: null,
            slideType,
            layoutType,
            title: dto.title?.trim() || `Slide ${targetArrayPos + 1}`,
            content: contentArr,
            optimizedContent: null,
            interactiveData: dto.interactiveData
                ? (typeof dto.interactiveData === 'string' ? dto.interactiveData : JSON.stringify(dto.interactiveData))
                : null,
            noteFull: noteText,
            noteEN: isEn ? noteText : '',
            noteVN: isEn ? '' : noteText,
            hasDual: false,
            imageUrl: null,
            audioUrl: null,
            audioDuration: null,
            audioStatus: 'pending',
            errorMessage: null,
            extraAudioUrl: null,
            extraAudioName: null,
            extraAudioDuration: null,
        };

        slides.splice(targetArrayPos, 0, newSlide);
        await this.saveSlidesAndSyncContent(sessionId, slides);

        return {
            slide: newSlide,
            slides,
            totalSlides: slides.length,
        };
    }

    async deleteSlide(sessionId: string, slideIndex: number, userId: string) {
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
        });
        if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
        if (session.userId !== userId) throw new BadRequestException('Not authorized');

        const slides: ParsedSlide[] = session.slidesJson ? JSON.parse(session.slidesJson) : [];
        if (slides.length <= 1) {
            throw new BadRequestException('Không thể xóa slide duy nhất trong bài giảng.');
        }

        const pos = slides.findIndex(s => s.index === slideIndex);
        if (pos === -1) throw new NotFoundException(`Slide ${slideIndex} not found`);

        const removed = slides[pos];
        if (removed.extraAudioUrl) {
            try {
                const localPath = path.join(process.cwd(), removed.extraAudioUrl.split('?')[0].replace(/^\//, ''));
                if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
            } catch { /* ignore */ }
        }
        if (removed.audioUrl) {
            try {
                const localPath = path.join(process.cwd(), removed.audioUrl.split('?')[0].replace(/^\//, ''));
                if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
            } catch { /* ignore */ }
        }

        slides.splice(pos, 1);
        await this.saveSlidesAndSyncContent(sessionId, slides);

        return {
            success: true,
            totalSlides: slides.length,
            slides,
        };
    }

    async moveSlide(sessionId: string, slideIndex: number, userId: string, direction: 'up' | 'down') {
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
        });
        if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
        if (session.userId !== userId) throw new BadRequestException('Not authorized');

        const slides: ParsedSlide[] = session.slidesJson ? JSON.parse(session.slidesJson) : [];
        const pos = slides.findIndex(s => s.index === slideIndex);
        if (pos === -1) throw new NotFoundException(`Slide ${slideIndex} not found`);

        if (direction === 'up' && pos <= 0) {
            throw new BadRequestException('Slide đầu tiên không thể di chuyển lên.');
        }
        if (direction === 'down' && pos >= slides.length - 1) {
            throw new BadRequestException('Slide cuối cùng không thể di chuyển xuống.');
        }

        const targetPos = direction === 'up' ? pos - 1 : pos + 1;
        const temp = slides[pos];
        slides[pos] = slides[targetPos];
        slides[targetPos] = temp;

        await this.saveSlidesAndSyncContent(sessionId, slides);
        return slides;
    }

    async uploadCustomSlideImage(
        sessionId: string,
        slideIndex: number,
        userId: string,
        file: Express.Multer.File,
    ) {
        if (!file || (!file.buffer && !file.path)) {
            throw new BadRequestException('Vui lòng chọn file hình ảnh.');
        }
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
        });
        if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
        if (session.userId !== userId) throw new BadRequestException('Not authorized');

        const slides: ParsedSlide[] = session.slidesJson ? JSON.parse(session.slidesJson) : [];
        const slide = slides.find(s => s.index === slideIndex) || slides[slideIndex];
        if (!slide) throw new NotFoundException(`Slide ${slideIndex} not found`);

        let ext = 'png';
        if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg') ext = 'jpg';
        else if (file.mimetype === 'image/webp') ext = 'webp';

        const imagesDir = path.join(this.getSessionDir(sessionId), 'images');
        if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir, { recursive: true });
        }

        const fileName = `slide_${slideIndex + 1}_custom_${Date.now()}.${ext}`;
        const filePath = path.join(imagesDir, fileName);
        const buf = file.buffer && file.buffer.length > 0
            ? file.buffer
            : (file.path && fs.existsSync(file.path) ? fs.readFileSync(file.path) : Buffer.alloc(0));
        fs.writeFileSync(filePath, buf);

        if (file.path && fs.existsSync(file.path)) {
            try { fs.unlinkSync(file.path); } catch { /* ignore */ }
        }

        slide.imageUrl = `/uploads/pptx-tool/${sessionId}/images/${fileName}`;
        slide.hasCustomImage = true;
        if (slide.layoutType === 'full_slide_canvas') {
            slide.layoutType = 'split_standard';
        }
        await this.saveSlidesAndSyncContent(sessionId, slides);

        return slide;
    }

    async regenerateSlideContent(sessionId: string, slideIndex: number, userId: string) {
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
            include: { pptxSubject: true },
        });
        if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
        if (session.userId !== userId) throw new BadRequestException('Not authorized');

        const slides: ParsedSlide[] = session.slidesJson ? JSON.parse(session.slidesJson) : [];
        const slide = slides.find(s => s.index === slideIndex) || slides[slideIndex];
        if (!slide) throw new NotFoundException(`Slide ${slideIndex} not found`);

        const isEnglish = session.language === 'en';
        const pedagogicalContext = this.buildPedagogicalContextBlock(session, slides, isEnglish, 15000);
        const rawLines = Array.isArray(slide.content) ? slide.content.join('\n• ') : String(slide.content || '');
        const noteText = (isEnglish ? slide.noteEN : slide.noteVN) || slide.noteFull || '';

        const prompt = isEnglish
            ? `You are an Academic Instructional Designer. Optimize the content of Slide #${slide.index + 1} ("${slide.title}") into 3 to 5 clear, structured, high-impact academic bullet points suitable for a university presentation slide.

${pedagogicalContext}

**Current Slide Information:**
- Slide Title: ${slide.title}
- Existing Slide Text:
${rawLines || '(Empty - derive from title and context)'}
${noteText ? `- Speaker Note / Explanation:\n${noteText}` : ''}

Return ONLY valid JSON in the exact format below:
\`\`\`json
{
  "bullets": [
    {
      "emoji": "📌",
      "point": "Concise key concept (3-7 words)",
      "description": "Clear, insightful academic explanation (10-22 words)"
    }
  ]
}
\`\`\``
            : `Bạn là Chuyên gia Thiết kế Bài giảng Đại học (Instructional Designer). Hãy tối ưu hóa và cấu trúc lại nội dung của Slide số ${slide.index + 1} ("${slide.title}") thành 3 đến 5 ý chính (bullet points) súc tích, học thuật, trực quan và chuẩn sư phạm.

${pedagogicalContext}

**Thông tin Slide hiện tại:**
- Tiêu đề Slide: ${slide.title}
- Nội dung thô trên slide:
${rawLines || '(Chưa có nội dung - hãy tổng hợp từ tiêu đề, lời giảng và tài liệu tham khảo)'}
${noteText ? `- Lời giảng của slide:\n${noteText}` : ''}

Chỉ trả về JSON hợp lệ theo đúng cấu trúc sau:
\`\`\`json
{
  "bullets": [
    {
      "emoji": "📌",
      "point": "Ý chính ngắn gọn, đắt giá (3-8 từ)",
      "description": "Mô tả giải thích rõ bản chất học thuật, ngắn gọn dễ nhìn trên slide (12-25 từ)"
    }
  ]
}
\`\`\``;

        const modelConfig = await this.modelConfigService.getModelForTask(userId, 'SLIDES');
        const aiResult = await this.aiProvider.generateText(prompt, modelConfig.modelName || 'gemini-2.5-flash', userId);
        const cleaned = this.cleanJsonResponse(aiResult.content || '');

        let bullets: Array<{ emoji: string; point: string; description: string }> = [];
        try {
            const parsed = JSON.parse(cleaned);
            const rawList = Array.isArray(parsed) ? parsed : (parsed.bullets || parsed.optimizedContent || []);
            if (Array.isArray(rawList)) {
                bullets = rawList.map((b: any) => ({
                    emoji: String(b.emoji || '📌').trim(),
                    point: String(b.point || b.title || '').trim(),
                    description: String(b.description || b.text || b.content || '').trim(),
                })).filter(b => b.point || b.description);
            }
        } catch (err: any) {
            this.logger.error(`Failed to parse regenerateSlideContent JSON: ${err.message}`);
            throw new BadRequestException('AI trả về định dạng chưa hợp lệ. Vui lòng thử lại.');
        }

        if (bullets.length === 0) {
            throw new BadRequestException('Không thể tạo nội dung tối ưu cho slide này. Vui lòng thử lại.');
        }

        slide.optimizedContent = bullets;
        slide.content = bullets.map(b => `${b.point}${b.description ? `: ${b.description}` : ''}`.trim());
        if (slide.layoutType === 'full_slide_canvas') {
            slide.layoutType = 'split_standard';
        }
        await this.saveSlidesAndSyncContent(sessionId, slides);

        return {
            ...slide,
            optimizedContentJson: JSON.stringify(bullets),
        };
    }

    async regenerateSlideImage(sessionId: string, slideIndex: number, userId: string) {
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
            include: { pptxSubject: true },
        });
        if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
        if (session.userId !== userId) throw new BadRequestException('Not authorized');

        const slides: ParsedSlide[] = session.slidesJson ? JSON.parse(session.slidesJson) : [];
        const slide = slides.find(s => s.index === slideIndex) || slides[slideIndex];
        if (!slide) throw new NotFoundException(`Slide ${slideIndex} not found`);

        const bulletsText = Array.isArray(slide.optimizedContent) && slide.optimizedContent.length > 0
            ? slide.optimizedContent.map(b => `${b.point}: ${b.description}`).join('; ')
            : (Array.isArray(slide.content) ? slide.content.join('; ') : '');
        const subjectContext = session.pptxSubject?.name ? `Course: ${session.pptxSubject.name}. ` : '';
        const visualSource = `${subjectContext}Slide topic: "${slide.title}". Key concepts: ${bulletsText.substring(0, 350)}`;

        let imagePrompt = `Educational slide illustration for "${slide.title}": ${visualSource}. Style: Clean, modern, professional academic illustration, no random garbled text.`;

        const modelConfig = await this.modelConfigService.getModelForTask(userId, 'IMAGE');
        const apiKey = await this.apiKeysService.getActiveKey(userId, APIService.GEMINI);

        const isImageGenProvider = modelConfig.provider === 'IMAGE_GEN'
            || modelConfig.modelName.toLowerCase().includes('flux')
            || modelConfig.modelName.startsWith('imagegen:');

        if (isImageGenProvider) {
            try {
                const lang = session.language || session.pptxSubject?.language || 'vi';
                if (lang === 'vi' || lang === 'vi-en') {
                    imagePrompt = await this.geminiService.optimizeFluxPrompt(visualSource, slide.title);
                }
            } catch (err: any) {
                this.logger.warn(`Flux prompt optimization skipped: ${err.message}`);
            }
        }

        let effectiveModelName = modelConfig.modelName;
        if (modelConfig.provider === 'CLIPROXY' && !modelConfig.modelName.startsWith('cliproxy:')) {
            effectiveModelName = `cliproxy:${modelConfig.modelName}`;
        } else if (isImageGenProvider && !modelConfig.modelName.startsWith('imagegen:') && !modelConfig.modelName.toLowerCase().includes('flux')) {
            effectiveModelName = `imagegen:${modelConfig.modelName}`;
        }

        const effectiveApiKey = apiKey || process.env.GEMINI_API_KEY || undefined;

        let generatedImage: GeneratedImage | null = null;
        let lastError: any = null;
        for (let attempt = 0; attempt <= 2; attempt++) {
            try {
                if (attempt > 0) {
                    await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
                }
                generatedImage = await this.imagenService.generateImage(
                    imagePrompt,
                    '1:1',
                    effectiveModelName,
                    effectiveApiKey,
                    userId,
                );
                if (generatedImage && generatedImage.mimeType !== 'image/svg+xml') {
                    break;
                }
            } catch (err: any) {
                lastError = err;
            }
        }

        if (!generatedImage) {
            throw new BadRequestException(`Không thể tạo hình ảnh minh họa: ${lastError?.message || 'Lỗi kết nối AI'}`);
        }

        const mimeMap: Record<string, string> = {
            'image/png': 'png',
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/webp': 'webp',
            'image/svg+xml': 'svg',
        };
        const ext = mimeMap[generatedImage.mimeType] || 'png';
        const imagesDir = path.join(this.getSessionDir(sessionId), 'images');
        if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir, { recursive: true });
        }

        const fileName = `slide_${slideIndex + 1}_ai_${Date.now()}.${ext}`;
        const filePath = path.join(imagesDir, fileName);
        fs.writeFileSync(filePath, Buffer.from(generatedImage.base64, 'base64'));

        slide.imageUrl = `/uploads/pptx-tool/${sessionId}/images/${fileName}`;
        slide.hasCustomImage = true;
        if (slide.layoutType === 'full_slide_canvas') {
            slide.layoutType = 'split_standard';
        }
        await this.saveSlidesAndSyncContent(sessionId, slides);

        return slide;
    }

    async uploadExtraAudio(
        sessionId: string,
        slideIndex: number,
        userId: string,
        file: Express.Multer.File,
    ) {
        if (!file) throw new BadRequestException('Vui lòng chọn file âm thanh.');
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
        });
        if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
        if (session.userId !== userId) throw new BadRequestException('Not authorized');

        const slides: ParsedSlide[] = session.slidesJson ? JSON.parse(session.slidesJson) : [];
        const slide = slides.find(s => s.index === slideIndex) || slides[slideIndex];
        if (!slide) throw new NotFoundException(`Slide ${slideIndex} not found`);

        const audioDir = this.getAudioDir(sessionId);
        if (slide.extraAudioUrl) {
            try {
                const oldPath = path.join(process.cwd(), slide.extraAudioUrl.split('?')[0].replace(/^\//, ''));
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            } catch { /* ignore */ }
        }

        const safeOrigName = fixUtf8Filename(file.originalname || 'sample_audio.mp3');
        const ext = path.extname(safeOrigName).replace('.', '') || 'mp3';
        const fileName = `slide_${String(slideIndex).padStart(2, '0')}_extra_${Date.now()}.${ext}`;
        const filePath = path.join(audioDir, fileName);

        const buf = file.buffer && file.buffer.length > 0
            ? file.buffer
            : (file.path && fs.existsSync(file.path) ? fs.readFileSync(file.path) : Buffer.alloc(0));
        fs.writeFileSync(filePath, buf);
        if (file.path && fs.existsSync(file.path)) {
            try { fs.unlinkSync(file.path); } catch { /* ignore */ }
        }

        slide.extraAudioUrl = `/uploads/pptx-tool/${sessionId}/audio/${fileName}`;
        slide.extraAudioName = safeOrigName;
        await this.saveSlidesAndSyncContent(sessionId, slides);

        return slide;
    }

    async deleteExtraAudio(sessionId: string, slideIndex: number, userId: string) {
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
        });
        if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
        if (session.userId !== userId) throw new BadRequestException('Not authorized');

        const slides: ParsedSlide[] = session.slidesJson ? JSON.parse(session.slidesJson) : [];
        const slide = slides.find(s => s.index === slideIndex) || slides[slideIndex];
        if (!slide) throw new NotFoundException(`Slide ${slideIndex} not found`);

        if (slide.extraAudioUrl) {
            try {
                const oldPath = path.join(process.cwd(), slide.extraAudioUrl.split('?')[0].replace(/^\//, ''));
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            } catch { /* ignore */ }
        }

        slide.extraAudioUrl = null;
        slide.extraAudioName = null;
        slide.extraAudioDuration = null;
        await this.saveSlidesAndSyncContent(sessionId, slides);

        return slide;
    }

    async generateSlideInteractions(
        sessionId: string,
        slideIndex: number,
        userId: string,
        requestedType?: string,
        options?: {
            mode?: 'generate_new' | 'extract_existing';
            sourceType?: 'slide_range' | 'custom_text' | 'current_slide' | 'audio' | 'image';
            fromSlideIndex?: number;
            toSlideIndex?: number;
            customContent?: string;
            imageBase64?: string;
            selectedQuestionTypes?: string[];
            questionCount?: number;
            passScore?: number;
            fallbackSlideIndex?: number;
            allowContinueWithoutPass?: boolean;
        },
    ) {
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
            include: { pptxSubject: true },
        });
        if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
        if (session.userId !== userId) throw new BadRequestException('Not authorized');

        const slides: ParsedSlide[] = session.slidesJson ? JSON.parse(session.slidesJson) : [];
        const slide = slides.find(s => s.index === slideIndex) || slides[slideIndex];
        if (!slide) throw new NotFoundException(`Slide ${slideIndex} not found`);

        const oneBasedSlideNumber = slide.index + 1;
        let content = '';
        const isExtractMode = options?.mode === 'extract_existing';
        const sourceType = options?.sourceType || (isExtractMode ? 'custom_text' : 'current_slide');

        if (sourceType === 'slide_range' && options?.fromSlideIndex && options?.toSlideIndex && !isExtractMode) {
            const fromIdx = Math.min(Number(options.fromSlideIndex), Number(options.toSlideIndex));
            const toIdx = Math.max(Number(options.fromSlideIndex), Number(options.toSlideIndex));
            const rangeSlides = slides.filter(s => (s.index + 1) >= fromIdx && (s.index + 1) <= toIdx);
            content = rangeSlides.map(s => {
                let sBody = Array.isArray(s.content) ? s.content.join('\n') : String(s.content || '');
                if (Array.isArray(s.optimizedContent) && s.optimizedContent.length > 0) {
                    sBody = s.optimizedContent.map(p => `${p.emoji || '•'} ${p.point}: ${p.description || ''}`).join('\n');
                }
                const note = s.noteVN || s.noteEN || s.noteFull || '';
                return `[Slide ${s.index + 1}: ${s.title}]\n${sBody}\n${note ? `Lời giảng: ${note}\n` : ''}`;
            }).join('\n\n');
            if (session.contextText && session.contextText.trim()) {
                content += `\n\n[Tài liệu tham khảo bổ sung của bài học]:\n${session.contextText.trim().substring(0, 12000)}`;
            }
        } else if ((sourceType === 'custom_text' || isExtractMode || sourceType === 'audio' || sourceType === 'image') && options?.customContent) {
            content = `[Nội dung tài liệu/đề bài do giáo viên cung cấp]:\n${options.customContent}`;
        } else {
            if (Array.isArray(slide.optimizedContent) && slide.optimizedContent.length > 0) {
                content = slide.optimizedContent.map(p => `${p.emoji || '•'} ${p.point}: ${p.description || ''}`).join('\n');
            } else {
                content = Array.isArray(slide.content) ? slide.content.join('\n') : String(slide.content || '');
            }
        }

        const hasAudioSample = !!(slide.extraAudioUrl || slide.extraAudioName);
        const subjectName = session.pptxSubject?.name || '';
        const courseName = session.pptxSubject?.courseName || '';
        const targetAudience = session.pptxSubject?.targetAudience || 'Sinh viên đại học';
        const lessonTitle = session.lessonTitle || fixUtf8Filename(session.fileName).replace(/\.pptx$/i, '');

        const selectedTypes = (options?.selectedQuestionTypes && options.selectedQuestionTypes.length > 0)
            ? options.selectedQuestionTypes
            : ['MC', 'TF', 'MR', 'FIB', 'MATCH', 'ORDER', 'CLOZE'];

        const typeLabels: Record<string, string> = {
            MC: 'Trắc nghiệm đơn 1 đáp án đúng (type: "MC", options: 4 lựa chọn A, B, C, D, correctAnswer: "chuỗi đáp án đúng")',
            TF: 'Đúng hay Sai (type: "TF", options: ["Đúng", "Sai"], correctAnswer: "Đúng" hoặc "Sai")',
            MR: 'Nhiều lựa chọn đúng (type: "MR", options: 4 lựa chọn, correctAnswers: [mảng chứa các đáp án đúng])',
            FIB: 'Điền khuyết từ/thuật ngữ có phương án lựa chọn (type: "FIB", question: câu hỏi chứa ký hiệu [.....], options: [mảng 4 từ/cụm từ gồm 1 đáp án đúng và 3 phương án nhiễu hợp lý để sinh viên chọn], correctAnswer: "từ hoặc cụm từ đúng nằm trong options")',
            MATCH: 'Nối cặp tương ứng hai vế A và B (type: "MATCH", question: "Yêu cầu nối...", pairs: [ { "left": "Khái niệm/Thuật ngữ vế A", "right": "Định nghĩa/Ý nghĩa vế B tương ứng" }, ... ])',
            ORDER: 'Sắp xếp thứ tự từ trong câu (type: "ORDER", question: "Sắp xếp các từ sau thành câu hoàn chỉnh:", words: ["mảng", "từ", "bị", "xáo", "trộn"], correctSentence: "Câu hoàn chỉnh đúng chuẩn ngữ pháp")',
            CLOZE: 'Điền từ vào chỗ trống trong đoạn văn hoặc hội thoại bằng menu lựa chọn (type: "CLOZE", question: "Chọn từ/cụm từ thích hợp cho các chỗ trống:", passage: "Đoạn văn hoặc kịch bản hội thoại với các từ cần điền đặt trong ngoặc vuông [từ_cần_điền] (Ví dụ: A: Hello, how are [you]?\\nB: I am [fine], thanks.)", distractors: ["từ nhiễu 1", "từ nhiễu 2", "từ nhiễu 3"], explanation: "Giải thích ngữ cảnh...")',
        };

        const typesRequirementText = selectedTypes.map(t => `- ${typeLabels[t] || t}`).join('\n');
        const questionCount = options?.questionCount ? Number(options.questionCount) : 5;
        const passScore = options?.passScore !== undefined ? Number(options.passScore) : (questionCount >= 5 ? 4 : Math.max(1, questionCount - 1));
        const fallbackSlideIndex = options?.fallbackSlideIndex !== undefined ? Number(options.fallbackSlideIndex) : (options?.fromSlideIndex || Math.max(1, oneBasedSlideNumber - 1));

        let promptText = '';
        if (isExtractMode) {
            promptText = `
Bạn là CHUYÊN GIA SỐ HÓA VÀ TRÍCH XUẤT ĐỀ THI TỰ ĐỘNG (EXAM QUESTION EXTRACTOR) theo chuẩn Moodle / SCORM / H5P.
Giáo viên ĐÃ CÓ SẴN CÂU HỎI TRONG TÀI LIỆU DƯỚI ĐÂY. Nhiệm vụ của bạn là ĐỌC VÀ TRÍCH XUẤT CHÍNH XÁC CÁC CÂU HỎI ĐÓ, KHÔNG TỰ BỊA RA CÂU HỎI MỚI.

TÀI LIỆU / ĐỀ BÀI DO GIÁO VIÊN CUNG CẤP:
${content || '(Chưa có nội dung đề bài dạng text)'}
${options?.imageBase64 ? '\n[LƯU Ý ĐẶC BIỆT TỪ ẢNH ĐÍNH KÈM]: Giáo viên có gửi kèm HÌNH ẢNH CHỤP ĐỀ BÀI / SÁCH BÀI TẬP. Bạn hãy OCR đọc thật kỹ chữ và câu hỏi từ hình ảnh được đính kèm này để trích xuất đầy đủ, chính xác từng câu hỏi và đáp án!\n' : ''}
QUY TẮC TRÍCH XUẤT BẮT BUỘC:
1. TRÍCH XUẤT NGUYÊN VĂN: Giữ đúng câu hỏi, các phương án lựa chọn (A, B, C, D...) và nội dung nguyên bản của giáo viên.
2. PHÂN LOẠI DẠNG CÂU HỎI CHÍNH XÁC: "MC", "TF", "MR", "FIB", "MATCH", "ORDER", "CLOZE".
3. XÁC ĐỊNH ĐÁP ÁN ĐÚNG kèm giải thích ngắn gọn (explanation).
4. SỐ LƯỢNG & CHUẨN ĐẠT:
   - Trích xuất tối đa ${questionCount} câu.
   - Chuẩn đạt tối thiểu (passScore): ${passScore}.
   - Slide quay lại ôn tập nếu không đạt: Slide ${fallbackSlideIndex}.

YÊU CẦU ĐẦU RA (CHỈ TRẢ VỀ JSON HỢP LỆ):
{
  "activityType": "${requestedType || (hasAudioSample ? 'listening_comprehension' : 'checkpoint_quiz')}",
  "badgeLabel": "${hasAudioSample ? '🎧 Bài tập nghe hiểu' : '🎯 Kiểm tra kiến thức (Chặn bài)'}",
  "instruction": "Hãy trả lời các câu hỏi kiểm tra dưới đây",
  "passScore": ${passScore},
  "totalQuestions": ${questionCount},
  "fallbackSlideIndex": ${fallbackSlideIndex},
  "allowContinueWithoutPass": ${options?.allowContinueWithoutPass === true},
  "hideSolutions": ${!hasAudioSample},
  "questions": [
    {
      "id": "q1",
      "type": "MC",
      "question": "Nội dung câu hỏi...",
      "options": ["Lựa chọn A", "Lựa chọn B", "Lựa chọn C", "Lựa chọn D"],
      "correctAnswer": "Lựa chọn A",
      "explanation": "Giải thích chi tiết..."
    }
  ]
}`;
        } else {
            const slideNote = slide.noteVN || slide.noteEN || slide.noteFull || '';
            promptText = `
Bạn là chuyên gia thiết kế sư phạm và học liệu điện tử tương tác cao (Instructional Designer) theo chuẩn Moodle / H5P / SCORM.
Hãy tạo 1 hoạt động tương tác (Interactive Activity) tốt nhất cho Slide học sau:

THÔNG TIN BÀI HỌC:
- Môn học: ${subjectName} (${courseName})
- Đối tượng: ${targetAudience}
- Bài học: ${lessonTitle}
- Slide số: ${oneBasedSlideNumber}
- Tiêu đề slide: ${slide.title}
${sourceType === 'slide_range' ? `- NGUỒN KIẾN THỨC TỔNG HỢP TỪ CÁC SLIDE (${options?.fromSlideIndex} ĐẾN ${options?.toSlideIndex}):` : '- Nội dung kiến thức nguồn:'}
${content || '(Dựa vào tiêu đề slide)'}
${slideNote && sourceType !== 'slide_range' ? `- Lời giảng thuyết minh: ${slideNote}` : ''}
${hasAudioSample ? `- Slide có TỆP ÂM THANH MẪU: "${slide.extraAudioName || 'Audio mẫu'}" (Hãy ưu tiên tạo bài tập nghe hiểu hoặc nghe chép chính tả dựa trên ngữ cảnh này!)` : ''}
${requestedType ? `- Loại tương tác được yêu cầu: ${requestedType}` : ''}

QUY ĐỊNH BẮT BUỘC VỀ DẠNG CÂU HỎI:
CHỈ ĐƯỢC TẠO các câu hỏi thuộc đúng các dạng sau đây:
${typesRequirementText}
TUYỆT ĐỐI KHÔNG sinh dạng câu hỏi nằm ngoài danh sách được phép trên!

YÊU CẦU SỐ LƯỢNG & CHUẨN ĐẠT:
- Hãy sinh CHÍNH XÁC đúng ${questionCount} câu hỏi (phân bố đều các dạng đã chọn ở trên).
- Chuẩn đạt tối thiểu: ${passScore}/${questionCount} câu.
- Slide quay lại ôn tập nếu không đạt: Slide ${fallbackSlideIndex}.
- Chính sách cho phép qua slide: ${options?.allowContinueWithoutPass ? 'Cho phép sinh viên tiếp tục học kể cả chưa đạt điểm chuẩn' : 'Bắt buộc đạt chuẩn mới được qua slide'}.

YÊU CẦU ĐẦU RA (CHỈ TRẢ VỀ JSON HỢP LỆ):
{
  "activityType": "${requestedType || (hasAudioSample ? 'listening_comprehension' : 'checkpoint_quiz')}",
  "badgeLabel": "${hasAudioSample ? '🎧 Bài tập nghe hiểu' : (options?.allowContinueWithoutPass ? '📝 Luyện tập & Khảo sát quan điểm' : '🎯 Kiểm tra kiến thức (Chặn bài)')}",
  "instruction": "Hướng dẫn ngắn gọn cho sinh viên thực hiện bài tập",
  "passScore": ${passScore},
  "totalQuestions": ${questionCount},
  "fallbackSlideIndex": ${fallbackSlideIndex},
  "allowContinueWithoutPass": ${options?.allowContinueWithoutPass === true},
  "hideSolutions": ${!hasAudioSample},
  "questions": [
    {
      "id": "q1",
      "type": "${selectedTypes[0] || 'MC'}",
      "question": "Nội dung câu hỏi...",
      "options": ["Đáp án A", "Đáp án B", "Đáp án C", "Đáp án D"],
      "correctAnswer": "Đáp án A",
      "explanation": "Giải thích chi tiết..."
    }
  ]
}`;
        }

        const modelConfig = await this.modelConfigService.getModelForTask(userId, 'QUESTIONS');
        const aiResult = await this.aiProvider.generateText(
            promptText,
            modelConfig.modelName || 'gemini-2.5-flash',
            userId,
            { imageBase64: options?.imageBase64 },
        );
        const rawContent = aiResult.content || '';

        let parsedInteractive: any = null;
        try {
            const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, rawContent];
            const cleanJson = (jsonMatch[1] || rawContent).trim();
            parsedInteractive = JSON.parse(cleanJson);
        } catch (err: any) {
            this.logger.error(`Failed to parse AI interactive JSON: ${err.message}`);
            parsedInteractive = {
                activityType: requestedType || (hasAudioSample ? 'listening_comprehension' : 'checkpoint_quiz'),
                badgeLabel: hasAudioSample ? '🎧 Bài tập nghe hiểu' : (options?.allowContinueWithoutPass ? '📝 Luyện tập & Khảo sát quan điểm' : '🎯 Kiểm tra kiến thức (Chặn bài)'),
                instruction: 'Trả lời các câu hỏi kiểm tra kiến thức để mở khóa bài học tiếp theo',
                passScore,
                totalQuestions: questionCount,
                fallbackSlideIndex,
                allowContinueWithoutPass: options?.allowContinueWithoutPass === true,
                hideSolutions: !hasAudioSample,
                questions: [
                    {
                        id: 'q1',
                        type: 'MC',
                        question: `Kiến thức trọng tâm của ${slide.title} là gì?`,
                        options: ['Phương án A', 'Phương án B', 'Phương án C', 'Phương án D'],
                        correctAnswer: 'Phương án A',
                        explanation: 'Vui lòng xem lại nội dung bài học để nắm rõ kiến thức.',
                    },
                ],
            };
        }

        if (Array.isArray(parsedInteractive.questions)) {
            parsedInteractive.questions = normalizeInteractiveQuestions(parsedInteractive.questions);
        }
        parsedInteractive.passScore = passScore;
        parsedInteractive.fallbackSlideIndex = fallbackSlideIndex;
        parsedInteractive.allowContinueWithoutPass = options?.allowContinueWithoutPass === true;
        parsedInteractive.totalQuestions = parsedInteractive.questions?.length || questionCount;

        slide.interactiveData = JSON.stringify(parsedInteractive);
        slide.slideType = requestedType || (hasAudioSample ? 'interactive_audio' : 'checkpoint_quiz');
        slide.layoutType = hasAudioSample ? 'audio_lab' : 'checkpoint_gate';

        await this.saveSlidesAndSyncContent(sessionId, slides);

        return {
            ...slide,
            interactiveDataParsed: parsedInteractive,
        };
    }

    async exportMoodleXml(sessionId: string, res: Response) {
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
        });
        if (!session) throw new NotFoundException(`Session ${sessionId} not found`);

        const slides: ParsedSlide[] = session.slidesJson ? JSON.parse(session.slidesJson) : [];
        const questions: any[] = [];

        for (const slide of slides) {
            if (!slide.interactiveData) continue;
            try {
                const data = typeof slide.interactiveData === 'string'
                    ? JSON.parse(slide.interactiveData)
                    : slide.interactiveData;
                const qList = Array.isArray(data?.questions) ? data.questions : [];
                qList.forEach((q: any, qIdx: number) => {
                    questions.push({
                        slideIndex: slide.index + 1,
                        slideTitle: slide.title,
                        questionId: `Slide${slide.index + 1}-Q${qIdx + 1}`,
                        question: q.question,
                        correctAnswer: q.correctAnswer || (Array.isArray(q.correctAnswers) ? q.correctAnswers[0] : ''),
                        options: q.options || [],
                        explanation: q.explanation || '',
                        type: q.type || 'MC',
                        badgeLabel: data.badgeLabel || 'Hoạt động tương tác',
                    });
                });
            } catch { /* ignore */ }
        }

        // Also include session-level interactive questions if no slide had interactiveData
        if (questions.length === 0) {
            const allQuestions = await this.getSessionQuestions(sessionId);
            const interactiveList = Array.isArray(allQuestions.interactive) ? allQuestions.interactive : [];
            interactiveList.forEach((q: any, qIdx: number) => {
                const rawAnswers: string[] = Array.isArray(q.answers) ? q.answers : [];
                const options = rawAnswers.map(a => String(a).replace(/^\*/, '').trim()).filter(Boolean);
                const correctAnswers = rawAnswers
                    .filter(a => String(a).startsWith('*'))
                    .map(a => String(a).replace(/^\*/, '').trim())
                    .filter(Boolean);
                questions.push({
                    slideIndex: 1,
                    slideTitle: session.lessonTitle || 'Bài giảng',
                    questionId: `Interactive-Q${qIdx + 1}`,
                    question: q.questionText || '',
                    correctAnswer: correctAnswers[0] || options[0] || '',
                    options,
                    explanation: q.correctFeedback || q.incorrectFeedback || '',
                    type: q.questionType || 'MC',
                    badgeLabel: 'Hoạt động tương tác',
                });
            });
        }

        const lessonTitle = session.lessonTitle?.trim() || fixUtf8Filename(session.fileName).replace(/\.pptx$/i, '') || 'lesson';
        const safeTitle = lessonTitle
            .replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF ]/g, '_')
            .replace(/\s+/g, '_')
            .replace(/^_+|_+$/g, '') || 'lesson';

        const str = (v: any) => (v === null || v === undefined ? '' : String(v)).trim();

        let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<quiz>\n`;
        xml += `  <question type="category">\n    <category>\n      <text>$course$/top/${escapeXmlText(safeTitle)}</text>\n    </category>\n  </question>\n\n`;

        for (const q of questions) {
            const correct = str(q.correctAnswer);
            const otherOptions = (Array.isArray(q.options) ? q.options : [])
                .map(str)
                .filter((opt: string) => opt !== '' && opt !== correct);
            if (!correct || otherOptions.length === 0 || !str(q.question)) {
                continue;
            }
            const feedbackParts = [`<strong>Đáp án đúng là: </strong>${escapeForCdata(correct)}`];
            if (q.explanation) {
                feedbackParts.push(`<strong>Vì: </strong>${escapeForCdata(q.explanation)}`);
            }
            const feedbackHtml = feedbackParts.map((p) => `<p>${p}</p>`).join('\n      ');
            const question = str(q.question);

            xml += `  <question type="multichoice">\n`;
            xml += `    <name><text>${escapeXmlText(`Slide ${q.slideIndex}: ${question.substring(0, 120)}`)}</text></name>\n`;
            xml += `    <questiontext format="html">\n`;
            xml += `      <text><![CDATA[<p><strong>[${escapeForCdata(q.badgeLabel)} - Slide ${q.slideIndex}: ${escapeForCdata(q.slideTitle)}]</strong></p><p>${escapeForCdata(question)}</p>]]></text>\n`;
            xml += `    </questiontext>\n`;
            xml += `    <generalfeedback format="html">\n`;
            xml += `      <text><![CDATA[${feedbackHtml}]]></text>\n`;
            xml += `    </generalfeedback>\n`;
            xml += `    <defaultgrade>1.0000000</defaultgrade>\n`;
            xml += `    <penalty>0.3333333</penalty>\n`;
            xml += `    <hidden>0</hidden>\n`;
            xml += `    <single>true</single>\n`;
            xml += `    <shuffleanswers>true</shuffleanswers>\n`;
            xml += `    <answernumbering>ABCD</answernumbering>\n`;

            xml += `    <answer fraction="100" format="html">\n`;
            xml += `      <text><![CDATA[<p>${escapeForCdata(correct)}</p>]]></text>\n`;
            xml += `      <feedback format="html"><text><![CDATA[<p>Chính xác!</p>]]></text></feedback>\n`;
            xml += `    </answer>\n`;

            for (const distractor of otherOptions) {
                xml += `    <answer fraction="0" format="html">\n`;
                xml += `      <text><![CDATA[<p>${escapeForCdata(distractor)}</p>]]></text>\n`;
                xml += `      <feedback format="html"><text><![CDATA[<p>Chưa chính xác.</p>]]></text></feedback>\n`;
                xml += `    </answer>\n`;
            }
            xml += `  </question>\n\n`;
        }

        xml += `</quiz>\n`;

        const fileName = `${safeTitle}_moodle_quiz.xml`;
        res.attachment(fileName);
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.send(xml);
    }

    // ========== 8B. EXPORT SCORM 1.2 & H5P ==========

    async getTemplates(userId?: string) {
        return this.prisma.pPTXTemplate.findMany({
            where: {
                isActive: true,
                OR: [
                    { isSystem: true },
                    ...(userId ? [{ userId }] : []),
                ],
            },
            orderBy: [
                { isDefault: 'desc' },
                { name: 'asc' },
            ],
        });
    }

    private async renderPptxSlidesLocallyFallback(pptxPath: string, renderedDir: string): Promise<boolean> {
        let tmpWorkDir: string | null = null;
        try {
            fs.mkdirSync(renderedDir, { recursive: true });
            tmpWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-render-ts-'));
            const loProfileDir = path.join(tmpWorkDir, 'lo_profile');
            const pdfDir = path.join(tmpWorkDir, 'pdf_out');
            const ppmDir = path.join(tmpWorkDir, 'ppm_out');
            fs.mkdirSync(loProfileDir, { recursive: true });
            fs.mkdirSync(pdfDir, { recursive: true });
            fs.mkdirSync(ppmDir, { recursive: true });

            await execFileAsync(
                'soffice',
                [
                    `-env:UserInstallation=file://${loProfileDir}`,
                    '--headless',
                    '--nologo',
                    '--nofirststartwizard',
                    '--norestore',
                    '--convert-to',
                    'pdf',
                    '--outdir',
                    pdfDir,
                    pptxPath,
                ],
                { timeout: 120000 },
            );

            const pdfFiles = fs.readdirSync(pdfDir).filter(f => f.toLowerCase().endsWith('.pdf'));
            if (pdfFiles.length === 0) {
                return false;
            }
            const pdfPath = path.join(pdfDir, pdfFiles[0]);
            const pagePrefix = path.join(ppmDir, 'slide_page');

            await execFileAsync(
                'pdftoppm',
                ['-png', '-r', '150', pdfPath, pagePrefix],
                { timeout: 120000 },
            );

            const pngPages = fs
                .readdirSync(ppmDir)
                .filter(f => f.startsWith('slide_page') && f.toLowerCase().endsWith('.png'))
                .sort((a, b) => {
                    const numA = parseInt((a.match(/(\d+)\.png$/i) || [])[1] || '0', 10);
                    const numB = parseInt((b.match(/(\d+)\.png$/i) || [])[1] || '0', 10);
                    return numA - numB;
                });

            pngPages.forEach((pageFile, idx) => {
                const destName = `full_slide_${String(idx).padStart(2, '0')}.png`;
                fs.copyFileSync(path.join(ppmDir, pageFile), path.join(renderedDir, destName));
            });

            return pngPages.length > 0;
        } catch (err: any) {
            this.logger.warn(`Local LibreOffice slide render fallback skipped: ${err?.message || err}`);
            return false;
        } finally {
            if (tmpWorkDir && fs.existsSync(tmpWorkDir)) {
                try {
                    fs.rmSync(tmpWorkDir, { recursive: true, force: true });
                } catch { /* ignore */ }
            }
        }
    }

    async ensureRenderedSlidesForSession(sessionId: string): Promise<ParsedSlide[]> {
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
        });
        if (!session) {
            throw new NotFoundException(`Session ${sessionId} not found`);
        }

        const slides: ParsedSlide[] = session.slidesJson ? JSON.parse(session.slidesJson) : [];
        if (slides.length === 0) {
            return slides;
        }

        const origSlides = slides.filter(s => {
            const origIdx = s.originalSlideIndex !== undefined ? s.originalSlideIndex : s.index;
            return origIdx !== null && origIdx >= 0;
        });
        if (origSlides.length === 0) {
            return slides;
        }

        const allAlreadyRendered = origSlides.every(s => {
            if (!s.renderedSlideUrl) return false;
            const localFile = resolveLocalMediaFile(s.renderedSlideUrl);
            return Boolean(localFile && fs.existsSync(localFile));
        });
        if (allAlreadyRendered) {
            return slides;
        }

        const sessionDir = this.getSessionDir(sessionId);
        const renderedDir = path.join(sessionDir, 'rendered_slides');
        const candidatePptxPath = (session.filePath && fs.existsSync(session.filePath))
            ? session.filePath
            : path.join(sessionDir, 'original.pptx');

        const missingOnDisk = origSlides.some(s => {
            const origIdx = (s.originalSlideIndex !== undefined ? s.originalSlideIndex : s.index) as number;
            const expectedPath = path.join(renderedDir, `full_slide_${String(origIdx).padStart(2, '0')}.png`);
            return !fs.existsSync(expectedPath);
        });

        if (missingOnDisk && fs.existsSync(candidatePptxPath)) {
            let renderedByPython = false;
            try {
                const resp = await fetch(`${this.pythonServiceUrl}/render-pptx-slides`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ file_path: candidatePptxPath }),
                });
                if (resp.ok) {
                    const data = await resp.json() as { renderedCount?: number };
                    renderedByPython = (data?.renderedCount || 0) > 0;
                } else {
                    this.logger.warn(`Python /render-pptx-slides returned HTTP ${resp.status}`);
                }
            } catch (err: any) {
                this.logger.warn(`Python /render-pptx-slides unreachable (${err?.message || err}); trying local fallback`);
            }

            if (!renderedByPython) {
                await this.renderPptxSlidesLocallyFallback(candidatePptxPath, renderedDir);
            }
        }

        let updated = false;
        for (const s of slides) {
            const origIdx = s.originalSlideIndex !== undefined ? s.originalSlideIndex : s.index;
            if (origIdx === null || origIdx < 0) continue;

            const fileName = `full_slide_${String(origIdx).padStart(2, '0')}.png`;
            const diskPath = path.join(renderedDir, fileName);
            if (fs.existsSync(diskPath)) {
                const publicRenderedUrl = `/uploads/pptx-tool/${sessionId}/rendered_slides/${fileName}`;
                const wasUnrenderedLegacySlide = !s.renderedSlideUrl;
                if (s.renderedSlideUrl !== publicRenderedUrl) {
                    s.renderedSlideUrl = publicRenderedUrl;
                    updated = true;
                }
                const hasCustomOrAiImg =
                    s.hasCustomImage === true ||
                    String(s.imageUrl || '').includes('_custom_') ||
                    String(s.imageUrl || '').includes('_ai_');
                const hasOptBullets = Array.isArray(s.optimizedContent) && s.optimizedContent.length > 0;
                const isSpecialInteractive =
                    s.slideType === 'interactive' ||
                    s.slideType === 'checkpoint_quiz' ||
                    s.slideType === 'interactive_audio';
                if (!hasCustomOrAiImg && s.imageUrl !== publicRenderedUrl) {
                    s.imageUrl = publicRenderedUrl;
                    updated = true;
                }
                if (
                    wasUnrenderedLegacySlide &&
                    !hasCustomOrAiImg &&
                    !hasOptBullets &&
                    !isSpecialInteractive &&
                    (!s.layoutType || s.layoutType === 'split_standard')
                ) {
                    s.layoutType = 'full_slide_canvas';
                    updated = true;
                }
            }
        }

        if (updated) {
            await this.saveSlidesAndSyncContent(sessionId, slides);
        }

        return slides;
    }

    private async buildExportSlidesForSession(sessionId: string, forH5p = false) {
        await this.ensureRenderedSlidesForSession(sessionId);

        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
            include: { pptxSubject: true },
        });
        if (!session) {
            throw new NotFoundException(`Session ${sessionId} not found`);
        }

        const parsedSlides: ParsedSlide[] = session.slidesJson ? JSON.parse(session.slidesJson) : [];
        if (parsedSlides.length === 0) {
            throw new BadRequestException('Không có slide nào trong bài học để xuất.');
        }

        const activeLang = session.language || 'vi';
        let hasInlineInteractiveSlide = false;
        const exportSlides: any[] = parsedSlides.map((s, idx) => {
            const speakerNote = activeLang === 'en'
                ? (s.noteEN || s.noteVN || s.noteFull || '')
                : (s.noteVN || s.noteEN || s.noteFull || '');
            if (s.interactiveData) {
                hasInlineInteractiveSlide = true;
            }

            const origIdx = s.originalSlideIndex !== undefined ? s.originalSlideIndex : s.index;
            const hasCustomOrAiImage =
                s.hasCustomImage === true ||
                String(s.imageUrl || '').includes('_custom_') ||
                String(s.imageUrl || '').includes('_ai_');
            const hasOptimizedBullets = Array.isArray(s.optimizedContent) && s.optimizedContent.length > 0;
            const isSpecialInteractiveSlide =
                s.slideType === 'interactive' ||
                s.slideType === 'checkpoint_quiz' ||
                s.slideType === 'interactive_audio';
            const effectiveRenderedUrl =
                s.renderedSlideUrl ||
                (String(s.imageUrl || '').includes('/rendered_slides/full_slide_') ? s.imageUrl : null);

            const useFullSlideCanvas =
                Boolean(effectiveRenderedUrl) && (
                    s.layoutType === 'full_slide_canvas' ||
                    (
                        !s.layoutType &&
                        origIdx !== null &&
                        origIdx >= 0 &&
                        !hasCustomOrAiImage &&
                        !hasOptimizedBullets &&
                        !isSpecialInteractiveSlide
                    )
                );

            return {
                slideIndex: idx + 1,
                slideType: s.slideType || (idx === 0 ? 'title' : 'content'),
                layoutType: useFullSlideCanvas ? 'full_slide_canvas' : (s.layoutType || 'split_standard'),
                title: s.title || `Slide ${idx + 1}`,
                content: Array.isArray(s.content) ? s.content : [],
                optimizedContentJson: hasOptimizedBullets
                    ? JSON.stringify(s.optimizedContent)
                    : null,
                speakerNote,
                imageUrl: useFullSlideCanvas ? (effectiveRenderedUrl || '') : (s.imageUrl || ''),
                audioUrl: (s.audioStatus === 'done' && s.audioUrl) ? s.audioUrl : '',
                extraAudioUrl: s.extraAudioUrl || null,
                extraAudioName: s.extraAudioName || null,
                interactiveData: s.interactiveData || null,
            };
        });

        // If no inline interactive/checkpoint slide has been configured yet,
        // fallback to attaching session-level interactive questions at the end.
        if (!hasInlineInteractiveSlide) {
            const allQuestions = await this.getSessionQuestions(sessionId);
            const interactiveList = Array.isArray(allQuestions.interactive) ? allQuestions.interactive : [];
            if (interactiveList.length > 0) {
                const mappedQuestions = interactiveList.map((q: any) => {
                    const rawAnswers: string[] = Array.isArray(q.answers) ? q.answers : [];
                    const options = rawAnswers
                        .map(a => String(a).replace(/^\*/, '').trim())
                        .filter(Boolean);
                    const correctAnswers = rawAnswers
                        .filter(a => String(a).startsWith('*'))
                        .map(a => String(a).replace(/^\*/, '').trim())
                        .filter(Boolean);
                    const correctAnswer = correctAnswers[0] || options[0] || '';
                    return {
                        question: (q.questionText || '').trim(),
                        type: (q.questionType || 'MC').toUpperCase(),
                        options,
                        correctAnswer,
                        correctAnswers,
                        explanation: q.correctFeedback || q.incorrectFeedback || '',
                    };
                }).filter(mq => mq.question && mq.options.length >= 2);

                if (mappedQuestions.length > 0) {
                    if (forH5p) {
                        mappedQuestions.forEach((mq, idx) => {
                            exportSlides.push({
                                slideIndex: exportSlides.length + 1,
                                slideType: 'interactive',
                                layoutType: 'checkpoint_gate',
                                title: mappedQuestions.length > 1
                                    ? `Câu hỏi tương tác (${idx + 1}/${mappedQuestions.length})`
                                    : 'Câu hỏi tương tác',
                                content: [mq.question],
                                speakerNote: '',
                                imageUrl: '',
                                audioUrl: '',
                                interactiveData: JSON.stringify({
                                    badgeLabel: 'Hoạt động tương tác',
                                    questions: [mq],
                                }),
                            });
                        });
                    } else {
                        exportSlides.push({
                            slideIndex: exportSlides.length + 1,
                            slideType: 'interactive',
                            layoutType: 'checkpoint_gate',
                            title: 'Bài tập tương tác & Củng cố kiến thức',
                            content: ['Hãy hoàn thành các câu hỏi tương tác dưới đây để kiểm tra mức độ nắm vững bài học.'],
                            speakerNote: '',
                            imageUrl: '',
                            audioUrl: '',
                            interactiveData: JSON.stringify({
                                badgeLabel: 'Hoạt động tương tác',
                                questions: mappedQuestions,
                            }),
                        });
                    }
                }
            }
        }

        const lessonTitle = session.lessonTitle?.trim() || fixUtf8Filename(session.fileName).replace(/\.pptx$/i, '') || 'Bài giảng tương tác';
        return { session, lessonTitle, exportSlides };
    }

    private async resolveTemplateForExport(templateId?: string, effectiveBgOption?: string) {
        let selectedTemplate: any = null;
        if (effectiveBgOption === 'tuaf_full') {
            selectedTemplate = await this.prisma.pPTXTemplate.findFirst({
                where: { isDefault: true, isActive: true },
            });
            if (!selectedTemplate || (!selectedTemplate.titleBgUrl && !selectedTemplate.contentBgUrl)) {
                selectedTemplate = await this.prisma.pPTXTemplate.findFirst({
                    where: { isSystem: true, isActive: true, titleBgUrl: { not: '' } },
                });
            }
        }
        if (!selectedTemplate && templateId && templateId !== 'blank') {
            selectedTemplate = await this.prisma.pPTXTemplate.findUnique({
                where: { id: templateId },
            });
        }
        if (!selectedTemplate) {
            selectedTemplate = await this.prisma.pPTXTemplate.findFirst({
                where: { isDefault: true, isActive: true },
            });
        }
        return selectedTemplate;
    }

    async exportScorm(sessionId: string, res: Response, templateId?: string, bgOption?: string, theme?: string) {
        const { lessonTitle, exportSlides } = await this.buildExportSlidesForSession(sessionId, false);
        const effectiveBgOption = bgOption || 'tuaf_clean';
        const selectedTemplate = await this.resolveTemplateForExport(templateId, effectiveBgOption);
        const safeTitle = (lessonTitle || 'lesson')
            .replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF ]/g, '_')
            .replace(/\s+/g, '_');
        const zipFileName = `${safeTitle}_SCORM_1.2.zip`;

        res.attachment(zipFileName);
        res.setHeader('Content-Type', 'application/zip');

        await packageScormZip(lessonTitle, sessionId, exportSlides, res, {
            templateId: selectedTemplate?.id,
            templateName: selectedTemplate?.name,
            titleBgUrl: selectedTemplate?.titleBgUrl,
            contentBgUrl: selectedTemplate?.contentBgUrl,
            bgOption: effectiveBgOption,
            theme: theme || 'light',
        });
    }

    async exportH5p(sessionId: string, res: Response, templateId?: string, bgOption?: string, theme?: string) {
        const { lessonTitle, exportSlides } = await this.buildExportSlidesForSession(sessionId, true);
        const effectiveBgOption = bgOption || 'tuaf_clean';
        const selectedTemplate = await this.resolveTemplateForExport(templateId, effectiveBgOption);
        const safeTitle = (lessonTitle || 'lesson')
            .replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF ]/g, '_')
            .replace(/\s+/g, '_');
        const h5pFileName = `${safeTitle}_H5P.h5p`;

        res.attachment(h5pFileName);
        res.setHeader('Content-Type', 'application/zip');

        await packageH5pZip(lessonTitle, exportSlides, res, {
            templateId: selectedTemplate?.id,
            templateName: selectedTemplate?.name,
            titleBgUrl: selectedTemplate?.titleBgUrl,
            contentBgUrl: selectedTemplate?.contentBgUrl,
            bgOption: effectiveBgOption,
            theme: theme || 'light',
        });
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
            include: { pptxSubject: true },
        });
        if (!session) throw new NotFoundException(`Session ${sessionId} not found`);

        const content = session.contentJson ? JSON.parse(session.contentJson) : [];
        const slides = session.slidesJson ? JSON.parse(session.slidesJson) : [];

        const contextHeaderParts: string[] = [];
        const lessonTitle = session.lessonTitle || fixUtf8Filename(session.fileName).replace(/\.pptx$/i, '');
        contextHeaderParts.push(`Tên bài học: ${lessonTitle}`);
        if (session.pptxSubject) {
            const sub = session.pptxSubject;
            const subMajor = sub.majorName || sub.expertiseArea;
            contextHeaderParts.push(`Môn học: ${sub.name}`);
            if (subMajor) contextHeaderParts.push(`Chuyên ngành: ${subMajor}`);
            if (sub.targetAudience) contextHeaderParts.push(`Đối tượng người học: ${sub.targetAudience}`);
            if (sub.additionalContext) contextHeaderParts.push(`Định hướng sư phạm: ${sub.additionalContext}`);
        }
        if (session.contextText && session.contextText.trim()) {
            contextHeaderParts.push(
                `\n=== TÀI LIỆU THAM KHẢO / GIÁO TRÌNH BỔ SUNG (${session.contextFileName || 'Ghi chú bài học'}) ===\n` +
                session.contextText.trim().substring(0, 35000),
            );
        }

        const headerStr = contextHeaderParts.length > 0
            ? `${contextHeaderParts.join('\n')}\n\n=== NỘI DUNG CÁC SLIDE BÀI GIẢNG ===\n\n`
            : '';

        if (content.length > 0) {
            const slidesText = content.map((s: any, idx: number) => {
                const slideNote = slides[idx]?.noteFull || slides[idx]?.noteVN || slides[idx]?.noteEN || '';
                return `Slide ${s.index + 1}: ${s.title || ''}\nNội dung:\n${(s.content || []).join('\n')}${slideNote ? `\nSpeaker note:\n${slideNote}` : ''}`;
            }).join('\n\n---\n\n');
            return `${headerStr}${slidesText}`;
        }

        if (slides.length > 0) {
            const slidesText = slides.map((s: any) =>
                `Slide ${s.index + 1}: ${s.title || ''}\nSpeaker note:\n${s.noteFull || s.noteVN || s.noteEN || ''}`
            ).join('\n\n---\n\n');
            return `${headerStr}${slidesText}`;
        }

        if (session.contextText && session.contextText.trim()) {
            return headerStr;
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

YÊU CẦU BẮT BUỘC:
- Tạo ${level1} câu hỏi mức 1 (Biết/Remember - Kiến thức cơ bản, định nghĩa)
- Tạo ${level2} câu hỏi mức 2 (Hiểu/Understand - Phân tích, so sánh, bản chất)
- Tạo ${level3} câu hỏi mức 3 (Vận dụng/Apply - Tình huống, ứng dụng thực tế)
- Mỗi câu có 4 đáp án: correctAnswer là đáp án đúng, optionB/optionC/optionD là các đáp án sai.
- TUYỆT ĐỐI KHÔNG thêm tiền tố nhãn (như A., B., C., D., 1., 2.) vào nội dung của correctAnswer và các option. Chỉ điền nội dung phương án thuần túy.
- explanation: Giải thích ngắn gọn bản chất vì sao đáp án đúng dựa trên kiến thức bài giảng. TUYỆT ĐỐI KHÔNG dùng từ "A đúng vì", "Phương án A", "Chọn A vì" (do thứ tự đáp án sẽ được xáo trộn ngẫu nhiên trên LMS).
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
      "correctAnswer": "Nội dung đáp án đúng",
      "optionB": "Nội dung đáp án sai B",
      "optionC": "Nội dung đáp án sai C",
      "optionD": "Nội dung đáp án sai D",
      "explanation": "Giải thích ngắn gọn bản chất vì sao đáp án này đúng"
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
            question: (q.question || '').trim(),
            correctAnswer: stripOptionPrefix(q.correctAnswer || ''),
            optionB: stripOptionPrefix(q.optionB || ''),
            optionC: stripOptionPrefix(q.optionC || ''),
            optionD: stripOptionPrefix(q.optionD || ''),
            explanation: cleanExplanation(q.explanation || ''),
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
            question: (q.question || '').trim(),
            correctAnswer: stripOptionPrefix(q.correctAnswer),
            optionB: stripOptionPrefix(q.optionB),
            optionC: stripOptionPrefix(q.optionC),
            optionD: stripOptionPrefix(q.optionD),
            explanation: cleanExplanation(q.explanation || null),
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
                correctAnswer: stripOptionPrefix(correctAnswer),
                optionB: stripOptionPrefix(optionB),
                optionC: stripOptionPrefix(optionC) || '-',
                optionD: stripOptionPrefix(optionD) || '-',
                explanation: cleanExplanation(explanation),
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

YÊU CẦU BẮT BUỘC:
- Gồm câu hỏi Multiple Choice (MC: 1 đáp án đúng) và Multiple Response (MR: nhiều đáp án đúng)
- Phương án đúng PHẢI có dấu hoa thị (*) ở đầu (ví dụ: "*Đáp án đúng", "Đáp án sai")
- TUYỆT ĐỐI KHÔNG thêm tiền tố nhãn (A., B., C., D., 1., 2.) vào nội dung câu trả lời.
- Có phản hồi khi trả lời đúng (correctFeedback) và phản hồi khi trả lời sai (incorrectFeedback). Giải thích bản chất kiến thức, không gán nhãn cố định A, B.
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
            questionText: (q.questionText || '').trim(),
            answers: Array.isArray(q.answers)
                ? q.answers.map((a: string) => {
                    const isCorrect = String(a).startsWith('*');
                    const cleanText = stripOptionPrefix(isCorrect ? String(a).substring(1) : String(a));
                    return isCorrect ? `*${cleanText}` : cleanText;
                })
                : [],
            correctFeedback: cleanExplanation(q.correctFeedback || 'Chính xác!'),
            incorrectFeedback: cleanExplanation(q.incorrectFeedback || 'Chưa đúng, hãy xem lại.'),
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
        const allowedTypes = ['MC', 'MR', 'MATCH', 'CLOZE', 'TRUEFALSE'];
        const requestedTypes = Array.isArray(dto.questionTypes)
            ? dto.questionTypes.map((t) => String(t).toUpperCase()).filter((t) => allowedTypes.includes(t))
            : [];
        const types = requestedTypes.length > 0
            ? requestedTypes.join(', ')
            : 'MC, MR, MATCH, CLOZE, TRUEFALSE';
        const subDiscipline = dto.subDiscipline || 'ALL';

        const prompt = `You are a Professor of English Linguistics and Higher Education Assessment.
Generate ${total} specialized English questions based on the lesson slides below.

LESSON CONTENT:
${contentText}

SPECIFICATIONS:
- Sub-Discipline: ${subDiscipline}
- Allowed Question Types: ${types}
- Bloom Distribution: Level 1 (Remember/Biết): ${level1}, Level 2 (Understand/Hiểu): ${level2}, Level 3 (Apply/Vận dụng): ${level3}
- IMPORTANT: Do NOT prefix option texts with letters (A., B., C., D.). Provide only the plain answer text.
- IMPORTANT: In explanations, explain the underlying linguistic concept neutrally without referring to option letters ("Option A is correct", "Choose A").
- STRICT RULE: ONLY generate 100% auto-gradable Moodle Quiz question types (${types}). NEVER generate "ESSAY" or standalone "SHORTANSWER" questions.

SUPPORTED TYPES & dataJson STRUCTURE:
1. "MC" (Multiple Choice - 1 correct):
   dataJson: {"options": [{"text": "First choice", "isCorrect": true}, {"text": "Second choice", "isCorrect": false}, ...]}
2. "MR" (Multiple Response - multiple correct):
   dataJson: {"options": [{"text": "First choice", "isCorrect": true}, {"text": "Second choice", "isCorrect": true}, ...]}
3. "MATCH" (Matching pairs):
   - MUST have 3 to 5 matching pairs.
   - dataJson: {"pairs": [{"left": "Term / Component 1", "right": "Definition / Function 1"}, {"left": "Term / Component 2", "right": "Definition / Function 2"}, ...], "rightOptions": ["Definition 1", "Definition 2", "Distractor (optional)"]}
4. "CLOZE" (Moodle Embedded Cloze sentence with 4-choice shuffled dropdowns — NEVER use SHORTANSWER):
   questionText: "Sentence with embedded Moodle Cloze dropdown like {1:MULTICHOICE_S:=correct~wrong1~wrong2~wrong3} (base_word)"
   dataJson: {"clozeText": "Sentence with {1:MULTICHOICE_S:=correct~wrong1~wrong2~wrong3} (base_word)", "answers": [{"position": 1, "acceptableAnswers": ["correct"], "distractors": ["wrong1", "wrong2", "wrong3"]}]}
   (STRICT RULE FOR CLOZE: NEVER use {1:SHORTANSWER:...} or bare ___! Every blank MUST be {1:MULTICHOICE_S:=Correct~Wrong1~Wrong2~Wrong3} with 1 canonical correct answer and 3 distinct wrong distractors.)
5. "TRUEFALSE" (True/False):
   dataJson: {"isTrue": true}

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

        const formatted = newQuestions.map((q, idx) => {
            let dataJsonStr = typeof q.dataJson === 'string'
                ? q.dataJson
                : (typeof q.data === 'string'
                    ? q.data
                    : JSON.stringify(q.dataJson ?? q.data ?? {}));

            let resolvedType = (q.questionType || 'MC').toUpperCase();
            let questionText = (q.questionText || '').trim();

            try {
                const parsedData = JSON.parse(dataJsonStr);
                if (Array.isArray(parsedData.options)) {
                    parsedData.options = parsedData.options.map((opt: any) => ({
                        ...opt,
                        text: stripOptionPrefix(opt.text ?? opt.option ?? opt.label ?? ''),
                    }));
                    dataJsonStr = JSON.stringify(parsedData);
                }

                // Auto-detect matching intent and normalize pairs
                const matchCheck = extractMatchPairs(parsedData, questionText, q.explanation || '');
                if (matchCheck.pairs.length >= 2) {
                    if (resolvedType !== 'MATCH' && (resolvedType === 'ESSAY' || isMatchingQuestionText(questionText))) {
                        resolvedType = 'MATCH';
                    }
                    if (resolvedType === 'MATCH' && (!Array.isArray(parsedData.pairs) || parsedData.pairs.length === 0)) {
                        parsedData.pairs = matchCheck.pairs.map((p) => ({ left: p.sub, right: p.ans }));
                        dataJsonStr = JSON.stringify(parsedData);
                    }
                }

                // Strictly recover or reject ESSAY and SHORTANSWER
                if (resolvedType === 'ESSAY' || resolvedType === 'SHORTANSWER' || resolvedType === 'SA') {
                    if (Array.isArray(parsedData?.options) && parsedData.options.length >= 2) {
                        resolvedType = 'MC';
                    } else if (parsedData?.clozeText || parsedData?.rawCloze || /\{\d+:[A-Za-z_]+:/.test(questionText)) {
                        resolvedType = 'CLOZE';
                    }
                }

                // Guarantee CLOZE always uses shuffled selectable choices {1:MULTICHOICE_S:=...}
                if (resolvedType === 'CLOZE') {
                    const sourceCloze = String(parsedData?.clozeText || parsedData?.rawCloze || questionText || '');
                    const upgradedCloze = upgradeClozeToMultichoice(sourceCloze, parsedData);
                    parsedData.clozeText = upgradedCloze;
                    if (parsedData.rawCloze) parsedData.rawCloze = upgradedCloze;
                    if (/\{\d+:[A-Za-z_]+:/.test(questionText) || /_{2,}/.test(questionText)) {
                        questionText = upgradeClozeToMultichoice(questionText, parsedData);
                    }
                    dataJsonStr = JSON.stringify(parsedData);
                }
            } catch {
                // Keep dataJsonStr as is if not JSON
            }

            return {
                id: q.id || `ENG-${Date.now()}-${idx + 1}`,
                questionOrder: idx + 1,
                questionType: resolvedType,
                subDiscipline: q.subDiscipline || subDiscipline,
                difficulty: Number(q.difficulty) || 1,
                title: q.title || `ENG-${String(idx + 1).padStart(2, '0')}`,
                questionText,
                dataJson: dataJsonStr,
                explanation: cleanExplanation(q.explanation || ''),
                points: Number(q.points) || 1,
            };
        }).filter((q) => !['ESSAY', 'SHORTANSWER', 'SA'].includes(q.questionType));

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

        const rawTitle = session?.fileName?.replace(/\.pptx$/i, '') || 'pptx_english';
        const { normalizedTitle, lessonCode } = extractAndNormalizeLesson(rawTitle);

        const mapped: EnglishQuestionData[] = questions.map((q: any, i: number) => ({
            id: q.id || `${lessonCode}-ENG-${String(i + 1).padStart(2, '0')}`,
            questionOrder: i + 1,
            questionType: (q.questionType || 'MC').toUpperCase(),
            subDiscipline: q.subDiscipline || 'ALL',
            difficulty: Number(q.difficulty) || 1,
            title: q.title || `${lessonCode}-ENG-${String(i + 1).padStart(2, '0')}`,
            questionText: q.questionText,
            dataJson: q.dataJson,
            explanation: q.explanation || null,
            points: q.points || 1,
        }));

        const xml = buildEnglishMoodleXml(mapped, normalizedTitle);
        const filename = `${normalizedTitle}_english_moodle.xml`;
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
        // res.attachment() -> content-disposition lib: valid header + UTF-8 filename* for Vietnamese titles
        res.attachment(filename);
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
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
        let cleanData = { ...data };
        if (type === 'review') {
            if (cleanData.correctAnswer !== undefined) cleanData.correctAnswer = stripOptionPrefix(cleanData.correctAnswer);
            if (cleanData.optionB !== undefined) cleanData.optionB = stripOptionPrefix(cleanData.optionB);
            if (cleanData.optionC !== undefined) cleanData.optionC = stripOptionPrefix(cleanData.optionC);
            if (cleanData.optionD !== undefined) cleanData.optionD = stripOptionPrefix(cleanData.optionD);
            if (cleanData.explanation !== undefined) cleanData.explanation = cleanExplanation(cleanData.explanation);
        }
        const updatedList = list.map((item: any) => (item.id === id ? { ...item, ...cleanData } : item));
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
        let cleanedList = list;
        if (type === 'review' && Array.isArray(list)) {
            cleanedList = list.map((item: any) => ({
                ...item,
                correctAnswer: stripOptionPrefix(item.correctAnswer),
                optionB: stripOptionPrefix(item.optionB),
                optionC: stripOptionPrefix(item.optionC),
                optionD: stripOptionPrefix(item.optionD),
                explanation: cleanExplanation(item.explanation),
            }));
        }
        await this.saveSessionQuestions(sessionId, { [type]: cleanedList });
        return { success: true, count: cleanedList.length };
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

