import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Param,
    Body,
    UseGuards,
    UseInterceptors,
    UploadedFile,
    ParseFilePipe,
    MaxFileSizeValidator,
    Res,
    NotFoundException,
    BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SyllabusService } from './syllabus.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { ModelConfigService } from '../model-config/model-config.service';
import { SyllabusExportService } from './syllabus-export.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class SyllabusController {
    constructor(
        private readonly syllabusService: SyllabusService,
        private readonly apiKeysService: ApiKeysService,
        private readonly modelConfigService: ModelConfigService,
        private readonly exportService: SyllabusExportService,
    ) {}

    // ==================== Subject-scoped routes ====================

    /**
     * POST /subjects/:subjectId/syllabus
     * Create a new syllabus with 10 default blocks.
     */
    @Post('subjects/:subjectId/syllabus')
    async createSyllabus(@Param('subjectId') subjectId: string) {
        return this.syllabusService.createSyllabus(subjectId);
    }

    /**
     * GET /subjects/:subjectId/syllabus
     * Get syllabus with all blocks, references, and lessons.
     */
    @Get('subjects/:subjectId/syllabus')
    async getSyllabus(@Param('subjectId') subjectId: string) {
        const syllabus = await this.syllabusService.getSyllabus(subjectId);
        return syllabus; // null if none exists — frontend handles this
    }

    /**
     * POST /subjects/:subjectId/syllabus/import
     * Upload DOCX syllabus → MarkItDown → AI parse → fill blocks.
     */
    @Post('subjects/:subjectId/syllabus/import')
    @UseInterceptors(FileInterceptor('file'))
    async importSyllabus(
        @Param('subjectId') subjectId: string,
        @CurrentUser() user: { id: string },
        @UploadedFile(
            new ParseFilePipe({
                validators: [
                    new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }), // 10MB
                ],
            }),
        )
        file: Express.Multer.File,
    ) {
        if (!file) {
            throw new BadRequestException('Vui lòng chọn file đề cương để tải lên.');
        }
        const ext = file.originalname.split('.').pop()?.toLowerCase();
        if (ext !== 'docx') {
            throw new BadRequestException('Định dạng file không hợp lệ. Chỉ chấp nhận file .docx');
        }

        const apiKey = await this.apiKeysService.getActiveKey(user.id, 'GEMINI');
        const modelConfig = await this.modelConfigService.getModelForTask(user.id, 'OUTLINE');

        return this.syllabusService.importFromDocx(
            subjectId,
            user.id,
            file,
            modelConfig.modelName,
            apiKey || undefined,
        );
    }

    /**
     * GET /subjects/:subjectId/syllabus/export/docx
     * Export syllabus as DOCX file matching TUAF 2026 template.
     */
    @Get('subjects/:subjectId/syllabus/export/docx')
    async exportDocx(
        @Param('subjectId') subjectId: string,
        @Res() res: Response,
    ) {
        const syllabus = await this.syllabusService.getSyllabus(subjectId);
        if (!syllabus) {
            throw new NotFoundException('Chưa tạo đề cương cho môn học này');
        }

        // Get subject name for the document title
        const subject = await this.syllabusService.getSubjectName(subjectId);

        const buffer = await this.exportService.generateDocx(
            syllabus.blocks.map((b) => ({ blockType: b.blockType, title: b.title, content: b.content })),
            subject,
        );

        const filename = `De_cuong_${subject.replace(/\s+/g, '_')}.docx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        res.send(buffer);
    }

    // ==================== Syllabus-scoped routes ====================

    /**
     * PUT /syllabus/:syllabusId/blocks/:blockId
     * Update a single block (title, content, metadata).
     */
    @Put('syllabus/:syllabusId/blocks/:blockId')
    async updateBlock(
        @Param('blockId') blockId: string,
        @Body() body: { title?: string; content?: string; metadata?: any },
    ) {
        return this.syllabusService.updateBlock(blockId, body);
    }

    /**
     * PUT /syllabus/:syllabusId/blocks
     * Bulk update all blocks.
     */
    @Put('syllabus/:syllabusId/blocks')
    async updateBlocks(
        @Param('syllabusId') syllabusId: string,
        @Body() body: { blocks: { id: string; title?: string; content?: string; metadata?: any }[] },
    ) {
        return this.syllabusService.updateBlocks(syllabusId, body.blocks);
    }

    // ==================== Reference routes ====================

    /**
     * POST /syllabus/:syllabusId/references
     * Upload a reference file. MarkItDown extracts content.
     */
    @Post('syllabus/:syllabusId/references')
    @UseInterceptors(FileInterceptor('file'))
    async uploadReference(
        @Param('syllabusId') syllabusId: string,
        @CurrentUser() user: { id: string },
        @UploadedFile(
            new ParseFilePipe({
                validators: [
                    new MaxFileSizeValidator({ maxSize: 20 * 1024 * 1024 }), // 20MB
                ],
            }),
        )
        file: Express.Multer.File,
    ) {
        return this.syllabusService.uploadReference(syllabusId, user.id, file);
    }

    /**
     * GET /syllabus/:syllabusId/references
     * List all references (without markdown content).
     */
    @Get('syllabus/:syllabusId/references')
    async listReferences(@Param('syllabusId') syllabusId: string) {
        return this.syllabusService.listReferences(syllabusId);
    }

    /**
     * GET /syllabus/:syllabusId/references/:refId
     * Get single reference with full markdown content.
     */
    @Get('syllabus/:syllabusId/references/:refId')
    async getReference(@Param('refId') refId: string) {
        const ref = await this.syllabusService.getReference(refId);
        if (!ref) throw new NotFoundException('Reference not found');
        return ref;
    }

    /**
     * DELETE /syllabus/:syllabusId/references/:refId
     * Delete a reference (file + DB).
     */
    @Delete('syllabus/:syllabusId/references/:refId')
    async deleteReference(@Param('refId') refId: string) {
        return this.syllabusService.deleteReference(refId);
    }

    // ==================== Lesson Splitting routes ====================

    /**
     * POST /syllabus/:syllabusId/lessons/generate
     * AI-split content_detail into N lessons.
     */
    @Post('syllabus/:syllabusId/lessons/generate')
    async generateLessons(
        @Param('syllabusId') syllabusId: string,
        @Body() body: { numberOfLessons?: number },
        @CurrentUser() user: { id: string },
    ) {
        const apiKey = await this.apiKeysService.getActiveKey(user.id, 'GEMINI');
        const modelConfig = await this.modelConfigService.getModelForTask(user.id, 'OUTLINE');

        return this.syllabusService.generateLessons(
            syllabusId,
            body.numberOfLessons,
            modelConfig.modelName,
            apiKey || undefined,
        );
    }

    /**
     * DELETE /syllabus/:syllabusId/lessons
     * Clear all generated lessons.
     */
    @Delete('syllabus/:syllabusId/lessons')
    async clearLessons(@Param('syllabusId') syllabusId: string) {
        return this.syllabusService.clearLessons(syllabusId);
    }

    /**
     * PUT /syllabus/:syllabusId/lessons/:lessonId
     * Update a single lesson (title, outline).
     */
    @Put('syllabus/:syllabusId/lessons/:lessonId')
    async updateLesson(
        @Param('lessonId') lessonId: string,
        @Body() body: { title?: string; outline?: string },
    ) {
        return this.syllabusService.updateLesson(lessonId, body);
    }

    /**
     * POST /syllabus/:syllabusId/lessons/:lessonId/bridge
     * Create a Lesson in the existing workflow, linking it to SyllabusLesson.
     */
    @Post('syllabus/:syllabusId/lessons/:lessonId/bridge')
    async createLessonBridge(@Param('lessonId') lessonId: string) {
        return this.syllabusService.createLessonBridge(lessonId);
    }

    /**
     * POST /syllabus/:syllabusId/lessons/:lessonId/textbook
     * AI-generate textbook chapter for a SyllabusLesson.
     */
    @Post('syllabus/:syllabusId/lessons/:lessonId/textbook')
    async generateTextbook(
        @Param('lessonId') lessonId: string,
        @CurrentUser() user: { id: string },
    ) {
        const apiKey = await this.apiKeysService.getActiveKey(user.id, 'GEMINI');
        const modelConfig = await this.modelConfigService.getModelForTask(user.id, 'OUTLINE');

        return this.syllabusService.generateTextbook(
            lessonId,
            modelConfig.modelName,
            apiKey || undefined,
        );
    }

    /**
     * PUT /syllabus/:syllabusId/lessons/:lessonId/textbook
     * Save edited textbook content.
     */
    @Put('syllabus/:syllabusId/lessons/:lessonId/textbook')
    async saveTextbookContent(
        @Param('lessonId') lessonId: string,
        @Body() body: { textbookContent: string },
    ) {
        return this.syllabusService.saveTextbookContent(lessonId, body.textbookContent);
    }

    /**
     * POST /syllabus/:syllabusId/lessons/:lessonId/textbook-pro
     * AI-generate textbook using 5-step pipeline (Pro mode).
     */
    @Post('syllabus/:syllabusId/lessons/:lessonId/textbook-pro')
    async generateTextbookPro(
        @Param('lessonId') lessonId: string,
        @CurrentUser() user: { id: string },
    ) {
        const apiKey = await this.apiKeysService.getActiveKey(user.id, 'GEMINI');
        const modelConfig = await this.modelConfigService.getModelForTask(user.id, 'OUTLINE');

        // Try to get image model (optional)
        let imageModelName: string | undefined;
        try {
            const imgConfig = await this.modelConfigService.getModelForTask(user.id, 'IMAGE');
            imageModelName = imgConfig?.modelName;
        } catch { /* image model is optional */ }

        return this.syllabusService.generateTextbookPro(
            lessonId,
            modelConfig.modelName,
            imageModelName,
            apiKey || undefined,
        );
    }

    /**
     * GET /syllabus/:syllabusId/lessons/:lessonId/textbook-status
     * Poll textbook generation progress (for Pro mode).
     */
    @Get('syllabus/:syllabusId/lessons/:lessonId/textbook-status')
    async getTextbookStatus(@Param('lessonId') lessonId: string) {
        return this.syllabusService.getTextbookStatus(lessonId);
    }

    /**
     * GET /subjects/:subjectId/syllabus/textbook/export/docx
     * Export all textbook chapters as a single DOCX.
     */
    @Get('subjects/:subjectId/syllabus/textbook/export/docx')
    async exportTextbookDocx(
        @Param('subjectId') subjectId: string,
        @Res() res: Response,
    ) {
        const syllabus = await this.syllabusService.getSyllabus(subjectId);
        if (!syllabus) {
            throw new NotFoundException('Chưa tạo đề cương cho môn học này');
        }

        const lessonsWithContent = syllabus.lessons
            .filter((l) => l.textbookContent?.trim())
            .sort((a, b) => a.sortOrder - b.sortOrder);

        if (lessonsWithContent.length === 0) {
            throw new NotFoundException('Chưa có bài nào có nội dung textbook');
        }

        const subject = await this.syllabusService.getSubjectName(subjectId);

        const buffer = await this.exportService.generateTextbookDocx(
            lessonsWithContent.map((l) => ({
                title: l.title,
                sortOrder: l.sortOrder,
                textbookContent: l.textbookContent,
            })),
            subject,
        );

        const filename = `Giao_trinh_${subject.replace(/\s+/g, '_')}.docx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        res.send(buffer);
    }

    /**
     * GET /syllabus/:syllabusId/lessons/:lessonId/export/docx
     * Export a single lesson's textbook content as DOCX.
     */
    @Get('syllabus/:syllabusId/lessons/:lessonId/export/docx')
    async exportSingleLessonDocx(
        @Param('syllabusId') syllabusId: string,
        @Param('lessonId') lessonId: string,
        @Res() res: Response,
    ) {
        const lesson = await this.syllabusService.getSyllabusLessonById(lessonId);
        if (!lesson || !lesson.textbookContent?.trim()) {
            throw new NotFoundException('Bài này chưa có nội dung textbook');
        }

        const syllabus = await this.syllabusService.getSyllabusById(syllabusId);
        const subjectName = syllabus
            ? await this.syllabusService.getSubjectName(syllabus.subjectId)
            : '';

        const buffer = await this.exportService.generateTextbookDocx(
            [{
                title: lesson.title,
                sortOrder: lesson.sortOrder,
                textbookContent: lesson.textbookContent,
            }],
            subjectName,
        );

        const paddedNum = String(lesson.sortOrder + 1).padStart(2, '0');
        const safeName = lesson.title.replace(/[/\\?%*:|"<>\s]+/g, '_').substring(0, 50);
        const filename = `Bai_${paddedNum}_${safeName}.docx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        res.send(buffer);
    }
}
