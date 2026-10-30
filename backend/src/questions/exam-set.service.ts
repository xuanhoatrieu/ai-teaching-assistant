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
    upgradeClozeToMultichoice,
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
    syllabusLessonId?: string | null;
    lessonId?: string | null;
    originType?: 'bridged' | 'syllabus' | 'lesson' | 'pptx';
    order: number;
    title: string;
    displayTitle?: string;
    hasContent: boolean;
    contentSummary: string;
    sourceBadges?: string[];
    slideCount: number;
    reviewQuestionCount: number;
    englishQuestionCount: number;
    interactiveQuestionCount?: number;
    questionBankTotal?: number;
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
    displayTitle: string;
    subjectName: string;
    subjectContext: string;
    contentText: string;
    existingQuestionsSummary: string;
    excludedLessonsGuard: string;
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
     * List available created lessons of a Subject (unifying SyllabusLesson + Lesson 1-to-1)
     * or sessions of a PptxSubject, with full multi-source & question bank metrics.
     */
    async getLessonsOverview(
        userId: string,
        params: { subjectId?: string; pptxSubjectId?: string },
    ): Promise<{ subjectName: string; isEnglishSubject: boolean; lessons: ExamLessonOverviewItem[] }> {
        if (params.subjectId) {
            const subject = await this.prisma.subject.findUnique({
                where: { id: params.subjectId },
                include: {
                    syllabus: {
                        include: {
                            lessons: {
                                orderBy: { sortOrder: 'asc' },
                                select: {
                                    id: true,
                                    sortOrder: true,
                                    title: true,
                                    outline: true,
                                    textbookContent: true,
                                    textbookPlan: true,
                                    lessonId: true,
                                },
                            },
                            references: {
                                where: { status: 'done' },
                                select: {
                                    id: true,
                                    fileName: true,
                                    markdownContent: true,
                                },
                            },
                        },
                    },
                    lessons: {
                        orderBy: { createdAt: 'asc' },
                        include: {
                            syllabusLesson: {
                                select: {
                                    id: true,
                                    sortOrder: true,
                                    title: true,
                                    outline: true,
                                    textbookContent: true,
                                    textbookPlan: true,
                                },
                            },
                            questionBank: {
                                select: {
                                    questionsJson: true,
                                },
                            },
                            generatedContents: {
                                where: { type: 'HANDOUT' },
                                select: {
                                    contentJson: true,
                                },
                            },
                            _count: {
                                select: {
                                    slides: true,
                                    slideAudios: true,
                                    reviewQuestions: true,
                                    englishQuestions: true,
                                    interactiveQuestions: true,
                                },
                            },
                        },
                    },
                },
            });

            if (!subject || subject.userId !== userId) {
                throw new NotFoundException('Không tìm thấy môn học hoặc bạn không có quyền truy cập.');
            }

            const syllabusLessons = subject.syllabus?.lessons || [];
            const hasValidReferences = (subject.syllabus?.references || []).some((r) =>
                Boolean(r.markdownContent?.trim()),
            );
            const lessonById = new Map(subject.lessons.map((l) => [l.id, l]));
            const bridgedLessonIds = new Set<string>();

            const items: ExamLessonOverviewItem[] = [];

            // 1. Created lessons from Syllabus (both bridged to Lesson and unbridged SyllabusLesson)
            for (const sl of syllabusLessons) {
                const linkedLesson = sl.lessonId ? lessonById.get(sl.lessonId) : undefined;
                if (linkedLesson) {
                    bridgedLessonIds.add(linkedLesson.id);
                    items.push(
                        this.buildSubjectLessonOverviewItem({
                            order: sl.sortOrder + 1,
                            lesson: linkedLesson,
                            syllabusLesson: sl,
                            hasSubjectReferences: hasValidReferences,
                            originType: 'bridged',
                        }),
                    );
                } else {
                    items.push(
                        this.buildSubjectLessonOverviewItem({
                            order: sl.sortOrder + 1,
                            lesson: undefined,
                            syllabusLesson: sl,
                            hasSubjectReferences: hasValidReferences,
                            originType: 'syllabus',
                        }),
                    );
                }
            }

            // 2. Standalone created lessons in `lessons` table (not linked from syllabus_lessons)
            const standaloneLessons = subject.lessons.filter((l) => !bridgedLessonIds.has(l.id));
            if (standaloneLessons.length > 0) {
                const sortedStandalone = [...standaloneLessons].sort((a, b) => {
                    const numA = this.extractExplicitLessonNumber(a.title);
                    const numB = this.extractExplicitLessonNumber(b.title);
                    if (numA !== null && numB !== null && numA !== numB) {
                        return numA - numB;
                    }
                    return a.createdAt.getTime() - b.createdAt.getTime();
                });

                const usedOrders = new Set<number>(items.map((it) => it.order));
                let nextFallbackOrder =
                    items.length > 0 ? Math.max(...items.map((it) => it.order)) + 1 : 1;

                for (const lesson of sortedStandalone) {
                    const explicitNum = this.extractExplicitLessonNumber(lesson.title);
                    let assignedOrder: number;
                    if (
                        syllabusLessons.length === 0 &&
                        explicitNum !== null &&
                        explicitNum > 0 &&
                        !usedOrders.has(explicitNum)
                    ) {
                        assignedOrder = explicitNum;
                    } else {
                        while (usedOrders.has(nextFallbackOrder)) {
                            nextFallbackOrder++;
                        }
                        assignedOrder = nextFallbackOrder;
                        nextFallbackOrder++;
                    }
                    usedOrders.add(assignedOrder);

                    items.push(
                        this.buildSubjectLessonOverviewItem({
                            order: assignedOrder,
                            lesson,
                            syllabusLesson: lesson.syllabusLesson || undefined,
                            hasSubjectReferences: hasValidReferences,
                            originType: 'lesson',
                        }),
                    );
                }
            }

            const isEnglishSubject = this.detectEnglishSubject(
                subject.name,
                subject.majorName || subject.expertiseArea || '',
                items.some((i) => i.englishQuestionCount > 0) || subject.language === 'en',
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
                let interactiveCount = 0;
                try {
                    if (session.questionsJson) {
                        const parsed = JSON.parse(session.questionsJson);
                        if (Array.isArray(parsed)) {
                            reviewCount = parsed.length;
                        } else if (parsed && typeof parsed === 'object') {
                            reviewCount = Array.isArray(parsed.review) ? parsed.review.length : 0;
                            englishCount = Array.isArray(parsed.english) ? parsed.english.length : 0;
                            interactiveCount = Array.isArray(parsed.interactive) ? parsed.interactive.length : 0;
                        }
                    }
                } catch {
                    // ignore
                }

                const questionBankTotal = reviewCount + englishCount + interactiveCount;
                const hasContextDoc = Boolean(session.contextText?.trim());
                const hasContent = slideCount > 0 || hasContextDoc || questionBankTotal > 0;

                const sourceBadges: string[] = [];
                const summaryParts: string[] = [];
                if (slideCount > 0) {
                    summaryParts.push(`${slideCount} slides`);
                    sourceBadges.push(`📊 ${slideCount} Slides`);
                }
                if (hasContextDoc) {
                    const docLabel = session.contextFileName || 'Tài liệu đính kèm';
                    summaryParts.push(docLabel);
                    sourceBadges.push(`📎 ${docLabel}`);
                }
                if (questionBankTotal > 0) {
                    sourceBadges.push(`❓ ${questionBankTotal} câu ngân hàng`);
                }
                if (summaryParts.length === 0 && questionBankTotal === 0) {
                    summaryParts.push('Chưa có nội dung');
                }

                const rawTitle =
                    session.lessonTitle?.trim() ||
                    fixUtf8Filename(session.fileName).replace(/\.pptx$/i, '') ||
                    `Bài ${idx + 1}`;
                const order = idx + 1;
                const { cleanTopic, displayTitle } = this.normalizeLessonTitle(rawTitle, order);

                return {
                    id: session.id,
                    originType: 'pptx',
                    order,
                    title: cleanTopic,
                    displayTitle,
                    hasContent,
                    contentSummary: summaryParts.join(' • '),
                    sourceBadges,
                    slideCount,
                    reviewQuestionCount: reviewCount,
                    englishQuestionCount: englishCount,
                    interactiveQuestionCount: interactiveCount,
                    questionBankTotal,
                };
            });

            const isEnglishSubject = this.detectEnglishSubject(
                pptxSubject.name,
                pptxSubject.majorName || pptxSubject.expertiseArea || '',
                items.some((i) => i.englishQuestionCount > 0) || pptxSubject.language === 'en',
            );

            return {
                subjectName: pptxSubject.name,
                isEnglishSubject,
                lessons: items,
            };
        }

        throw new BadRequestException('Cần cung cấp subjectId hoặc pptxSubjectId.');
    }

    private buildSubjectLessonOverviewItem(input: {
        order: number;
        lesson?: any;
        syllabusLesson?: any;
        hasSubjectReferences: boolean;
        originType: 'bridged' | 'syllabus' | 'lesson';
    }): ExamLessonOverviewItem {
        const { order, lesson, syllabusLesson, hasSubjectReferences, originType } = input;
        const rawTitle = (lesson?.title || syllabusLesson?.title || `Bài ${order}`).trim();
        const { cleanTopic, displayTitle } = this.normalizeLessonTitle(rawTitle, order);

        const slideCount = lesson?._count?.slides || 0;
        const slideAudioCount = lesson?._count?.slideAudios || 0;
        const hasTextbook = Boolean(
            syllabusLesson?.textbookContent?.trim() || syllabusLesson?.textbookPlan?.trim(),
        );
        const hasSyllabusOutline = Boolean(syllabusLesson?.outline?.trim());
        const hasLessonOutline = Boolean(
            lesson?.detailedOutline?.trim() || lesson?.outlineRaw?.trim(),
        );
        const hasOutline = hasSyllabusOutline || hasLessonOutline;
        const hasScript = Boolean(lesson?.slideScript?.trim());
        const hasHandout = Boolean(
            Array.isArray(lesson?.generatedContents) &&
                lesson.generatedContents.some((gc: any) => Boolean(gc.contentJson?.trim())),
        );

        const reviewCount = lesson?._count?.reviewQuestions || 0;
        const englishCount = lesson?._count?.englishQuestions || 0;
        const interactiveCount = lesson?._count?.interactiveQuestions || 0;
        const qbParsed = this.safeJsonParse<any[]>(lesson?.questionBank?.questionsJson, []);
        const qbCount = Array.isArray(qbParsed) ? qbParsed.length : 0;
        // QuestionBank table may mirror or supplement reviewQuestions; count extra distinct questions accurately
        const effectiveReviewOrQb = Math.max(reviewCount, qbCount);
        const questionBankTotal = effectiveReviewOrQb + englishCount + interactiveCount;

        const hasRefSupport = hasSubjectReferences && Boolean(rawTitle || hasOutline);
        const hasContent =
            slideCount > 0 ||
            slideAudioCount > 0 ||
            hasTextbook ||
            hasOutline ||
            hasScript ||
            hasHandout ||
            questionBankTotal > 0 ||
            hasRefSupport;

        const summaryParts: string[] = [];
        const sourceBadges: string[] = [];

        if (hasTextbook) {
            summaryParts.push('Giáo trình');
            sourceBadges.push('📗 Giáo trình');
        }
        if (slideCount > 0) {
            summaryParts.push(`${slideCount} slides`);
            sourceBadges.push(`📊 ${slideCount} Slides`);
        } else if (hasScript) {
            summaryParts.push('Kịch bản slide');
            sourceBadges.push('📝 Kịch bản slide');
        }
        if (slideAudioCount > 0) {
            sourceBadges.push(`🎙️ Lời giảng (${slideAudioCount})`);
        }
        if (hasOutline) {
            summaryParts.push('Đề cương bài');
            sourceBadges.push('📋 Đề cương bài');
        }
        if (hasHandout) {
            summaryParts.push('Handout');
            sourceBadges.push('📄 Handout');
        }
        if (hasRefSupport) {
            summaryParts.push('Tài liệu TK');
            sourceBadges.push('📎 Tài liệu TK');
        }
        if (questionBankTotal > 0) {
            sourceBadges.push(`❓ Ngân hàng (${questionBankTotal} câu)`);
        }
        if (summaryParts.length === 0 && questionBankTotal === 0) {
            summaryParts.push('Chưa có nội dung');
        }

        const itemId = lesson ? lesson.id : `sl:${syllabusLesson.id}`;

        return {
            id: itemId,
            syllabusLessonId: syllabusLesson?.id || null,
            lessonId: lesson?.id || null,
            originType,
            order,
            title: cleanTopic,
            displayTitle,
            hasContent,
            contentSummary: summaryParts.join(' • '),
            sourceBadges,
            slideCount,
            reviewQuestionCount: effectiveReviewOrQb,
            englishQuestionCount: englishCount,
            interactiveQuestionCount: interactiveCount,
            questionBankTotal,
        };
    }

    private extractExplicitLessonNumber(title: string | null | undefined): number | null {
        if (!title) return null;
        const m = title
            .trim()
            .match(/^(?:Bài|Bai|Lesson|Unit|Chương|Chuong|Chapter|Chủ\s*đề|Topic)\s*0*(\d+)\b/i);
        if (!m || !m[1]) return null;
        const num = parseInt(m[1], 10);
        return Number.isFinite(num) && num > 0 ? num : null;
    }

    private normalizeLessonTitle(
        rawTitle: string,
        order: number,
    ): { cleanTopic: string; displayTitle: string } {
        const trimmed = (rawTitle || '').trim();
        const padded = String(order).padStart(2, '0');
        if (!trimmed) {
            return { cleanTopic: `Bài ${padded}`, displayTitle: `Bài ${padded}` };
        }
        const viPrefixMatch = trimmed.match(/^(?:Bài|Bai)\s*0*(\d+)\s*[:.\-–—_]\s*(.+)$/i);
        if (viPrefixMatch) {
            const numStr = String(parseInt(viPrefixMatch[1], 10) || order).padStart(2, '0');
            const topic = viPrefixMatch[2].trim();
            return {
                cleanTopic: topic || trimmed,
                displayTitle: `Bài ${numStr}: ${topic}`,
            };
        }
        const bareViMatch = trimmed.match(/^(?:Bài|Bai)\s*0*(\d+)$/i);
        if (bareViMatch) {
            const numStr = String(parseInt(bareViMatch[1], 10) || order).padStart(2, '0');
            return {
                cleanTopic: `Bài ${numStr}`,
                displayTitle: `Bài ${numStr}`,
            };
        }
        if (/^(?:Lesson|Unit|Chương|Chuong|Chapter|Chủ\s*đề|Topic)\s*\d+/i.test(trimmed)) {
            return {
                cleanTopic: trimmed,
                displayTitle: trimmed,
            };
        }
        return {
            cleanTopic: trimmed,
            displayTitle: `Bài ${padded}: ${trimmed}`,
        };
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
                (acc, id) => acc + Math.max(0, Math.floor(Number(dto.perLessonCounts?.[id] || 0))),
                0,
            );
            if (sum > 0) return Math.min(300, sum);
        }
        const l1 = Math.max(0, Math.floor(Number(dto.level1 ?? 20)));
        const l2 = Math.max(0, Math.floor(Number(dto.level2 ?? 20)));
        const l3 = Math.max(0, Math.floor(Number(dto.level3 ?? 10)));
        if (dto.totalCount && dto.totalCount > 0) {
            return Math.min(300, Math.floor(Number(dto.totalCount)));
        }
        return Math.min(300, Math.max(1, l1 + l2 + l3));
    }

    /**
     * Exact largest-remainder apportionment so level1 + level2 + level3 === count (100% guaranteed)
     */
    private apportionLevels(
        count: number,
        l1Ratio: number,
        l2Ratio: number,
        l3Ratio: number,
    ): { level1: number; level2: number; level3: number } {
        if (count <= 0) return { level1: 0, level2: 0, level3: 0 };
        const weights = [Math.max(0, l1Ratio), Math.max(0, l2Ratio), Math.max(0, l3Ratio)];
        const sum = weights[0] + weights[1] + weights[2];
        if (sum <= 0) {
            return { level1: count, level2: 0, level3: 0 };
        }
        const exact = weights.map((w) => (count * w) / sum);
        const floors = exact.map((v) => Math.floor(v));
        let rem = count - (floors[0] + floors[1] + floors[2]);
        const orderIdx = [0, 1, 2].sort((a, b) => exact[b] - floors[b] - (exact[a] - floors[a]));
        for (let i = 0; i < orderIdx.length && rem > 0; i++) {
            floors[orderIdx[i]] += 1;
            rem -= 1;
        }
        return {
            level1: floors[0],
            level2: floors[1],
            level3: floors[2],
        };
    }

    /**
     * Core Multi-Lesson Grounded Generation Pipeline:
     * Splits total requested questions evenly across selected lessons (or custom per-lesson counts),
     * then generates 100% NEW questions per selected lesson strictly bounded to that lesson's content & question bank.
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

        const requestedIdSet = new Set(dto.lessonIds);
        const selectedOverviews = overview.lessons.filter(
            (l) =>
                requestedIdSet.has(l.id) ||
                (l.syllabusLessonId && requestedIdSet.has(`sl:${l.syllabusLessonId}`)),
        );
        if (selectedOverviews.length === 0) {
            throw new BadRequestException('Không tìm thấy bài học hợp lệ trong danh sách đã chọn.');
        }

        const selectedCanonicalIds = new Set(selectedOverviews.map((l) => l.id));
        const unselectedOverviews = overview.lessons.filter((l) => !selectedCanonicalIds.has(l.id));

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

        // Compute per-lesson question allocations (auto evenly split or custom per-lesson)
        const totalRequested = this.resolveTotalRequested(dto);
        const l1Ratio = Math.max(0, Number(dto.level1 ?? 20));
        const l2Ratio = Math.max(0, Number(dto.level2 ?? 20));
        const l3Ratio = Math.max(0, Number(dto.level3 ?? 10));

        const lessonCount = selectedOverviews.length;
        const basePerLesson = Math.floor(totalRequested / lessonCount);
        const remainder = totalRequested % lessonCount;

        const allocations = selectedOverviews
            .map((lesson, idx) => {
                let count = basePerLesson + (idx < remainder ? 1 : 0);
                const customKey =
                    dto.perLessonCounts?.[lesson.id] !== undefined
                        ? lesson.id
                        : lesson.syllabusLessonId &&
                          dto.perLessonCounts?.[`sl:${lesson.syllabusLessonId}`] !== undefined
                        ? `sl:${lesson.syllabusLessonId}`
                        : null;
                if (customKey && dto.perLessonCounts) {
                    count = Math.max(0, Math.floor(Number(dto.perLessonCounts[customKey])));
                }
                const { level1, level2, level3 } = this.apportionLevels(
                    count,
                    l1Ratio,
                    l2Ratio,
                    l3Ratio,
                );
                return {
                    lesson,
                    count,
                    level1,
                    level2,
                    level3,
                };
            })
            .filter((a) => a.count > 0);

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
            const lessonLabel =
                alloc.lesson.displayTitle || `Bài ${alloc.lesson.order}: ${alloc.lesson.title}`;
            await this.jobService.updateProgress(
                jobId,
                progressPct,
                `Đang tạo ${alloc.count} câu hỏi mới từ ${lessonLabel} (${completedLessons + 1}/${allocations.length})...`,
            );

            const matchingExistingInExam = existingExamQuestions.filter(
                (q) =>
                    q.sourceLessonId === alloc.lesson.id ||
                    (alloc.lesson.syllabusLessonId &&
                        q.sourceLessonId === `sl:${alloc.lesson.syllabusLessonId}`),
            );

            const groundedContext = await this.extractLessonGroundedContext(
                userId,
                sourceType,
                alloc.lesson,
                matchingExistingInExam,
                unselectedOverviews,
                overview.lessons,
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
     * Extract 360-degree content + full existing question bank of ONE selected lesson,
     * strictly bounded to this lesson's scope (zero leakage from unselected lessons).
     */
    private async extractLessonGroundedContext(
        userId: string,
        sourceType: 'subject' | 'pptx',
        lessonOverview: ExamLessonOverviewItem,
        alreadyInExamSet: any[] = [],
        unselectedLessons: ExamLessonOverviewItem[] = [],
        allSubjectLessons: ExamLessonOverviewItem[] = [],
    ): Promise<GroundedLessonContext> {
        const lessonId = lessonOverview.id;
        const lessonOrder = lessonOverview.order;
        const excludedLessonsGuard =
            unselectedLessons.length > 0
                ? unselectedLessons
                      .map((u) => `- ${u.displayTitle || `Bài ${u.order}: ${u.title}`}`)
                      .join('\n')
                : '';

        if (sourceType === 'subject') {
            let lesson: any = null;
            let syllabusLesson: any = null;
            let subject: any = null;
            let allSyllabusLessons: Array<{ id: string; sortOrder: number; title: string; outline: string; lessonId: string | null }> = [];
            let syllabusReferences: Array<{ id: string; fileName: string; markdownContent: string | null }> = [];

            if (lessonId.startsWith('sl:')) {
                const slId = lessonId.slice(3);
                const slRecord = await this.prisma.syllabusLesson.findUnique({
                    where: { id: slId },
                    include: {
                        syllabus: {
                            include: {
                                subject: true,
                                lessons: {
                                    orderBy: { sortOrder: 'asc' },
                                    select: {
                                        id: true,
                                        sortOrder: true,
                                        title: true,
                                        outline: true,
                                        lessonId: true,
                                    },
                                },
                                references: {
                                    where: { status: 'done' },
                                    select: {
                                        id: true,
                                        fileName: true,
                                        markdownContent: true,
                                    },
                                },
                            },
                        },
                        lesson: {
                            include: {
                                slides: { orderBy: { slideIndex: 'asc' } },
                                slideAudios: { orderBy: { slideIndex: 'asc' } },
                                generatedContents: { where: { type: 'HANDOUT' } },
                                reviewQuestions: {
                                    orderBy: [{ level: 'asc' }, { questionOrder: 'asc' }],
                                },
                                englishQuestions: { orderBy: { questionOrder: 'asc' } },
                                interactiveQuestions: { orderBy: { questionOrder: 'asc' } },
                                questionBank: true,
                            },
                        },
                    },
                });

                if (!slRecord || !slRecord.syllabus?.subject) {
                    throw new NotFoundException(`Không tìm thấy bài học đề cương ${slId}`);
                }
                if (slRecord.syllabus.subject.userId !== userId) {
                    throw new NotFoundException('Bạn không có quyền truy cập bài học này.');
                }

                syllabusLesson = slRecord;
                lesson = slRecord.lesson || null;
                subject = slRecord.syllabus.subject;
                allSyllabusLessons = slRecord.syllabus.lessons || [];
                syllabusReferences = slRecord.syllabus.references || [];
            } else {
                const lessonRecord = await this.prisma.lesson.findUnique({
                    where: { id: lessonId },
                    include: {
                        subject: {
                            include: {
                                syllabus: {
                                    include: {
                                        lessons: {
                                            orderBy: { sortOrder: 'asc' },
                                            select: {
                                                id: true,
                                                sortOrder: true,
                                                title: true,
                                                outline: true,
                                                lessonId: true,
                                            },
                                        },
                                        references: {
                                            where: { status: 'done' },
                                            select: {
                                                id: true,
                                                fileName: true,
                                                markdownContent: true,
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        syllabusLesson: true,
                        slides: { orderBy: { slideIndex: 'asc' } },
                        slideAudios: { orderBy: { slideIndex: 'asc' } },
                        generatedContents: { where: { type: 'HANDOUT' } },
                        reviewQuestions: {
                            orderBy: [{ level: 'asc' }, { questionOrder: 'asc' }],
                        },
                        englishQuestions: { orderBy: { questionOrder: 'asc' } },
                        interactiveQuestions: { orderBy: { questionOrder: 'asc' } },
                        questionBank: true,
                    },
                });

                if (!lessonRecord || !lessonRecord.subject) {
                    throw new NotFoundException(`Không tìm thấy bài học ${lessonId}`);
                }
                if (lessonRecord.subject.userId !== userId) {
                    throw new NotFoundException('Bạn không có quyền truy cập bài học này.');
                }

                lesson = lessonRecord;
                syllabusLesson = lessonRecord.syllabusLesson || null;
                subject = lessonRecord.subject;
                allSyllabusLessons = lessonRecord.subject.syllabus?.lessons || [];
                syllabusReferences = lessonRecord.subject.syllabus?.references || [];
            }

            const rawTitle = (lesson?.title || syllabusLesson?.title || `Bài ${lessonOrder}`).trim();
            const { cleanTopic, displayTitle } = this.normalizeLessonTitle(rawTitle, lessonOrder);

            const contentSections: string[] = [];

            // 1. Giáo trình bài học (Textbook content + Backward Design Plan)
            if (syllabusLesson?.textbookContent?.trim()) {
                contentSections.push(
                    `=== GIÁO TRÌNH CHI TIẾT BÀI HỌC (${displayTitle}) ===\n` +
                        syllabusLesson.textbookContent.trim().substring(0, 24000),
                );
            }
            if (syllabusLesson?.textbookPlan?.trim()) {
                const planFormatted = this.formatTextbookPlanSummary(syllabusLesson.textbookPlan);
                if (planFormatted) {
                    contentSections.push(
                        `=== MỤC TIÊU & KHUNG KIẾN THỨC GIÁO TRÌNH (${displayTitle}) ===\n` +
                            planFormatted.substring(0, 4000),
                    );
                }
            }

            // 2. Slide bài giảng (bao gồm cả Slide.content + Slide.optimizedContentJson + SlideAudio.speakerNote)
            if (lesson && Array.isArray(lesson.slides) && lesson.slides.length > 0) {
                const audioNoteMap = new Map<number, string>();
                if (Array.isArray(lesson.slideAudios)) {
                    for (const sa of lesson.slideAudios) {
                        if (sa.speakerNote?.trim()) {
                            audioNoteMap.set(sa.slideIndex, sa.speakerNote.trim());
                        }
                    }
                }

                const slidesStr = lesson.slides
                    .map((s: any) => {
                        const slideBody = this.extractFullSlideText(s);
                        const bestNote =
                            audioNoteMap.get(s.slideIndex) || s.speakerNote?.trim() || '';
                        const parts = [`[Slide ${s.slideIndex}: ${s.title || ''}]`];
                        if (slideBody) {
                            parts.push(`Nội dung slide:\n${slideBody}`);
                        }
                        if (bestNote) {
                            parts.push(`Lời giảng / Thuyết minh:\n${bestNote}`);
                        }
                        return parts.join('\n');
                    })
                    .join('\n\n---\n\n');

                if (slidesStr.trim()) {
                    contentSections.push(
                        `=== NỘI DUNG SLIDE & LỜI GIẢNG BÀI HỌC (${displayTitle}) ===\n` +
                            slidesStr.substring(0, 24000),
                    );
                }
            } else if (lesson?.slideScript?.trim()) {
                contentSections.push(
                    `=== KỊCH BẢN SLIDE BÀI GIẢNG (${displayTitle}) ===\n` +
                        lesson.slideScript.trim().substring(0, 20000),
                );
            }

            // 3. Đề cương riêng của bài học (SyllabusLesson.outline + Lesson.detailedOutline / outlineRaw)
            if (syllabusLesson?.outline?.trim()) {
                contentSections.push(
                    `=== ĐỀ CƯƠNG BÀI HỌC TRONG HỌC PHẦN (${displayTitle}) ===\n` +
                        syllabusLesson.outline.trim().substring(0, 8000),
                );
            }
            if (lesson?.detailedOutline?.trim() || lesson?.outlineRaw?.trim()) {
                const lessonOutline = (lesson.detailedOutline || lesson.outlineRaw || '').trim();
                // Avoid exact duplicate if outlineRaw was just copied verbatim from syllabusLesson.outline
                if (lessonOutline && lessonOutline !== syllabusLesson?.outline?.trim()) {
                    contentSections.push(
                        `=== DÀN BÀI CHI TIẾT BÀI GIẢNG (${displayTitle}) ===\n` +
                            lessonOutline.substring(0, 10000),
                    );
                }
            }

            // 4. Tài liệu Handout của bài học (GeneratedContent type = HANDOUT)
            if (lesson && Array.isArray(lesson.generatedContents)) {
                for (const gc of lesson.generatedContents) {
                    if (gc.contentJson?.trim()) {
                        const handoutText = this.formatHandoutContent(gc.contentJson);
                        if (handoutText) {
                            contentSections.push(
                                `=== TÀI LIỆU HANDOUT BÀI HỌC (${displayTitle}) ===\n` +
                                    handoutText.substring(0, 8000),
                            );
                        }
                    }
                }
            }

            // 5. Tài liệu tham khảo (SyllabusReference) — LỌC KHÓA PHẠM VI CHỈ RIÊNG BÀI HỌC NÀY
            if (syllabusReferences.length > 0) {
                const thisOutlineCombined = [
                    syllabusLesson?.outline || '',
                    lesson?.outlineRaw || '',
                    lesson?.detailedOutline || '',
                ]
                    .filter(Boolean)
                    .join('\n');

                const otherLessonDescriptors = this.collectOtherLessonDescriptors(
                    lessonOverview,
                    allSyllabusLessons,
                    allSubjectLessons,
                );

                const scopedRefText = this.extractLessonScopedReferencePassages(
                    displayTitle,
                    cleanTopic,
                    thisOutlineCombined,
                    otherLessonDescriptors,
                    syllabusReferences,
                    10000,
                );

                if (scopedRefText) {
                    contentSections.push(
                        `=== TRÍCH ĐOẠN TÀI LIỆU THAM KHẢO THUỘC RIÊNG PHẠM VI ${displayTitle} ===\n` +
                            scopedRefText,
                    );
                }
            }

            // 6. Toàn bộ Ngân hàng câu hỏi đã có của bài học (Review + English + Interactive + QuestionBank + Đề hiện tại)
            const existingItems = this.extractFullLessonQuestionBank(lesson, alreadyInExamSet);

            // Nếu bài học mới chỉ có Ngân hàng câu hỏi mà chưa có văn bản slide/giáo trình, dùng tri thức từ Ngân hàng câu hỏi làm nguồn
            if (contentSections.length === 0 && existingItems.length > 0) {
                contentSections.push(
                    `=== ĐƠN VỊ KIẾN THỨC TRỌNG TÂM TỪ NGÂN HÀNG CÂU HỎI CỦA BÀI (${displayTitle}) ===\n` +
                        existingItems.join('\n').substring(0, 22000),
                );
            }

            const fullContent = contentSections.join('\n\n').trim();
            if (!fullContent) {
                throw new BadRequestException(
                    `Bài học "${displayTitle}" chưa có nội dung (đề cương bài, giáo trình, slide, tài liệu tham khảo hoặc ngân hàng câu hỏi). Vui lòng biên soạn nội dung cho bài học trước.`,
                );
            }

            const subjectContextParts: string[] = [];
            if (subject.majorName || subject.expertiseArea) {
                subjectContextParts.push(
                    `Chuyên ngành: ${subject.majorName || subject.expertiseArea}`,
                );
            }
            if (subject.targetAudience) {
                subjectContextParts.push(`Đối tượng: ${subject.targetAudience}`);
            }
            if (subject.additionalContext) {
                subjectContextParts.push(`Định hướng môn học: ${subject.additionalContext}`);
            }

            return {
                id: lessonOverview.id,
                order: lessonOrder,
                title: cleanTopic,
                displayTitle,
                subjectName: subject.name,
                subjectContext: subjectContextParts.join(' | '),
                contentText: fullContent,
                existingQuestionsSummary:
                    existingItems.length > 0
                        ? existingItems.join('\n')
                        : '(Bài học này chưa có câu hỏi cũ trong ngân hàng câu hỏi)',
                excludedLessonsGuard,
            };
        }

        // sourceType === 'pptx'
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: lessonId },
            include: { pptxSubject: true },
        });

        if (!session || session.userId !== userId) {
            throw new NotFoundException(`Không tìm thấy bài giảng PPTX ${lessonId}`);
        }

        const rawTitle =
            session.lessonTitle?.trim() ||
            fixUtf8Filename(session.fileName).replace(/\.pptx$/i, '') ||
            `Bài ${lessonOrder}`;
        const { cleanTopic, displayTitle } = this.normalizeLessonTitle(rawTitle, lessonOrder);

        const contentSections: string[] = [];
        if (session.contextText?.trim()) {
            contentSections.push(
                `=== TÀI LIỆU THAM KHẢO / GIÁO TRÌNH ĐÍNH KÈM (${session.contextFileName || 'Tài liệu bài học'}) ===\n` +
                    session.contextText.trim().substring(0, 30000),
            );
        }

        const contentArr = this.safeJsonParse<any[]>(session.contentJson || '[]', []);
        const slidesArr = this.safeJsonParse<any[]>(session.slidesJson || '[]', []);
        const slideLen = Math.max(
            Array.isArray(contentArr) ? contentArr.length : 0,
            Array.isArray(slidesArr) ? slidesArr.length : 0,
        );

        if (slideLen > 0) {
            const slidesTextList: string[] = [];
            for (let idx = 0; idx < slideLen; idx++) {
                const cSlide = Array.isArray(contentArr) ? contentArr[idx] : null;
                const sSlide = Array.isArray(slidesArr) ? slidesArr[idx] : null;
                const slideNum = (sSlide?.index ?? cSlide?.index ?? idx) + 1;
                const slideTitle = sSlide?.title || cSlide?.title || '';
                const rawBullets = cSlide?.content ?? sSlide?.content ?? [];
                const bulletText = Array.isArray(rawBullets)
                    ? rawBullets.join('\n')
                    : String(rawBullets || '');
                const optItems = Array.isArray(sSlide?.optimizedContent)
                    ? sSlide.optimizedContent
                          .map((b: any) =>
                              [b?.point, b?.description].filter(Boolean).join(': ').trim(),
                          )
                          .filter(Boolean)
                          .join('\n')
                    : '';
                const combinedSlideBody = [bulletText.trim(), optItems.trim()]
                    .filter(Boolean)
                    .join('\n');
                const slideNote =
                    sSlide?.noteFull || sSlide?.noteVN || sSlide?.noteEN || '';

                slidesTextList.push(
                    `[Slide ${slideNum}: ${slideTitle}]` +
                        (combinedSlideBody ? `\nNội dung:\n${combinedSlideBody}` : '') +
                        (slideNote ? `\nLời giảng / Speaker note:\n${slideNote}` : ''),
                );
            }
            contentSections.push(
                `=== NỘI DUNG CÁC SLIDE BÀI GIẢNG ===\n${slidesTextList.join('\n\n---\n\n').substring(0, 30000)}`,
            );
        }

        const existingItems: string[] = [];
        const sessionQuestions = this.safeJsonParse<any>(session.questionsJson || '{}', {});
        const reviewList = Array.isArray(sessionQuestions)
            ? sessionQuestions
            : Array.isArray(sessionQuestions?.review)
            ? sessionQuestions.review
            : [];
        const englishList = Array.isArray(sessionQuestions?.english)
            ? sessionQuestions.english
            : [];
        const interactiveList = Array.isArray(sessionQuestions?.interactive)
            ? sessionQuestions.interactive
            : [];

        for (const rq of reviewList.slice(0, 60)) {
            const distractors = [rq.optionB, rq.optionC, rq.optionD].filter(Boolean).join('; ');
            existingItems.push(
                `- [Ôn tập Mức ${rq.level || 1}] ${rq.question} | Đáp án đúng: ${rq.correctAnswer}` +
                    (distractors ? ` | Nhiễu: ${distractors}` : '') +
                    (rq.explanation ? ` | Giải thích: ${rq.explanation}` : ''),
            );
        }
        for (const eq of englishList.slice(0, 60)) {
            const detail = this.summarizeEnglishQuestionData(eq.dataJson || eq.data);
            existingItems.push(
                `- [Tiếng Anh ${eq.questionType || 'MC'} - Mức ${eq.difficulty || 1}] ${eq.questionText}` +
                    (detail ? ` | Đáp án: ${detail}` : '') +
                    (eq.explanation ? ` | Giải thích: ${eq.explanation}` : ''),
            );
        }
        for (const iq of interactiveList.slice(0, 30)) {
            const ans = Array.isArray(iq.answers) ? iq.answers.join('; ') : '';
            existingItems.push(
                `- [Tương tác ${iq.questionType || 'MC'}] ${iq.questionText}` +
                    (ans ? ` | Phương án: ${ans}` : ''),
            );
        }
        for (const ex of alreadyInExamSet.slice(0, 60)) {
            existingItems.push(`- [Đã có trong đề kiểm tra này] ${ex.question || ex.questionText}`);
        }

        if (contentSections.length === 0 && existingItems.length > 0) {
            contentSections.push(
                `=== ĐƠN VỊ KIẾN THỨC TỪ NGÂN HÀNG CÂU HỎI BÀI GIẢNG ===\n` +
                    existingItems.join('\n').substring(0, 22000),
            );
        }

        const fullContent = contentSections.join('\n\n').trim();
        if (!fullContent) {
            throw new BadRequestException(
                `Bài giảng "${displayTitle}" chưa có nội dung slide, tài liệu đính kèm hoặc ngân hàng câu hỏi.`,
            );
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
            title: cleanTopic,
            displayTitle,
            subjectName: sub?.name || 'Môn học',
            subjectContext: subjectContextParts.join(' | '),
            contentText: fullContent,
            existingQuestionsSummary:
                existingItems.length > 0
                    ? existingItems.join('\n')
                    : '(Bài học này chưa có câu hỏi cũ trong ngân hàng câu hỏi)',
            excludedLessonsGuard,
        };
    }

    /**
     * Extract full slide text from BOTH Slide.content AND Slide.optimizedContentJson (+ interactiveData)
     */
    private extractFullSlideText(slide: any): string {
        const parts: string[] = [];
        if (slide?.content?.trim()) {
            parts.push(slide.content.trim());
        }
        if (slide?.optimizedContentJson?.trim()) {
            const parsedOpt = this.safeJsonParse<any>(slide.optimizedContentJson, null);
            const bullets = Array.isArray(parsedOpt)
                ? parsedOpt
                : Array.isArray(parsedOpt?.bullets)
                ? parsedOpt.bullets
                : [];
            if (bullets.length > 0) {
                const optLines = bullets
                    .map((b: any) => {
                        if (typeof b === 'string') return `- ${b.trim()}`;
                        const pt = String(b?.point || '').trim();
                        const desc = String(b?.description || '').trim();
                        if (pt && desc) return `- ${pt}: ${desc}`;
                        return pt || desc ? `- ${pt || desc}` : '';
                    })
                    .filter(Boolean);
                if (optLines.length > 0) {
                    const optBlock = optLines.join('\n');
                    if (!parts.some((p) => p.includes(optBlock))) {
                        parts.push(optBlock);
                    }
                }
            }
        }
        return parts.join('\n');
    }

    private formatTextbookPlanSummary(rawPlan: string): string {
        const plan = this.safeJsonParse<any>(rawPlan, null);
        if (!plan || typeof plan !== 'object') {
            return rawPlan.trim();
        }
        const lines: string[] = [];
        if (Array.isArray(plan.learningOutcomes) && plan.learningOutcomes.length > 0) {
            lines.push(`Chuẩn đầu ra bài học:\n- ${plan.learningOutcomes.join('\n- ')}`);
        }
        if (plan.contentOutline) {
            lines.push(`Đề cương chi tiết:\n${String(plan.contentOutline)}`);
        }
        if (Array.isArray(plan.keyTerms) && plan.keyTerms.length > 0) {
            lines.push(`Thuật ngữ trọng tâm: ${plan.keyTerms.join(', ')}`);
        }
        return lines.join('\n\n').trim();
    }

    private formatHandoutContent(rawContentJson: string): string {
        const parsed = this.safeJsonParse<any>(rawContentJson, null);
        if (!parsed) return rawContentJson.trim();
        if (typeof parsed === 'string') return parsed.trim();
        const lines: string[] = [];
        if (parsed.title) lines.push(`Tiêu đề: ${parsed.title}`);
        if (parsed.summary || parsed.overview) {
            lines.push(String(parsed.summary || parsed.overview));
        }
        if (Array.isArray(parsed.sections)) {
            for (const sec of parsed.sections) {
                const heading = sec?.heading || sec?.title || '';
                const body = Array.isArray(sec?.content)
                    ? sec.content.join('\n')
                    : String(sec?.content || sec?.body || '');
                if (heading || body) {
                    lines.push(`${heading ? `## ${heading}\n` : ''}${body}`.trim());
                }
            }
        }
        if (Array.isArray(parsed.keyTakeaways) && parsed.keyTakeaways.length > 0) {
            lines.push(`Điểm chính:\n- ${parsed.keyTakeaways.join('\n- ')}`);
        }
        return lines.length > 0 ? lines.join('\n\n').trim() : JSON.stringify(parsed);
    }

    /**
     * Collect full existing question bank of a Lesson across ALL 4 question tables + existing exam set
     * so AI understands the lesson's assessment focus & creates 100% NEW questions without duplication.
     */
    private extractFullLessonQuestionBank(lesson: any, alreadyInExamSet: any[]): string[] {
        const items: string[] = [];
        const seenStems = new Set<string>();
        const normStem = (s: string) =>
            String(s || '')
                .toLowerCase()
                .replace(/\s+/g, ' ')
                .trim();

        if (lesson) {
            // 1. ReviewQuestion (Bloom 3 levels)
            const reviewQs = Array.isArray(lesson.reviewQuestions) ? lesson.reviewQuestions : [];
            for (const rq of reviewQs.slice(0, 80)) {
                const stem = String(rq.question || '').trim();
                if (!stem) continue;
                seenStems.add(normStem(stem));
                const distractors = [rq.optionB, rq.optionC, rq.optionD]
                    .map((o) => String(o || '').trim())
                    .filter(Boolean)
                    .join('; ');
                items.push(
                    `- [Câu hỏi Ôn tập bài học - Mức ${rq.level || 1}] Câu hỏi: ${stem} | Đáp án đúng: ${rq.correctAnswer}` +
                        (distractors ? ` | Phương án nhiễu: ${distractors}` : '') +
                        (rq.explanation ? ` | Giải thích: ${rq.explanation}` : ''),
                );
            }

            // 2. QuestionBank (question_banks.questionsJson — supplement any questions not already in reviewQuestions)
            if (lesson.questionBank?.questionsJson) {
                const qbList = this.safeJsonParse<any[]>(lesson.questionBank.questionsJson, []);
                if (Array.isArray(qbList)) {
                    for (const qb of qbList.slice(0, 80)) {
                        const stem = String(qb?.question || qb?.questionText || '').trim();
                        if (!stem || seenStems.has(normStem(stem))) continue;
                        seenStems.add(normStem(stem));
                        const distractors = [qb?.optionB, qb?.optionC, qb?.optionD]
                            .map((o) => String(o || '').trim())
                            .filter(Boolean)
                            .join('; ');
                        items.push(
                            `- [Ngân hàng câu hỏi bài học - Mức ${qb?.level || 1}] Câu hỏi: ${stem} | Đáp án đúng: ${qb?.correctAnswer || ''}` +
                                (distractors ? ` | Phương án nhiễu: ${distractors}` : '') +
                                (qb?.explanation ? ` | Giải thích: ${qb.explanation}` : ''),
                        );
                    }
                }
            }

            // 3. EnglishQuestion (MC, MR, MATCH, CLOZE, TRUEFALSE with full dataJson)
            const englishQs = Array.isArray(lesson.englishQuestions) ? lesson.englishQuestions : [];
            for (const eq of englishQs.slice(0, 80)) {
                const stem = String(eq.questionText || '').trim();
                if (!stem) continue;
                seenStems.add(normStem(stem));
                const detail = this.summarizeEnglishQuestionData(eq.dataJson);
                items.push(
                    `- [Ngân hàng Tiếng Anh - ${eq.questionType || 'MC'} - Mức ${eq.difficulty || 1}] ${stem}` +
                        (detail ? ` | Chi tiết đáp án: ${detail}` : '') +
                        (eq.explanation ? ` | Giải thích: ${eq.explanation}` : ''),
                );
            }

            // 4. InteractiveQuestion (answer1..answer10 + feedback)
            const interactiveQs = Array.isArray(lesson.interactiveQuestions)
                ? lesson.interactiveQuestions
                : [];
            for (const iq of interactiveQs.slice(0, 40)) {
                const stem = String(iq.questionText || '').trim();
                if (!stem || seenStems.has(normStem(stem))) continue;
                seenStems.add(normStem(stem));
                const rawAnswers: string[] = [];
                for (let k = 1; k <= 10; k++) {
                    const val = iq[`answer${k}`];
                    if (typeof val === 'string' && val.trim()) {
                        const t = val.trim();
                        rawAnswers.push(
                            t.startsWith('*') ? `${t.slice(1).trim()} [✓]` : t,
                        );
                    }
                }
                items.push(
                    `- [Câu hỏi Tương tác bài học - ${iq.questionType || 'MC'}] ${stem}` +
                        (rawAnswers.length > 0 ? ` | Phương án: ${rawAnswers.join('; ')}` : '') +
                        (iq.correctFeedback ? ` | Giải thích: ${iq.correctFeedback}` : ''),
                );
            }
        }

        // 5. Questions already generated in this ExamQuestionSet for this lesson
        for (const ex of alreadyInExamSet.slice(0, 80)) {
            const stem = String(ex?.question || ex?.questionText || '').trim();
            if (!stem) continue;
            items.push(
                `- [Đã có trong đề kiểm tra này] ${stem}` +
                    (ex?.correctAnswer ? ` (Đáp án: ${ex.correctAnswer})` : ''),
            );
        }

        return items;
    }

    private summarizeEnglishQuestionData(rawDataJson: any): string {
        const data =
            typeof rawDataJson === 'string'
                ? this.safeJsonParse<any>(rawDataJson, {})
                : rawDataJson || {};
        if (!data || typeof data !== 'object') return '';
        if (Array.isArray(data.options) && data.options.length > 0) {
            return data.options
                .map((o: any) => {
                    const txt = String(o?.text ?? o?.answer ?? '').trim();
                    const isRight = Number(o?.fraction) > 0 || Boolean(o?.isCorrect);
                    return isRight ? `${txt} [✓]` : txt;
                })
                .filter(Boolean)
                .join('; ');
        }
        if (Array.isArray(data.pairs) && data.pairs.length > 0) {
            return data.pairs
                .map((p: any) => `${p?.left ?? p?.subquestion ?? ''} -> ${p?.right ?? p?.answer ?? ''}`)
                .join('; ');
        }
        if (data.clozeText) {
            return String(data.clozeText).substring(0, 350);
        }
        if (data.correctAnswer !== undefined) {
            return String(data.correctAnswer);
        }
        return '';
    }

    private collectOtherLessonDescriptors(
        currentOverview: ExamLessonOverviewItem,
        allSyllabusLessons: Array<{
            id: string;
            sortOrder: number;
            title: string;
            outline: string;
            lessonId: string | null;
        }>,
        allSubjectLessons: ExamLessonOverviewItem[],
    ): Array<{ title: string; outline: string }> {
        const others: Array<{ title: string; outline: string }> = [];
        const currentSlId =
            currentOverview.syllabusLessonId ||
            (currentOverview.id.startsWith('sl:') ? currentOverview.id.slice(3) : null);
        const currentLessonId = currentOverview.lessonId || currentOverview.id;

        const seenIds = new Set<string>();
        for (const sl of allSyllabusLessons) {
            if (currentSlId && sl.id === currentSlId) continue;
            if (sl.lessonId && sl.lessonId === currentLessonId) continue;
            seenIds.add(sl.id);
            if (sl.lessonId) seenIds.add(sl.lessonId);
            others.push({ title: sl.title || '', outline: sl.outline || '' });
        }

        for (const ov of allSubjectLessons) {
            if (ov.id === currentOverview.id) continue;
            if (ov.syllabusLessonId && seenIds.has(ov.syllabusLessonId)) continue;
            if (ov.lessonId && seenIds.has(ov.lessonId)) continue;
            others.push({ title: ov.displayTitle || ov.title || '', outline: '' });
        }

        return others;
    }

    /**
     * Extract ONLY reference document passages that strongly match THIS lesson's title/outline
     * AND score strictly higher for THIS lesson than for any OTHER lesson in the Subject.
     * Prevents cross-lesson content leakage from whole-course reference books.
     */
    private extractLessonScopedReferencePassages(
        displayTitle: string,
        cleanTopic: string,
        lessonOutline: string,
        otherLessons: Array<{ title: string; outline: string }>,
        references: Array<{ fileName: string; markdownContent: string | null }>,
        maxTotalChars = 10000,
    ): string {
        const thisTitleTokens = this.tokenizeForScopeMatch(`${displayTitle} ${cleanTopic}`);
        const thisOutlineTokens = this.tokenizeForScopeMatch(lessonOutline);
        if (thisTitleTokens.size === 0 && thisOutlineTokens.size === 0) {
            return '';
        }

        const otherTokenSets = otherLessons
            .map((o) => ({
                titleTokens: this.tokenizeForScopeMatch(o.title),
                outlineTokens: this.tokenizeForScopeMatch(o.outline),
            }))
            .filter((o) => o.titleTokens.size > 0 || o.outlineTokens.size > 0);

        const scoredChunks: Array<{ fileName: string; text: string; score: number }> = [];

        for (const ref of references) {
            const md = ref.markdownContent?.trim();
            if (!md) continue;

            const rawBlocks = this.splitReferenceIntoBlocks(md, 1400);
            for (const block of rawBlocks) {
                const headingLine = block.split('\n')[0] || '';
                const headingTokens = this.tokenizeForScopeMatch(headingLine);
                const bodyTokens = this.tokenizeForScopeMatch(block);
                if (bodyTokens.size === 0) continue;

                const thisScore = this.computeScopeAffinity(
                    thisTitleTokens,
                    thisOutlineTokens,
                    headingTokens,
                    bodyTokens,
                );
                if (thisScore < 0.18) continue;

                let maxOtherScore = 0;
                for (const other of otherTokenSets) {
                    const oScore = this.computeScopeAffinity(
                        other.titleTokens,
                        other.outlineTokens,
                        headingTokens,
                        bodyTokens,
                    );
                    if (oScore > maxOtherScore) {
                        maxOtherScore = oScore;
                    }
                }

                // Strict boundary guard: passage must belong more strongly to THIS lesson than any other lesson
                if (otherTokenSets.length > 0 && thisScore <= maxOtherScore * 1.12) {
                    continue;
                }

                scoredChunks.push({
                    fileName: ref.fileName,
                    text: block,
                    score: thisScore - maxOtherScore * 0.5,
                });
            }
        }

        if (scoredChunks.length === 0) return '';

        scoredChunks.sort((a, b) => b.score - a.score);
        const picked: string[] = [];
        let usedChars = 0;
        for (const chunk of scoredChunks.slice(0, 8)) {
            const formatted = `[Nguồn: ${chunk.fileName}]\n${chunk.text}`;
            if (usedChars + formatted.length > maxTotalChars && picked.length > 0) {
                break;
            }
            picked.push(formatted);
            usedChars += formatted.length;
        }

        return picked.join('\n\n---\n\n');
    }

    private splitReferenceIntoBlocks(markdown: string, maxChars = 1400): string[] {
        const sections = markdown.split(/\n(?=#{1,6}\s)/g);
        const blocks: string[] = [];
        for (const sec of sections) {
            const trimmed = sec.trim();
            if (!trimmed) continue;
            if (trimmed.length <= maxChars) {
                blocks.push(trimmed);
                continue;
            }
            const firstNewline = trimmed.indexOf('\n');
            const secHeading =
                firstNewline > 0 && trimmed.startsWith('#')
                    ? trimmed.slice(0, firstNewline).trim()
                    : '';
            const paragraphs = trimmed.split(/\n\s*\n/);
            let current = '';
            for (const p of paragraphs) {
                const candidate = current ? `${current}\n\n${p}` : p;
                if (candidate.length > maxChars && current) {
                    blocks.push(current.trim());
                    current = secHeading ? `${secHeading}\n${p}` : p;
                } else {
                    current = candidate;
                }
            }
            if (current.trim()) blocks.push(current.trim());
        }
        return blocks;
    }

    private tokenizeForScopeMatch(text: string): Set<string> {
        if (!text) return new Set();
        const stopWords = new Set([
            'bai', 'bài', 'chuong', 'chương', 'phan', 'phần', 'muc', 'mục', 'gioi', 'giới',
            'thieu', 'thiệu', 'tong', 'tổng', 'quan', 'noi', 'nội', 'dung', 'chinh', 'chính',
            'hoc', 'học', 'sinh', 'vien', 'viên', 'trong', 'cua', 'của', 'cac', 'các', 'voi',
            'với', 'cho', 'theo', 'tren', 'trên', 'duoi', 'dưới', 'nhung', 'những', 'mot',
            'một', 'hai', 'ba', 'bon', 'nam', 'sau', 'bay', 'tam', 'chin', 'muoi', 'the',
            'and', 'for', 'with', 'from', 'that', 'this', 'into', 'lesson', 'unit', 'chapter',
            'topic', 'introduction', 'overview', 'section', 'part',
        ]);
        const tokens = text
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .split(/\s+/)
            .filter((t) => t.length >= 3 && !stopWords.has(t) && !/^\d+$/.test(t));
        return new Set(tokens);
    }

    private computeScopeAffinity(
        titleTokens: Set<string>,
        outlineTokens: Set<string>,
        headingTokens: Set<string>,
        bodyTokens: Set<string>,
    ): number {
        let titleHitsInHeading = 0;
        let titleHitsInBody = 0;
        for (const t of titleTokens) {
            if (headingTokens.has(t)) titleHitsInHeading++;
            if (bodyTokens.has(t)) titleHitsInBody++;
        }

        let outlineHitsInBody = 0;
        for (const t of outlineTokens) {
            if (bodyTokens.has(t)) outlineHitsInBody++;
        }

        const titleScore =
            titleTokens.size > 0
                ? (titleHitsInHeading * 1.6 + titleHitsInBody) / titleTokens.size
                : 0;
        const outlineScore =
            outlineTokens.size > 0
                ? outlineHitsInBody / Math.min(outlineTokens.size, 25)
                : 0;

        if (titleTokens.size > 0 && outlineTokens.size > 0) {
            return titleScore * 0.65 + outlineScore * 0.35;
        }
        return titleTokens.size > 0 ? titleScore : outlineScore;
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
        const excludedGuardBlock = ctx.excludedLessonsGuard
            ? `\n[PHẠM VI CẤM — CÁC BÀI HỌC KHÔNG ĐƯỢC CHỌN TRONG ĐỀ KIỂM TRA NÀY]:\n${ctx.excludedLessonsGuard}\n=> TUYỆT ĐỐI CẤM đặt bất kỳ câu hỏi, đáp án hay tình huống nào lấn sang nội dung riêng của các bài không được chọn ở trên.\n`
            : '';

        const prompt = `Bạn là Chuyên gia Khảo thí & Đo lường Giáo dục Đại học.
Nhiệm vụ của bạn là biên soạn THÊM CHÍNH XÁC ${quota.total} câu hỏi trắc nghiệm khách quan MỚI (4 lựa chọn) cho ĐỀ KIỂM TRA từ duy nhất bài học: "${ctx.displayTitle}" thuộc môn "${ctx.subjectName}".
${ctx.subjectContext ? `Thông tin môn học: ${ctx.subjectContext}` : ''}

=====================================================================
QUY TẮC KHẢO THÍ TỐI THƯỢNG (BẮT BUỘC TUÂN THỦ 100%):
1. GIỚI HẠN CỨNG TRONG PHẠM VI BÀI HỌC ĐÃ CHỌN (STRICT LESSON-SCOPE GROUNDING):
   - 100% câu hỏi, đáp án đúng, phương án nhiễu và giải thích BẮT BUỘC chỉ được nằm trong giới hạn nội dung của bài "${ctx.displayTitle}" dựa trên [NỘI DUNG BÀI HỌC NGUỒN] và [NGÂN HÀNG CÂU HỎI ĐÃ CÓ CỦA BÀI HỌC] bên dưới.
   - TUYỆT ĐỐI CẤM đưa bất kỳ kiến thức, khái niệm, số liệu hay chủ đề nào nằm ngoài bài học này hoặc thuộc các bài học khác chưa chọn.
2. KHAI THÁC NGÂN HÀNG CÂU HỎI CỦA BÀI ĐỂ TẠO THÊM CÂU HỎI MỚI 100%:
   - Phân tích kỹ cả [NỘI DUNG BÀI HỌC NGUỒN] lẫn [NGÂN HÀNG CÂU HỎI ĐÃ CÓ CỦA BÀI HỌC] (bao gồm câu hỏi, đáp án, phương án nhiễu và giải thích) để nắm chắc toàn bộ kiến thức trọng tâm, độ sâu học thuật và chuẩn thuật ngữ của bài học này.
   - Từ đó tạo thêm ${quota.total} câu hỏi MỚI 100% cho bài học: khai thác góc hỏi mới, tình huống/ví dụ ứng dụng mới hoặc các đơn vị kiến thức trong bài chưa bị trùng. Tuyệt đối KHÔNG sao chép nguyên văn câu hỏi cũ.
3. TRÍCH DẪN NGUỒN RÕ RÀNG (SOURCE SECTION):
   - Mỗi câu hỏi BẮT BUỘC điền trường "sourceSection" chỉ rõ câu hỏi thuộc Slide số mấy, Mục giáo trình/đề cương nào của bài học (ví dụ: "Slide 3: Khái niệm...", "Mục 2.1: Phân loại...").
4. QUY TẮC ĐỊNH DẠNG MOODLE LMS:
   - Phân bổ độ khó Bloom chính xác:
     + Mức 1 (Biết / Remember): ${quota.level1} câu
     + Mức 2 (Hiểu / Understand): ${quota.level2} câu
     + Mức 3 (Vận dụng / Apply): ${quota.level3} câu
   - Mỗi câu gồm: "correctAnswer" (1 đáp án đúng duy nhất) và 3 phương án nhiễu ("optionB", "optionC", "optionD") có độ dài và cấu trúc ngữ pháp tương đương.
   - TUYỆT ĐỐI KHÔNG gắn tiền tố "A.", "B.", "C.", "D." vào đầu nội dung các phương án.
   - Trường "explanation": Giải thích rõ bản chất vì sao đáp án đúng dựa vào kiến thức bài học. TUYỆT ĐỐI KHÔNG dùng cụm từ "Đáp án A đúng vì..." hay "Chọn B vì..." (do LMS sẽ xáo trộn thứ tự đáp án).
${quota.customInstructions ? `5. YÊU CẦU BỔ SUNG TỪ GIẢNG VIÊN:\n   ${quota.customInstructions}` : ''}
=====================================================================
${excludedGuardBlock}
[NGÂN HÀNG CÂU HỎI ĐÃ CÓ CỦA BÀI HỌC "${ctx.displayTitle}" (DÙNG ĐỂ NẮM TRỌNG TÂM KIẾN THỨC & TẠO THÊM CÂU HỎI MỚI KHÔNG TRÙNG LẶP)]:
${ctx.existingQuestionsSummary}

[NỘI DUNG BÀI HỌC NGUỒN — ${ctx.displayTitle}]:
${ctx.contentText}

=====================================================================
Hãy trả lời CHỈ BẰNG JSON HỢP LỆ theo đúng cấu trúc sau (không kèm văn bản giải thích ngoài JSON):
\`\`\`json
{
  "questions": [
    {
      "level": 1,
      "sourceSection": "Slide 2 / Mục 1.2: Tên mục kiến thức",
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
        for (let i = 0; i < parsedList.length && results.length < quota.total; i++) {
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
                sourceLessonTitle: ctx.displayTitle,
                sourceSection: String(raw.sourceSection || ctx.displayTitle).trim(),
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

        const excludedGuardBlock = ctx.excludedLessonsGuard
            ? `\n[FORBIDDEN OUT-OF-SCOPE LESSONS — NOT SELECTED FOR THIS EXAM]:\n${ctx.excludedLessonsGuard}\n=> STRICTLY DO NOT test any grammar rules, vocabulary sets, or topics that belong exclusively to the unselected lessons listed above.\n`
            : '';

        const prompt = `You are an Assessment Specialist in University-Level English Studies & Linguistics.
Generate EXACTLY ${quota.total} 100% NEW, auto-gradable exam questions strictly bounded to "${ctx.displayTitle}" (Course: "${ctx.subjectName}", Sub-discipline focus: ${subDiscipline}).
${ctx.subjectContext ? `Course context: ${ctx.subjectContext}` : ''}

=====================================================================
STRICT ASSESSMENT & GROUNDING RULES (100% MANDATORY):
1. STRICT SELECTED-LESSON BOUNDARY (CLOSED-WORLD GROUNDING):
   - Every single question, option, matching pair, cloze blank, and explanation MUST be derived strictly within the scope of "${ctx.displayTitle}" from the [SOURCE LESSON CONTENT] and [EXISTING LESSON QUESTION BANK] below.
   - DO NOT introduce outside topics, grammar points, vocabulary, or concepts from unselected lessons.
2. LEVERAGE EXISTING LESSON QUESTION BANK TO CREATE 100% NEW QUESTIONS:
   - Study BOTH the [SOURCE LESSON CONTENT] and the [EXISTING LESSON QUESTION BANK] (stems, answers, options/pairs, explanations) to master the exact target structures, academic depth, and assessment focus of this lesson.
   - Generate ${quota.total} brand-new exam questions testing fresh contexts, examples, and angles of this lesson's content WITHOUT duplicating or trivially copying existing questions.
3. SOURCE CITATION ("sourceSection"):
   - Every question MUST include a "sourceSection" field indicating the exact Slide number or Section in the lesson (e.g., "Slide 5: Past Perfect Continuous" or "Section 2: Lexical Collocations").
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
     * "CLOZE" (Embedded Cloze passage using ONLY Moodle shuffled dropdown syntax {1:MULTICHOICE_S:=Correct~Wrong1~Wrong2~Wrong3}; NEVER use SHORTANSWER or bare underscores ___):
       "data": { "clozeText": "Passage with {1:MULTICHOICE_S:=correct~wrong1~wrong2~wrong3} embedded.", "answers": [ { "position": 1, "acceptableAnswers": ["correct"], "distractors": ["wrong1", "wrong2", "wrong3"] } ] }
     * "TRUEFALSE":
       "data": { "correctAnswer": true } (or false)
${quota.customInstructions ? `5. ADDITIONAL INSTRUCTOR INSTRUCTIONS:\n   ${quota.customInstructions}` : ''}
=====================================================================
${excludedGuardBlock}
[EXISTING LESSON QUESTION BANK FOR "${ctx.displayTitle}" (USE TO ALIGN ASSESSMENT FOCUS & CREATE 100% NEW NON-DUPLICATE QUESTIONS)]:
${ctx.existingQuestionsSummary}

[SOURCE LESSON CONTENT — ${ctx.displayTitle}]:
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
        for (let i = 0; i < parsedList.length && results.length < quota.total; i++) {
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

            let finalQuestionText = questionText;
            if (qType === 'CLOZE') {
                const sourceCloze = String(parsedData?.clozeText || parsedData?.rawCloze || questionText || '');
                const upgradedCloze = upgradeClozeToMultichoice(sourceCloze, parsedData);
                parsedData = {
                    ...(typeof parsedData === 'object' && parsedData !== null ? parsedData : {}),
                    clozeText: upgradedCloze,
                };
                if (/\{\d+:[A-Za-z_]+:/.test(finalQuestionText) || /_{2,}/.test(finalQuestionText)) {
                    finalQuestionText = upgradeClozeToMultichoice(finalQuestionText, parsedData);
                }
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
                questionText: finalQuestionText,
                dataJson: JSON.stringify(parsedData),
                explanation: cleanExplanation(explanation),
                points: Number(item.points) || 1,
                sourceLessonId: ctx.id,
                sourceLessonTitle: ctx.displayTitle,
                sourceSection: String(item.sourceSection || ctx.displayTitle).trim(),
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
