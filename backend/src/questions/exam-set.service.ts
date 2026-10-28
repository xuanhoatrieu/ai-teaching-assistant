import {
    Injectable,
    Logger,
    NotFoundException,
    BadRequestException,
    OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiProviderService } from '../ai/ai-provider.service';
import { ModelConfigService } from '../model-config/model-config.service';
import { GenerationJobService } from '../generation-job/generation-job.service';
import * as ExcelJS from 'exceljs';
import type { Response } from 'express';
import {
    stripOptionPrefix,
    cleanExplanation,
    isMatchingQuestionText,
    extractMatchPairs,
    toMoodleCategorySlug,
    buildSingleCategoryExamMoodleXml,
    ReviewQuestionData,
    EnglishQuestionData,
} from './moodle-xml.helper';
import { fixUtf8Filename } from '../common/string.util';

export interface ExamReviewQuestionData extends ReviewQuestionData {
    id?: string;
    sourceLessonId?: string;
    sourceLessonTitle?: string;
    sourceSection?: string;
}

export interface ExamEnglishQuestionData extends EnglishQuestionData {
    sourceLessonId?: string;
    sourceLessonTitle?: string;
    sourceSection?: string;
}

export interface ExamLessonOverviewItem {
    id: string;
    order: number;
    title: string;
    hasContent: boolean;
    contentSummary: string;
    slideCount: number;
    reviewQuestionCount: number;
    englishQuestionCount: number;
}

export interface GenerateExamSetDto {
    name: string;
    categoryName?: string;
    subjectId?: string;
    pptxSubjectId?: string;
    mode: 'REVIEW' | 'ENGLISH';
    lessonIds: string[];
    totalCount?: number;
    level1?: number;
    level2?: number;
    level3?: number;
    perLessonCounts?: Record<string, number>;
    questionTypes?: string[];
    subDiscipline?: string;
    customInstructions?: string;
    modelName?: string;
}

export interface UpdateExamSetDto {
    name?: string;
    categoryName?: string;
    questions?: any[];
}

interface GroundedLessonContext {
    id: string;
    order: number;
    title: string;
    subjectName: string;
    subjectContext: string;
    contentText: string;
    existingQuestionsSummary: string;
}

@Injectable()
export class ExamSetService implements OnModuleInit {
    private readonly logger = new Logger(ExamSetService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly aiProvider: AiProviderService,
        private readonly modelConfigService: ModelConfigService,
        private readonly jobService: GenerationJobService,
    ) { }

    async onModuleInit() {
        await this.ensureTableExists();
    }

    /**
     * Ensure exam_question_sets table exists idempotently on startup
     */
    private async ensureTableExists() {
        try {
            await this.prisma.$executeRawUnsafe(`
                CREATE TABLE IF NOT EXISTS "exam_question_sets" (
                    "id" TEXT NOT NULL,
                    "user_id" TEXT NOT NULL,
                    "subject_id" TEXT,
                    "pptx_subject_id" TEXT,
                    "title" TEXT NOT NULL,
                    "category_name" TEXT NOT NULL,
                    "mode" TEXT NOT NULL DEFAULT 'REVIEW',
                    "lesson_ids_json" TEXT NOT NULL DEFAULT '[]',
                    "config_json" TEXT NOT NULL DEFAULT '{}',
                    "questions_json" TEXT NOT NULL DEFAULT '[]',
                    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT "exam_question_sets_pkey" PRIMARY KEY ("id")
                );
                CREATE INDEX IF NOT EXISTS "exam_question_sets_user_id_idx" ON "exam_question_sets"("user_id");
                CREATE INDEX IF NOT EXISTS "exam_question_sets_subject_id_idx" ON "exam_question_sets"("subject_id");
                CREATE INDEX IF NOT EXISTS "exam_question_sets_pptx_subject_id_idx" ON "exam_question_sets"("pptx_subject_id");
            `);
            this.logger.log('✅ Exam question sets table verified / ready');
        } catch (error: any) {
            this.logger.warn(`⚠️ Could not auto-verify exam_question_sets table: ${error.message}`);
        }
    }

    /**
     * List available lessons/sessions with their content & existing question bank metrics
     */
    async getLessonsOverview(
        userId: string,
        params: { subjectId?: string; pptxSubjectId?: string },
    ): Promise<{ subjectName: string; isEnglishSubject: boolean; lessons: ExamLessonOverviewItem[] }> {
        if (params.subjectId) {
            const subject = await this.prisma.subject.findUnique({
                where: { id: params.subjectId },
                include: {
                    lessons: {
                        orderBy: { createdAt: 'asc' },
                        include: {
                            syllabusLesson: {
                                select: {
                                    sortOrder: true,
                                    textbookContent: true,
                                },
                            },
                            _count: {
                                select: {
                                    slides: true,
                                    reviewQuestions: true,
                                    englishQuestions: true,
                                },
                            },
                        },
                    },
                },
            });

            if (!subject || subject.userId !== userId) {
                throw new NotFoundException('Không tìm thấy môn học hoặc bạn không có quyền truy cập.');
            }

            const sortedLessons = [...subject.lessons].sort((a, b) => {
                const orderA = a.syllabusLesson?.sortOrder ?? 9999;
                const orderB = b.syllabusLesson?.sortOrder ?? 9999;
                if (orderA !== orderB) return orderA - orderB;
                return a.createdAt.getTime() - b.createdAt.getTime();
            });

            const items: ExamLessonOverviewItem[] = sortedLessons.map((lesson, idx) => {
                const slideCount = lesson._count?.slides || 0;
                const hasTextbook = Boolean(lesson.syllabusLesson?.textbookContent?.trim());
                const hasScript = Boolean(lesson.slideScript?.trim());
                const hasOutline = Boolean(lesson.detailedOutline?.trim() || lesson.outlineRaw?.trim());
                const hasContent = slideCount > 0 || hasTextbook || hasScript || hasOutline;

                const summaryParts: string[] = [];
                if (slideCount > 0) summaryParts.push(`${slideCount} slides`);
                if (hasTextbook) summaryParts.push('Giáo trình');
                if (hasScript && slideCount === 0) summaryParts.push('Kịch bản slide');
                if (hasOutline) summaryParts.push('Đề cương');
                if (summaryParts.length === 0) summaryParts.push('Chưa có nội dung');

                return {
                    id: lesson.id,
                    order: idx + 1,
                    title: lesson.title,
                    hasContent,
                    contentSummary: summaryParts.join(' • '),
                    slideCount,
                    reviewQuestionCount: lesson._count?.reviewQuestions || 0,
                    englishQuestionCount: lesson._count?.englishQuestions || 0,
                };
            });

            const isEnglishSubject = this.detectEnglishSubject(
                subject.name,
                subject.majorName || subject.expertiseArea || '',
                items.some((i) => i.englishQuestionCount > 0),
            );

            return {
                subjectName: subject.name,
                isEnglishSubject,
                lessons: items,
            };
        }

        if (params.pptxSubjectId) {
            const pptxSubject = await this.prisma.pptxSubject.findUnique({
                where: { id: params.pptxSubjectId },
                include: {
                    sessions: {
                        orderBy: { createdAt: 'asc' },
                    },
                },
            });

            if (!pptxSubject || pptxSubject.userId !== userId) {
                throw new NotFoundException('Không tìm thấy môn học PPTX hoặc bạn không có quyền truy cập.');
            }

            const items: ExamLessonOverviewItem[] = pptxSubject.sessions.map((session, idx) => {
                let slideCount = 0;
                try {
                    const slides = session.slidesJson ? JSON.parse(session.slidesJson) : [];
                    slideCount = Array.isArray(slides) ? slides.length : 0;
                } catch {
                    slideCount = 0;
                }

                let reviewCount = 0;
                let englishCount = 0;
                try {
                    if (session.questionsJson) {
                        const parsed = JSON.parse(session.questionsJson);
                        if (Array.isArray(parsed)) {
                            reviewCount = parsed.length;
                        } else if (parsed && typeof parsed === 'object') {
                            reviewCount = Array.isArray(parsed.review) ? parsed.review.length : 0;
                            englishCount = Array.isArray(parsed.english) ? parsed.english.length : 0;
                        }
                    }
                } catch {
                    // ignore
                }

                const hasContextDoc = Boolean(session.contextText?.trim());
                const hasContent = slideCount > 0 || hasContextDoc;

                const summaryParts: string[] = [];
                if (slideCount > 0) summaryParts.push(`${slideCount} slides`);
                if (hasContextDoc) summaryParts.push(session.contextFileName || 'Tài liệu đính kèm');
                if (summaryParts.length === 0) summaryParts.push('Chưa có nội dung');

                const lessonTitle =
                    session.lessonTitle?.trim() ||
                    fixUtf8Filename(session.fileName).replace(/\.pptx$/i, '') ||
                    `Bài ${idx + 1}`;

                return {
                    id: session.id,
                    order: idx + 1,
                    title: lessonTitle,
                    hasContent,
                    contentSummary: summaryParts.join(' • '),
                    slideCount,
                    reviewQuestionCount: reviewCount,
                    englishQuestionCount: englishCount,
                };
            });

            const isEnglishSubject = this.detectEnglishSubject(
                pptxSubject.name,
                pptxSubject.majorName || pptxSubject.expertiseArea || '',
                items.some((i) => i.englishQuestionCount > 0),
            );

            return {
                subjectName: pptxSubject.name,
                isEnglishSubject,
                lessons: items,
            };
        }

        throw new BadRequestException('Cần cung cấp subjectId hoặc pptxSubjectId.');
    }

    private detectEnglishSubject(name: string, major: string, hasEnglishQuestions: boolean): boolean {
        if (hasEnglishQuestions) return true;
        const combined = `${name} ${major}`.toLowerCase();
        return /tiếng anh|anh văn|ngôn ngữ anh|english|ielts|toeic|toefl|linguistics|phonetics|morphology|syntax|semantics|translation|grammar/i.test(
            combined,
        );
    }

    /**
     * List all ExamQuestionSet records for a subject or pptxSubject
     */
    async listExamSets(
        userId: string,
        params: { subjectId?: string; pptxSubjectId?: string },
    ) {
        if (!params.subjectId && !params.pptxSubjectId) {
            throw new BadRequestException('Cần cung cấp subjectId hoặc pptxSubjectId.');
        }

        const sets = await this.prisma.examQuestionSet.findMany({
            where: {
                userId,
                ...(params.subjectId ? { subjectId: params.subjectId } : {}),
                ...(params.pptxSubjectId ? { pptxSubjectId: params.pptxSubjectId } : {}),
            },
            orderBy: { createdAt: 'desc' },
        });

        return sets.map((s) => this.formatExamSetSummary(s));
    }

    /**
     * Get a single ExamQuestionSet with full questions list
     */
    async getExamSet(userId: string, id: string) {
        const examSet = await this.prisma.examQuestionSet.findUnique({
            where: { id },
        });
        if (!examSet || examSet.userId !== userId) {
            throw new NotFoundException('Không tìm thấy bộ đề kiểm tra hoặc bạn không có quyền truy cập.');
        }
        return this.formatExamSetDetail(examSet);
    }

    /**
     * Update an ExamQuestionSet (name, categoryName, or questions list)
     */
    async updateExamSet(userId: string, id: string, dto: UpdateExamSetDto) {
        const existing = await this.prisma.examQuestionSet.findUnique({
            where: { id },
        });
        if (!existing || existing.userId !== userId) {
            throw new NotFoundException('Không tìm thấy bộ đề kiểm tra hoặc bạn không có quyền chỉnh sửa.');
        }

        const updated = await this.prisma.examQuestionSet.update({
            where: { id },
            data: {
                ...(dto.name !== undefined ? { title: dto.name.trim() } : {}),
                ...(dto.categoryName !== undefined
                    ? { categoryName: toMoodleCategorySlug(dto.categoryName) }
                    : {}),
                ...(dto.questions !== undefined
                    ? { questionsJson: JSON.stringify(dto.questions) }
                    : {}),
            },
        });

        return this.formatExamSetDetail(updated);
    }

    /**
     * Delete an ExamQuestionSet
     */
    async deleteExamSet(userId: string, id: string) {
        const existing = await this.prisma.examQuestionSet.findUnique({
            where: { id },
        });
        if (!existing || existing.userId !== userId) {
            throw new NotFoundException('Không tìm thấy bộ đề kiểm tra hoặc bạn không có quyền xóa.');
        }

        await this.prisma.examQuestionSet.delete({
            where: { id },
        });
        return { deleted: true };
    }

    /**
     * Start async generation of a new ExamQuestionSet across selected lessons
     */
    async startGenerateJob(userId: string, dto: GenerateExamSetDto) {
        if (!dto.subjectId && !dto.pptxSubjectId) {
            throw new BadRequestException('Vui lòng chọn môn học (subjectId hoặc pptxSubjectId).');
        }
        if (!Array.isArray(dto.lessonIds) || dto.lessonIds.length === 0) {
            throw new BadRequestException('Vui lòng chọn ít nhất 1 bài học để tạo câu hỏi kiểm tra.');
        }

        const totalRequested = this.resolveTotalRequested(dto);
        const job = await this.jobService.createJob({
            type: 'exam-questions',
            lessonId: dto.subjectId || dto.pptxSubjectId || 'exam-set',
            userId,
            total: totalRequested,
            payload: dto,
        });

        setImmediate(async () => {
            try {
                await this.runGenerateExamSetBackground(job.id, userId, dto);
            } catch (error: any) {
                this.logger.error(`[ExamSetService] Generate job ${job.id} failed: ${error.message}`);
                await this.jobService.failJob(job.id, error.message || 'Lỗi khi tạo bộ câu hỏi kiểm tra.');
            }
        });

        return { jobId: job.id, status: 'pending' };
    }

    /**
     * Start async append of additional questions into an existing ExamQuestionSet
     */
    async startAppendJob(userId: string, examSetId: string, dto: Partial<GenerateExamSetDto>) {
        const existing = await this.prisma.examQuestionSet.findUnique({
            where: { id: examSetId },
        });
        if (!existing || existing.userId !== userId) {
            throw new NotFoundException('Không tìm thấy bộ đề kiểm tra.');
        }

        const savedLessonIds: string[] = this.safeJsonParse(existing.lessonIdsJson, []);
        const savedConfig: any = this.safeJsonParse(existing.configJson, {});

        const mergedDto: GenerateExamSetDto = {
            name: existing.title,
            categoryName: existing.categoryName,
            subjectId: existing.subjectId || undefined,
            pptxSubjectId: existing.pptxSubjectId || undefined,
            mode: (dto.mode || existing.mode || 'REVIEW') as 'REVIEW' | 'ENGLISH',
            lessonIds:
                Array.isArray(dto.lessonIds) && dto.lessonIds.length > 0
                    ? dto.lessonIds
                    : savedLessonIds,
            totalCount: dto.totalCount,
            level1: dto.level1 ?? savedConfig.level1 ?? 10,
            level2: dto.level2 ?? savedConfig.level2 ?? 10,
            level3: dto.level3 ?? savedConfig.level3 ?? 5,
            perLessonCounts: dto.perLessonCounts,
            questionTypes: dto.questionTypes ?? savedConfig.questionTypes,
            subDiscipline: dto.subDiscipline ?? savedConfig.subDiscipline,
            customInstructions: dto.customInstructions ?? savedConfig.customInstructions,
            modelName: dto.modelName,
        };

        const totalRequested = this.resolveTotalRequested(mergedDto);
        const job = await this.jobService.createJob({
            type: 'append-exam-questions',
            lessonId: examSetId,
            userId,
            total: totalRequested,
            payload: mergedDto,
        });

        setImmediate(async () => {
            try {
                await this.runGenerateExamSetBackground(job.id, userId, mergedDto, examSetId);
            } catch (error: any) {
                this.logger.error(`[ExamSetService] Append job ${job.id} failed: ${error.message}`);
                await this.jobService.failJob(job.id, error.message || 'Lỗi khi tạo thêm câu hỏi kiểm tra.');
            }
        });

        return { jobId: job.id, status: 'pending' };
    }

    private resolveTotalRequested(dto: GenerateExamSetDto): number {
        if (dto.perLessonCounts && Object.keys(dto.perLessonCounts).length > 0) {
            const sum = dto.lessonIds.reduce(
                (acc, id) => acc + Math.max(0, Number(dto.perLessonCounts?.[id] || 0)),
                0,
            );
            if (sum > 0) return sum;
        }
        const l1 = Math.max(0, Number(dto.level1 ?? 20));
        const l2 = Math.max(0, Number(dto.level2 ?? 20));
        const l3 = Math.max(0, Number(dto.level3 ?? 10));
        if (dto.totalCount && dto.totalCount > 0) return Number(dto.totalCount);
        return Math.max(1, l1 + l2 + l3);
    }

    /**
     * Core Multi-Lesson Grounded Generation Pipeline
     */
    private async runGenerateExamSetBackground(
        jobId: string,
        userId: string,
        dto: GenerateExamSetDto,
        appendToExamSetId?: string,
    ) {
        await this.jobService.updateProgress(jobId, 2, 'Đang kiểm tra dữ liệu các bài học được chọn...');

        const sourceType: 'subject' | 'pptx' = dto.subjectId ? 'subject' : 'pptx';
        const overview = await this.getLessonsOverview(userId, {
            subjectId: dto.subjectId,
            pptxSubjectId: dto.pptxSubjectId,
        });

        const selectedOverviews = overview.lessons.filter((l) => dto.lessonIds.includes(l.id));
        if (selectedOverviews.length === 0) {
            throw new BadRequestException('Không tìm thấy bài học hợp lệ trong danh sách đã chọn.');
        }

        // Load existing exam set questions if appending
        let existingExamQuestions: any[] = [];
        let existingLessonIds: string[] = [];
        if (appendToExamSetId) {
            const existingSet = await this.prisma.examQuestionSet.findUnique({
                where: { id: appendToExamSetId },
            });
            if (existingSet) {
                existingExamQuestions = this.safeJsonParse(existingSet.questionsJson, []);
                existingLessonIds = this.safeJsonParse(existingSet.lessonIdsJson, []);
            }
        }

        // Compute per-lesson question allocations
        const totalRequested = this.resolveTotalRequested(dto);
        const l1Ratio = Math.max(0, Number(dto.level1 ?? 20));
        const l2Ratio = Math.max(0, Number(dto.level2 ?? 20));
        const l3Ratio = Math.max(0, Number(dto.level3 ?? 10));
        const ratioSum = Math.max(1, l1Ratio + l2Ratio + l3Ratio);

        const lessonCount = selectedOverviews.length;
        const basePerLesson = Math.floor(totalRequested / lessonCount);
        const remainder = totalRequested % lessonCount;

        const allocations = selectedOverviews.map((lesson, idx) => {
            let count = basePerLesson + (idx < remainder ? 1 : 0);
            if (dto.perLessonCounts && dto.perLessonCounts[lesson.id] !== undefined) {
                count = Math.max(0, Number(dto.perLessonCounts[lesson.id]));
            }
            const level1 = Math.round((count * l1Ratio) / ratioSum);
            const level2 = Math.round((count * l2Ratio) / ratioSum);
            const level3 = Math.max(0, count - level1 - level2);
            return {
                lesson,
                count,
                level1,
                level2,
                level3,
            };
        }).filter((a) => a.count > 0);

        if (allocations.length === 0) {
            throw new BadRequestException('Tổng số câu hỏi cần tạo phải lớn hơn 0.');
        }

        const modelConfig = await this.modelConfigService.getModelForTask(userId, 'QUESTIONS');
        const activeModel = dto.modelName?.trim() || modelConfig.modelName || 'gemini-2.5-flash';

        const generatedQuestions: any[] = [];
        let completedLessons = 0;

        for (const alloc of allocations) {
            const progressPct = Math.min(
                92,
                Math.round((completedLessons / allocations.length) * 85) + 5,
            );
            await this.jobService.updateProgress(
                jobId,
                progressPct,
                `Đang tạo ${alloc.count} câu hỏi từ Bài ${alloc.lesson.order}: ${alloc.lesson.title} (${completedLessons + 1}/${allocations.length})...`,
            );

            const groundedContext = await this.extractLessonGroundedContext(
                sourceType,
                alloc.lesson.id,
                alloc.lesson.order,
                existingExamQuestions.filter((q) => q.sourceLessonId === alloc.lesson.id),
            );

            const lessonQuestions = await this.generateGroundedQuestionsForLesson(
                userId,
                activeModel,
                dto.mode || 'REVIEW',
                groundedContext,
                {
                    total: alloc.count,
                    level1: alloc.level1,
                    level2: alloc.level2,
                    level3: alloc.level3,
                    questionTypes: dto.questionTypes,
                    subDiscipline: dto.subDiscipline,
                    customInstructions: dto.customInstructions,
                },
                existingExamQuestions.length + generatedQuestions.length,
            );

            generatedQuestions.push(...lessonQuestions);
            completedLessons++;
        }

        if (generatedQuestions.length === 0) {
            throw new BadRequestException(
                'Không tạo được câu hỏi nào từ các bài học đã chọn. Vui lòng kiểm tra lại nội dung bài học.',
            );
        }

        await this.jobService.updateProgress(jobId, 95, 'Đang lưu bộ câu hỏi kiểm tra...');

        const defaultName =
            dto.name?.trim() ||
            `Bài kiểm tra (${selectedOverviews.map((l) => `Bài ${l.order}`).join(', ')})`;
        const categorySlug = toMoodleCategorySlug(dto.categoryName?.trim() || defaultName);

        const finalQuestions = [...existingExamQuestions, ...generatedQuestions];
        const mergedLessonIds = Array.from(
            new Set([...existingLessonIds, ...selectedOverviews.map((l) => l.id)]),
        );

        let savedSet;
        if (appendToExamSetId) {
            savedSet = await this.prisma.examQuestionSet.update({
                where: { id: appendToExamSetId },
                data: {
                    lessonIdsJson: JSON.stringify(mergedLessonIds),
                    questionsJson: JSON.stringify(finalQuestions),
                },
            });
        } else {
            savedSet = await this.prisma.examQuestionSet.create({
                data: {
                    userId,
                    subjectId: dto.subjectId || null,
                    pptxSubjectId: dto.pptxSubjectId || null,
                    title: defaultName,
                    categoryName: categorySlug,
                    mode: dto.mode || 'REVIEW',
                    lessonIdsJson: JSON.stringify(mergedLessonIds),
                    configJson: JSON.stringify({
                        totalCount: totalRequested,
                        level1: dto.level1 ?? 20,
                        level2: dto.level2 ?? 20,
                        level3: dto.level3 ?? 10,
                        perLessonCounts: dto.perLessonCounts || {},
                        questionTypes: dto.questionTypes || ['MC', 'MR', 'MATCH', 'CLOZE', 'TRUEFALSE'],
                        subDiscipline: dto.subDiscipline || 'ALL',
                        customInstructions: dto.customInstructions || '',
                    }),
                    questionsJson: JSON.stringify(finalQuestions),
                },
            });
        }

        await this.jobService.completeJob(jobId, {
            examSetId: savedSet.id,
            addedCount: generatedQuestions.length,
            totalCount: finalQuestions.length,
        });
    }

    /**
     * Extract 100% of a single lesson's content + existing questions for anti-duplication & grounding
     */
    private async extractLessonGroundedContext(
        sourceType: 'subject' | 'pptx',
        lessonId: string,
        lessonOrder: number,
        alreadyInExamSet: any[] = [],
    ): Promise<GroundedLessonContext> {
        if (sourceType === 'subject') {
            const lesson = await this.prisma.lesson.findUnique({
                where: { id: lessonId },
                include: {
                    subject: true,
                    syllabusLesson: true,
                    slides: {
                        orderBy: { slideIndex: 'asc' },
                    },
                    reviewQuestions: {
                        orderBy: [{ level: 'asc' }, { questionOrder: 'asc' }],
                    },
                    englishQuestions: {
                        orderBy: { questionOrder: 'asc' },
                    },
                },
            });

            if (!lesson) {
                throw new NotFoundException(`Không tìm thấy bài học ${lessonId}`);
            }

            const contentSections: string[] = [];

            if (lesson.syllabusLesson?.textbookContent?.trim()) {
                contentSections.push(
                    `=== GIÁO TRÌNH CHI TIẾT BÀI HỌC (${lesson.title}) ===\n` +
                        lesson.syllabusLesson.textbookContent.trim().substring(0, 28000),
                );
            }

            if (lesson.slides.length > 0) {
                const slidesStr = lesson.slides
                    .map(
                        (s) =>
                            `[Slide ${s.slideIndex}: ${s.title}]\nNội dung slide:\n${s.content || ''}${
                                s.speakerNote ? `\nLời giảng / Thuyết minh:\n${s.speakerNote}` : ''
                            }`,
                    )
                    .join('\n\n---\n\n');
                contentSections.push(`=== NỘI DUNG CÁC SLIDE BÀI GIẢNG ===\n${slidesStr.substring(0, 28000)}`);
            } else if (lesson.slideScript?.trim()) {
                contentSections.push(
                    `=== KỊCH BẢN SLIDE BÀI GIẢNG ===\n${lesson.slideScript.trim().substring(0, 25000)}`,
                );
            }

            if (lesson.detailedOutline?.trim() || lesson.outlineRaw?.trim()) {
                const outline = (lesson.detailedOutline || lesson.outlineRaw || '').trim();
                contentSections.push(`=== ĐỀ CƯƠNG BÀI HỌC ===\n${outline.substring(0, 12000)}`);
            }

            const fullContent = contentSections.join('\n\n').trim();
            if (!fullContent) {
                throw new BadRequestException(
                    `Bài học "${lesson.title}" chưa có nội dung (giáo trình, slide hoặc đề cương). Vui lòng tạo nội dung bài học trước.`,
                );
            }

            const existingItems: string[] = [];
            for (const rq of lesson.reviewQuestions.slice(0, 35)) {
                existingItems.push(`- [Ôn tập Mức ${rq.level}] ${rq.question} (Đáp án: ${rq.correctAnswer})`);
            }
            for (const eq of lesson.englishQuestions.slice(0, 35)) {
                existingItems.push(`- [${eq.questionType}] ${eq.questionText}`);
            }
            for (const ex of alreadyInExamSet.slice(0, 35)) {
                existingItems.push(`- [Đã có trong đề] ${ex.question || ex.questionText}`);
            }

            const sub = lesson.subject;
            const subjectContextParts: string[] = [];
            if (sub.majorName || sub.expertiseArea) {
                subjectContextParts.push(`Chuyên ngành: ${sub.majorName || sub.expertiseArea}`);
            }
            if (sub.targetAudience) {
                subjectContextParts.push(`Đối tượng: ${sub.targetAudience}`);
            }
            if (sub.additionalContext) {
                subjectContextParts.push(`Định hướng môn học: ${sub.additionalContext}`);
            }

            return {
                id: lesson.id,
                order: lessonOrder,
                title: lesson.title,
                subjectName: sub.name,
                subjectContext: subjectContextParts.join(' | '),
                contentText: fullContent,
                existingQuestionsSummary:
                    existingItems.length > 0
                        ? existingItems.join('\n')
                        : '(Chưa có câu hỏi cũ trong bài học này)',
            };
        }

        // sourceType === 'pptx'
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: lessonId },
            include: { pptxSubject: true },
        });

        if (!session) {
            throw new NotFoundException(`Không tìm thấy bài giảng PPTX ${lessonId}`);
        }

        const lessonTitle =
            session.lessonTitle?.trim() ||
            fixUtf8Filename(session.fileName).replace(/\.pptx$/i, '') ||
            `Bài ${lessonOrder}`;

        const contentSections: string[] = [];
        if (session.contextText?.trim()) {
            contentSections.push(
                `=== TÀI LIỆU THAM KHẢO / GIÁO TRÌNH ĐÍNH KÈM (${session.contextFileName || 'Tài liệu bài học'}) ===\n` +
                    session.contextText.trim().substring(0, 30000),
            );
        }

        const contentArr = this.safeJsonParse<any[]>(session.contentJson || '[]', []);
        const slidesArr = this.safeJsonParse<any[]>(session.slidesJson || '[]', []);

        if (Array.isArray(contentArr) && contentArr.length > 0) {
            const slidesText = contentArr
                .map((s: any, idx: number) => {
                    const slideNote =
                        slidesArr[idx]?.noteFull ||
                        slidesArr[idx]?.noteVN ||
                        slidesArr[idx]?.noteEN ||
                        '';
                    const slideNum = (s.index ?? idx) + 1;
                    return `[Slide ${slideNum}: ${s.title || ''}]\nNội dung:\n${
                        Array.isArray(s.content) ? s.content.join('\n') : s.content || ''
                    }${slideNote ? `\nLời giảng / Speaker note:\n${slideNote}` : ''}`;
                })
                .join('\n\n---\n\n');
            contentSections.push(`=== NỘI DUNG CÁC SLIDE BÀI GIẢNG ===\n${slidesText.substring(0, 30000)}`);
        } else if (Array.isArray(slidesArr) && slidesArr.length > 0) {
            const slidesText = slidesArr
                .map((s: any, idx: number) => {
                    const slideNum = (s.index ?? idx) + 1;
                    return `[Slide ${slideNum}: ${s.title || ''}]\nNội dung:\n${
                        Array.isArray(s.content) ? s.content.join('\n') : s.content || ''
                    }\nLời giảng / Speaker note:\n${s.noteFull || s.noteVN || s.noteEN || ''}`;
                })
                .join('\n\n---\n\n');
            contentSections.push(`=== NỘI DUNG CÁC SLIDE BÀI GIẢNG ===\n${slidesText.substring(0, 30000)}`);
        }

        const fullContent = contentSections.join('\n\n').trim();
        if (!fullContent) {
            throw new BadRequestException(
                `Bài giảng "${lessonTitle}" chưa có nội dung slide hoặc tài liệu đính kèm.`,
            );
        }

        const existingItems: string[] = [];
        const sessionQuestions = this.safeJsonParse<any>(session.questionsJson || '{}', {});
        const reviewList = Array.isArray(sessionQuestions)
            ? sessionQuestions
            : Array.isArray(sessionQuestions?.review)
            ? sessionQuestions.review
            : [];
        const englishList = Array.isArray(sessionQuestions?.english) ? sessionQuestions.english : [];

        for (const rq of reviewList.slice(0, 35)) {
            existingItems.push(`- [Ôn tập Mức ${rq.level || 1}] ${rq.question} (Đáp án: ${rq.correctAnswer})`);
        }
        for (const eq of englishList.slice(0, 35)) {
            existingItems.push(`- [${eq.questionType || 'MC'}] ${eq.questionText}`);
        }
        for (const ex of alreadyInExamSet.slice(0, 35)) {
            existingItems.push(`- [Đã có trong đề] ${ex.question || ex.questionText}`);
        }

        const sub = session.pptxSubject;
        const subjectContextParts: string[] = [];
        if (sub?.majorName || sub?.expertiseArea) {
            subjectContextParts.push(`Chuyên ngành: ${sub.majorName || sub.expertiseArea}`);
        }
        if (sub?.targetAudience) {
            subjectContextParts.push(`Đối tượng: ${sub.targetAudience}`);
        }
        if (sub?.additionalContext) {
            subjectContextParts.push(`Định hướng môn học: ${sub.additionalContext}`);
        }

        return {
            id: session.id,
            order: lessonOrder,
            title: lessonTitle,
            subjectName: sub?.name || 'Môn học',
            subjectContext: subjectContextParts.join(' | '),
            contentText: fullContent,
            existingQuestionsSummary:
                existingItems.length > 0
                    ? existingItems.join('\n')
                    : '(Chưa có câu hỏi cũ trong bài học này)',
        };
    }

    /**
     * Generate strictly grounded questions for a single lesson (REVIEW or ENGLISH mode)
     */
    private async generateGroundedQuestionsForLesson(
        userId: string,
        modelName: string,
        mode: 'REVIEW' | 'ENGLISH',
        ctx: GroundedLessonContext,
        quota: {
            total: number;
            level1: number;
            level2: number;
            level3: number;
            questionTypes?: string[];
            subDiscipline?: string;
            customInstructions?: string;
        },
        globalStartIndex: number,
    ): Promise<any[]> {
        if (mode === 'ENGLISH') {
            return this.generateEnglishModeQuestionsForLesson(
                userId,
                modelName,
                ctx,
                quota,
                globalStartIndex,
            );
        }
        return this.generateReviewModeQuestionsForLesson(
            userId,
            modelName,
            ctx,
            quota,
            globalStartIndex,
        );
    }

    private async generateReviewModeQuestionsForLesson(
        userId: string,
        modelName: string,
        ctx: GroundedLessonContext,
        quota: {
            total: number;
            level1: number;
            level2: number;
            level3: number;
            customInstructions?: string;
        },
        globalStartIndex: number,
    ): Promise<ExamReviewQuestionData[]> {
        const prompt = `Bạn là Chuyên gia Khảo thí & Đo lường Giáo dục Đại học.
Nhiệm vụ của bạn là biên soạn CHÍNH XÁC ${quota.total} câu hỏi trắc nghiệm khách quan (4 lựa chọn) cho ĐỀ KIỂM TRA từ bài học: "Bài ${ctx.order}: ${ctx.title}" thuộc môn "${ctx.subjectName}".
${ctx.subjectContext ? `Thông tin môn học: ${ctx.subjectContext}` : ''}

=====================================================================
QUY TẮC KHẢO THÍ TỐI THƯỢNG (BẮT BUỘC TUÂN THỦ 100%):
1. PHẠM VI KHÉP KÍN TUYỆT ĐỐI (CLOSED-WORLD GROUNDING):
   - 100% câu hỏi, đáp án đúng, phương án nhiễu và giải thích BẮT BUỘC phải dựa hoàn toàn vào [NỘI DUNG BÀI HỌC NGUỒN] được cung cấp bên dưới.
   - TUYỆT ĐỐI CẤM đưa bất kỳ kiến thức, khái niệm, số liệu hay sự kiện nào KHÔNG CÓ trong nội dung bài học này.
2. TRÍCH DẪN NGUỒN RÕ RÀNG (SOURCE SECTION):
   - Mỗi câu hỏi BẮT BUỘC phải điền trường "sourceSection" chỉ rõ câu hỏi được trích xuất từ Slide số mấy hoặc Mục kiến thức nào của bài học (ví dụ: "Slide 3: Khái niệm...", "Mục 2.1: Phân loại...").
3. KẾ THỪA PHONG CÁCH & CHỐNG TRÙNG LẶP 100% (ANTI-DUPLICATION):
   - Tham khảo [DANH SÁCH CÂU HỎI ĐÃ CÓ CỦA BÀI HỌC] để nắm bắt chuẩn thuật ngữ và phong cách hỏi.
   - Tuyệt đối KHÔNG sao chép hay lặp lại câu hỏi đã có. Phải tạo mới 100% góc hỏi, tình huống hoặc cách kiểm tra kiến thức trong bài.
4. QUY TẮC ĐỊNH DẠNG MOODLE LMS:
   - Phân bổ độ khó Bloom:
     + Mức 1 (Biết / Remember): ${quota.level1} câu
     + Mức 2 (Hiểu / Understand): ${quota.level2} câu
     + Mức 3 (Vận dụng / Apply): ${quota.level3} câu
   - Mỗi câu gồm: "correctAnswer" (1 đáp án đúng duy nhất) và 3 phương án nhiễu ("optionB", "optionC", "optionD") có độ dài và cấu trúc ngữ pháp tương đương.
   - TUYỆT ĐỐI KHÔNG gắn tiền tố "A.", "B.", "C.", "D." vào đầu nội dung các phương án.
   - Trường "explanation": Giải thích rõ bản chất vì sao đáp án đúng dựa vào nội dung bài học. TUYỆT ĐỐI KHÔNG dùng cụm từ "Đáp án A đúng vì..." hay "Chọn B vì..." (do LMS sẽ xáo trộn thứ tự đáp án).
${quota.customInstructions ? `5. YÊU CẦU BỔ SUNG TỪ GIẢNG VIÊN:\n   ${quota.customInstructions}` : ''}
=====================================================================

[DANH SÁCH CÂU HỎI ĐÃ CÓ CỦA BÀI HỌC (ĐỂ THAM KHẢO PHONG CÁCH & TRÁNH TRÙNG LẶP)]:
${ctx.existingQuestionsSummary}

[NỘI DUNG BÀI HỌC NGUỒN — BÀI ${ctx.order}: ${ctx.title}]:
${ctx.contentText}

=====================================================================
Hãy trả lời CHỈ BẰNG JSON HỢP LỆ theo đúng cấu trúc sau (không kèm văn bản giải thích ngoài JSON):
\`\`\`json
{
  "questions": [
    {
      "level": 1,
      "sourceSection": "Slide 2: Tên mục hoặc tiêu đề slide",
      "question": "Nội dung câu hỏi rõ ràng, chuẩn học thuật?",
      "correctAnswer": "Nội dung đáp án đúng (không có tiền tố A.)",
      "optionB": "Nội dung phương án nhiễu 1",
      "optionC": "Nội dung phương án nhiễu 2",
      "optionD": "Nội dung phương án nhiễu 3",
      "explanation": "Giải thích chi tiết dựa trên nội dung bài học."
    }
  ]
}
\`\`\``;

        const aiResult = await this.aiProvider.generateText(prompt, modelName, userId, {
            maxTokens: 32768,
        });
        const parsedList = this.parseQuestionsArrayFromAiResponse(aiResult.content);

        const results: ExamReviewQuestionData[] = [];
        for (let i = 0; i < parsedList.length; i++) {
            const raw = parsedList[i];
            const questionText = String(raw.question || raw.questionText || '').trim();
            const correctAnswer = stripOptionPrefix(String(raw.correctAnswer || ''));
            const optionB = stripOptionPrefix(String(raw.optionB || ''));
            const optionC = stripOptionPrefix(String(raw.optionC || ''));
            const optionD = stripOptionPrefix(String(raw.optionD || ''));

            if (!questionText || !correctAnswer || !optionB) continue;

            const level = [1, 2, 3].includes(Number(raw.level || raw.difficulty))
                ? Number(raw.level || raw.difficulty)
                : 1;
            const seq = String(globalStartIndex + results.length + 1).padStart(2, '0');

            results.push({
                id: `EX-REV-${Date.now()}-${ctx.order}-${i + 1}`,
                questionId: `B${ctx.order}-M${level}-C${seq}`,
                level,
                question: questionText,
                correctAnswer,
                optionB,
                optionC: optionC || '-',
                optionD: optionD || '-',
                explanation: cleanExplanation(raw.explanation || ''),
                sourceLessonId: ctx.id,
                sourceLessonTitle: `Bài ${ctx.order}: ${ctx.title}`,
                sourceSection: String(raw.sourceSection || `Bài ${ctx.order}`).trim(),
            });
        }

        return results;
    }

    private async generateEnglishModeQuestionsForLesson(
        userId: string,
        modelName: string,
        ctx: GroundedLessonContext,
        quota: {
            total: number;
            level1: number;
            level2: number;
            level3: number;
            questionTypes?: string[];
            subDiscipline?: string;
            customInstructions?: string;
        },
        globalStartIndex: number,
    ): Promise<ExamEnglishQuestionData[]> {
        const allowedTypes = ['MC', 'MR', 'MATCH', 'CLOZE', 'TRUEFALSE'];
        const requestedTypes = Array.isArray(quota.questionTypes)
            ? quota.questionTypes
                  .map((t) => String(t).toUpperCase())
                  .filter((t) => allowedTypes.includes(t))
            : [];
        const activeTypes =
            requestedTypes.length > 0 ? requestedTypes : ['MC', 'MR', 'MATCH', 'CLOZE', 'TRUEFALSE'];
        const subDiscipline =
            quota.subDiscipline || 'ALL (Comprehensive English Studies & Linguistics)';

        const prompt = `You are an Assessment Specialist in University-Level English Studies & Linguistics.
Generate EXACTLY ${quota.total} 100% NEW, auto-gradable exam questions for Lesson ${ctx.order}: "${ctx.title}" (Course: "${ctx.subjectName}", Sub-discipline focus: ${subDiscipline}).
${ctx.subjectContext ? `Course context: ${ctx.subjectContext}` : ''}

=====================================================================
STRICT ASSESSMENT & GROUNDING RULES (100% MANDATORY):
1. CLOSED-WORLD GROUNDING (100% BOUNDED TO SOURCE LESSON):
   - Every single question, option, matching pair, cloze blank, and explanation MUST be derived strictly from the [SOURCE LESSON CONTENT] below.
   - DO NOT introduce outside topics, vocabulary, or concepts that are not covered in this lesson.
2. SOURCE CITATION ("sourceSection"):
   - Every question MUST include a "sourceSection" field indicating the exact Slide number or Section in the lesson (e.g., "Slide 5: Past Perfect Continuous" or "Section 2: Lexical Collocations").
3. STYLE CONTINUITY & 100% ANTI-DUPLICATION:
   - Review the [EXISTING LESSON QUESTIONS] below to maintain consistent academic level and terminology, but DO NOT duplicate or paraphrase existing questions. Create 100% new questions.
4. ALLOWED AUTO-GRADABLE MOODLE QUESTION TYPES ONLY (${activeTypes.join(', ')}):
   - NEVER generate ESSAY or SHORTANSWER questions.
   - Difficulty distribution:
     + Level 1 (Remember / Knowledge): ${quota.level1} questions
     + Level 2 (Understand / Comprehension): ${quota.level2} questions
     + Level 3 (Apply / Analyze): ${quota.level3} questions
   - Required "data" schemas by questionType:
     * "MC" (Single-choice):
       "data": { "options": [ { "text": "Correct option (no A/B/C prefix)", "fraction": 100 }, { "text": "Distractor 1", "fraction": 0 }, { "text": "Distractor 2", "fraction": 0 }, { "text": "Distractor 3", "fraction": 0 } ] }
     * "MR" (Multiple-response, 2-3 correct options whose positive fractions sum to 100, wrong options -25):
       "data": { "options": [ { "text": "Correct 1", "fraction": 50 }, { "text": "Correct 2", "fraction": 50 }, { "text": "Wrong 1", "fraction": -25 }, { "text": "Wrong 2", "fraction": -25 } ] }
     * "MATCH" (Matching, MUST have at least 4 distinct left-right pairs; both "left" and "right" MUST be non-empty strings):
       "data": { "pairs": [ { "left": "Term / Clause / Item 1", "right": "Matching Function / Definition 1" }, { "left": "Term 2", "right": "Match 2" }, { "left": "Term 3", "right": "Match 3" }, { "left": "Term 4", "right": "Match 4" } ] }
     * "CLOZE" (Embedded Cloze passage using valid Moodle syntax {1:MULTICHOICE:=Correct~Wrong1~Wrong2} or {1:SHORTANSWER:=word}):
       "data": { "clozeText": "Passage with {1:MULTICHOICE:=correct~wrong1~wrong2} embedded." }
     * "TRUEFALSE":
       "data": { "correctAnswer": true } (or false)
${quota.customInstructions ? `5. ADDITIONAL INSTRUCTOR INSTRUCTIONS:\n   ${quota.customInstructions}` : ''}
=====================================================================

[EXISTING LESSON QUESTIONS (FOR STYLE REFERENCE & ANTI-DUPLICATION ONLY)]:
${ctx.existingQuestionsSummary}

[SOURCE LESSON CONTENT — LESSON ${ctx.order}: ${ctx.title}]:
${ctx.contentText}

=====================================================================
Respond ONLY with valid JSON in the exact format below:
\`\`\`json
{
  "questions": [
    {
      "questionType": "MC",
      "subDiscipline": "SYNTAX",
      "difficulty": 2,
      "sourceSection": "Slide 4: Topic Name",
      "title": "Short descriptive title",
      "questionText": "Full question stem?",
      "data": {
        "options": [
          { "text": "Correct answer", "fraction": 100 },
          { "text": "Distractor B", "fraction": 0 },
          { "text": "Distractor C", "fraction": 0 },
          { "text": "Distractor D", "fraction": 0 }
        ]
      },
      "explanation": "Detailed academic explanation grounded in the lesson.",
      "points": 1
    }
  ]
}
\`\`\``;

        const aiResult = await this.aiProvider.generateText(prompt, modelName, userId, {
            maxTokens: 32768,
        });
        const parsedList = this.parseQuestionsArrayFromAiResponse(aiResult.content);

        const results: ExamEnglishQuestionData[] = [];
        for (let i = 0; i < parsedList.length; i++) {
            const item = parsedList[i];
            let qType = String(item.questionType || 'MC').toUpperCase();
            const questionText = String(item.questionText || item.question || '').trim();
            if (!questionText) continue;

            let parsedData: any = {};
            if (typeof item.data === 'object' && item.data !== null) {
                parsedData = item.data;
            } else if (typeof item.dataJson === 'object' && item.dataJson !== null) {
                parsedData = item.dataJson;
            } else if (typeof item.dataJson === 'string') {
                parsedData = this.safeJsonParse(item.dataJson, {});
            } else {
                parsedData = item;
            }

            const explanation = String(item.explanation || item.feedback || '').trim();

            // Auto-detect & normalize MATCH pairs
            const matchCheck = extractMatchPairs(parsedData, questionText, explanation);
            if (matchCheck.pairs.length >= 2) {
                if (qType !== 'MATCH' && (qType === 'ESSAY' || isMatchingQuestionText(questionText))) {
                    qType = 'MATCH';
                }
                if (qType === 'MATCH') {
                    parsedData.pairs = matchCheck.pairs.map((p) => ({ left: p.sub, right: p.ans }));
                }
            }

            // Reject non-auto-gradable ESSAY / SHORTANSWER unless recoverable
            if (qType === 'ESSAY' || qType === 'SHORTANSWER' || qType === 'SA') {
                if (Array.isArray(parsedData?.options) && parsedData.options.length >= 2) {
                    qType = 'MC';
                } else if (parsedData?.clozeText || /\{\d+:[A-Za-z_]+:/.test(questionText)) {
                    qType = 'CLOZE';
                } else {
                    continue;
                }
            }

            if (Array.isArray(parsedData?.options)) {
                parsedData.options = parsedData.options.map((opt: any) => ({
                    ...opt,
                    text: stripOptionPrefix(String(opt.text ?? opt.answer ?? opt.label ?? '')),
                }));
            }

            const difficulty = [1, 2, 3].includes(Number(item.difficulty || item.level))
                ? Number(item.difficulty || item.level)
                : 1;
            const seq = String(globalStartIndex + results.length + 1).padStart(2, '0');

            results.push({
                id: `EX-ENG-${Date.now()}-${ctx.order}-${i + 1}`,
                questionOrder: globalStartIndex + results.length + 1,
                questionType: qType,
                subDiscipline: String(item.subDiscipline || quota.subDiscipline || 'GENERAL'),
                difficulty,
                title: `B${ctx.order}-${qType}-C${seq}${item.title ? ` (${item.title})` : ''}`,
                questionText,
                dataJson: JSON.stringify(parsedData),
                explanation: cleanExplanation(explanation),
                points: Number(item.points) || 1,
                sourceLessonId: ctx.id,
                sourceLessonTitle: `Bài ${ctx.order}: ${ctx.title}`,
                sourceSection: String(item.sourceSection || `Bài ${ctx.order}`).trim(),
            });
        }

        return results;
    }

    /**
     * Export ExamQuestionSet to Moodle XML (All questions inside 1 single Moodle Category!)
     */
    async exportMoodleXml(userId: string, id: string, res: Response): Promise<void> {
        const examSet = await this.prisma.examQuestionSet.findUnique({
            where: { id },
        });
        if (!examSet || examSet.userId !== userId) {
            throw new NotFoundException('Không tìm thấy bộ đề kiểm tra.');
        }

        const questions = this.safeJsonParse<any[]>(examSet.questionsJson, []);
        const categorySlug = toMoodleCategorySlug(examSet.categoryName || examSet.title);
        const mode = (examSet.mode === 'ENGLISH' ? 'ENGLISH' : 'REVIEW') as 'REVIEW' | 'ENGLISH';

        const xml = buildSingleCategoryExamMoodleXml(questions, categorySlug, mode);
        const filename = `${categorySlug}_moodle.xml`;

        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
        res.attachment(filename);
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.send(xml);
    }

    /**
     * Export ExamQuestionSet to Excel (.xlsx) with Source Lesson & Source Section columns
     */
    async exportExcel(userId: string, id: string, res: Response): Promise<void> {
        const examSet = await this.prisma.examQuestionSet.findUnique({
            where: { id },
        });
        if (!examSet || examSet.userId !== userId) {
            throw new NotFoundException('Không tìm thấy bộ đề kiểm tra.');
        }

        const questions: any[] = this.safeJsonParse<any[]>(examSet.questionsJson, []);
        const categorySlug = toMoodleCategorySlug(examSet.categoryName || examSet.title);
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Đề kiểm tra');

        if (examSet.mode === 'ENGLISH') {
            worksheet.columns = [
                { header: 'STT', key: 'order', width: 6 },
                { header: 'Bài học nguồn', key: 'sourceLesson', width: 26 },
                { header: 'Mục / Slide nguồn', key: 'sourceSection', width: 24 },
                { header: 'Dạng câu', key: 'type', width: 12 },
                { header: 'Mức độ', key: 'difficulty', width: 14 },
                { header: 'Mã / Tiêu đề', key: 'title', width: 24 },
                { header: 'Nội dung câu hỏi', key: 'questionText', width: 48 },
                { header: 'Phương án / Đáp án', key: 'details', width: 45 },
                { header: 'Giải thích', key: 'explanation', width: 38 },
            ];

            worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
            worksheet.getRow(1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF1F497D' },
            };

            questions.forEach((q: any, idx: number) => {
                let details = '';
                try {
                    const data = typeof q.dataJson === 'string' ? JSON.parse(q.dataJson) : q.dataJson || {};
                    if (Array.isArray(data.options)) {
                        details = data.options
                            .map((o: any, oIdx: number) => {
                                const marker = o.fraction > 0 || o.isCorrect ? ' [✓]' : '';
                                return `${String.fromCharCode(65 + oIdx)}. ${o.text}${marker}`;
                            })
                            .join('\n');
                    } else if (Array.isArray(data.pairs)) {
                        details = data.pairs
                            .map((p: any) => `${p.left ?? p.subquestion ?? ''} ➔ ${p.right ?? p.answer ?? ''}`)
                            .join('\n');
                    } else if (data.clozeText) {
                        details = data.clozeText;
                    } else if (data.correctAnswer !== undefined) {
                        details = `Đáp án: ${String(data.correctAnswer)}`;
                    }
                } catch {
                    details = String(q.dataJson || '');
                }

                worksheet.addRow({
                    order: idx + 1,
                    sourceLesson: q.sourceLessonTitle || '',
                    sourceSection: q.sourceSection || '',
                    type: q.questionType || 'MC',
                    difficulty:
                        q.difficulty === 1
                            ? 'Mức 1 (Biết)'
                            : q.difficulty === 2
                            ? 'Mức 2 (Hiểu)'
                            : 'Mức 3 (Vận dụng)',
                    title: q.title || `Q${idx + 1}`,
                    questionText: q.questionText || q.question || '',
                    details,
                    explanation: q.explanation || '',
                });
            });
        } else {
            worksheet.columns = [
                { header: 'STT', key: 'stt', width: 6 },
                { header: 'Mã câu', key: 'questionId', width: 16 },
                { header: 'Bài học nguồn', key: 'sourceLesson', width: 26 },
                { header: 'Mục / Slide nguồn', key: 'sourceSection', width: 24 },
                { header: 'Mức độ', key: 'level', width: 15 },
                { header: 'Câu hỏi', key: 'question', width: 48 },
                { header: 'A (Đáp án đúng)', key: 'correctAnswer', width: 28 },
                { header: 'Phương án B', key: 'optionB', width: 28 },
                { header: 'Phương án C', key: 'optionC', width: 28 },
                { header: 'Phương án D', key: 'optionD', width: 28 },
                { header: 'Giải thích chi tiết', key: 'explanation', width: 40 },
            ];

            worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
            worksheet.getRow(1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF4472C4' },
            };

            questions.forEach((q: any, idx: number) => {
                worksheet.addRow({
                    stt: idx + 1,
                    questionId: q.questionId || `Q${idx + 1}`,
                    sourceLesson: q.sourceLessonTitle || '',
                    sourceSection: q.sourceSection || '',
                    level:
                        q.level === 1
                            ? 'Mức 1 (Biết)'
                            : q.level === 2
                            ? 'Mức 2 (Hiểu)'
                            : 'Mức 3 (Vận dụng)',
                    question: q.question || '',
                    correctAnswer: q.correctAnswer || '',
                    optionB: q.optionB || '',
                    optionC: q.optionC || '',
                    optionD: q.optionD || '',
                    explanation: q.explanation || '',
                });
            });
        }

        const filename = `${categorySlug}_exam_questions.xlsx`;
        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
        res.attachment(filename);
        await workbook.xlsx.write(res);
        res.end();
    }

    // ==================== PRIVATE UTILITIES ====================

    private parseQuestionsArrayFromAiResponse(rawResponse: string): any[] {
        if (!rawResponse) return [];
        let cleaned = rawResponse.trim();
        const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch && codeBlockMatch[1]) {
            cleaned = codeBlockMatch[1].trim();
        }

        try {
            const parsed = JSON.parse(cleaned);
            return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.questions) ? parsed.questions : [];
        } catch {
            const firstBrace = cleaned.indexOf('{');
            const lastBrace = cleaned.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace > firstBrace) {
                try {
                    const parsed = JSON.parse(cleaned.substring(firstBrace, lastBrace + 1));
                    return Array.isArray(parsed?.questions) ? parsed.questions : [];
                } catch {
                    // fallback to array brackets
                }
            }
            const firstBracket = cleaned.indexOf('[');
            const lastBracket = cleaned.lastIndexOf(']');
            if (firstBracket !== -1 && lastBracket > firstBracket) {
                try {
                    const parsed = JSON.parse(cleaned.substring(firstBracket, lastBracket + 1));
                    return Array.isArray(parsed) ? parsed : [];
                } catch {
                    return [];
                }
            }
            return [];
        }
    }

    private safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
        if (!raw) return fallback;
        try {
            return JSON.parse(raw) as T;
        } catch {
            return fallback;
        }
    }

    private formatExamSetSummary(examSet: any) {
        const lessonIds = this.safeJsonParse<string[]>(examSet.lessonIdsJson, []);
        const config = this.safeJsonParse<any>(examSet.configJson, {});
        const questions = this.safeJsonParse<any[]>(examSet.questionsJson, []);

        return {
            id: examSet.id,
            subjectId: examSet.subjectId,
            pptxSubjectId: examSet.pptxSubjectId,
            name: examSet.title,
            title: examSet.title,
            categoryName: examSet.categoryName,
            mode: examSet.mode,
            lessonIds,
            lessonCount: lessonIds.length,
            questionCount: questions.length,
            config,
            createdAt: examSet.createdAt,
            updatedAt: examSet.updatedAt,
        };
    }

    private formatExamSetDetail(examSet: any) {
        const summary = this.formatExamSetSummary(examSet);
        const questions = this.safeJsonParse<any[]>(examSet.questionsJson, []);
        return {
            ...summary,
            questions,
        };
    }
}
