import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SlideDataService } from '../slide-data/slide-data.service';

export interface MigrationResult {
    lessonId: string;
    lessonTitle: string;
    success: boolean;
    slidesCount?: number;
    questionsCount?: number;
    error?: string;
}

export interface MigrationStatus {
    slides: {
        totalLessons: number;
        migratedLessons: number;
        pendingLessons: number;
        totalSlides: number;
    };
    questions: {
        totalQuestionBanks: number;
        migratedBanks: number;
        totalReviewQuestions: number;
    };
}

@Injectable()
export class MigrationService {
    private readonly logger = new Logger(MigrationService.name);

    constructor(
        private prisma: PrismaService,
        private slideDataService: SlideDataService,
    ) { }

    /**
     * Get current migration status
     */
    async getMigrationStatus(): Promise<MigrationStatus> {
        // Count lessons with slideScript
        const totalLessonsWithScript = await this.prisma.lesson.count({
            where: { slideScript: { not: null } },
        });

        // Count lessons that already have slides
        const lessonsWithSlides = await this.prisma.lesson.findMany({
            where: { slideScript: { not: null } },
            include: { slides: { select: { id: true } } },
        });

        const migratedLessons = lessonsWithSlides.filter(l => l.slides.length > 0).length;
        const totalSlides = await this.prisma.slide.count();

        // Count question banks
        const totalQuestionBanks = await this.prisma.questionBank.count();
        const totalReviewQuestions = await this.prisma.reviewQuestion.count();

        // Count which question banks have been migrated
        const reviewQuestionsLessons = await this.prisma.reviewQuestion.groupBy({
            by: ['lessonId'],
        });
        const migratedBanks = reviewQuestionsLessons.length;

        return {
            slides: {
                totalLessons: totalLessonsWithScript,
                migratedLessons,
                pendingLessons: totalLessonsWithScript - migratedLessons,
                totalSlides,
            },
            questions: {
                totalQuestionBanks,
                migratedBanks,
                totalReviewQuestions,
            },
        };
    }

    /**
     * Migrate all lessons with slideScript to Slide records
     */
    async migrateAllSlides(): Promise<{
        results: MigrationResult[];
        successCount: number;
        failCount: number;
    }> {
        this.logger.log('Starting slide migration...');

        // Find all lessons with slideScript but no Slide records
        const lessons = await this.prisma.lesson.findMany({
            where: {
                slideScript: { not: null },
            },
            include: {
                slides: { select: { id: true } },
            },
        });

        // Filter to only lessons without slides
        const pendingLessons = lessons.filter(l => l.slides.length === 0);
        this.logger.log(`Found ${pendingLessons.length} lessons to migrate`);

        const results: MigrationResult[] = [];

        for (const lesson of pendingLessons) {
            try {
                const slides = await this.slideDataService.parseAndSaveSlides(
                    lesson.id,
                    lesson.slideScript!,
                );

                results.push({
                    lessonId: lesson.id,
                    lessonTitle: lesson.title,
                    success: true,
                    slidesCount: slides.length,
                });

                this.logger.log(`✓ Migrated ${lesson.title}: ${slides.length} slides`);
            } catch (error) {
                results.push({
                    lessonId: lesson.id,
                    lessonTitle: lesson.title,
                    success: false,
                    error: error.message,
                });

                this.logger.error(`✗ Failed ${lesson.title}: ${error.message}`);
            }
        }

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;

        this.logger.log(`Migration complete: ${successCount} success, ${failCount} failed`);

        return { results, successCount, failCount };
    }

    /**
     * Migrate all QuestionBank records to ReviewQuestion records
     */
    async migrateAllQuestions(): Promise<{
        results: MigrationResult[];
        successCount: number;
        failCount: number;
    }> {
        this.logger.log('Starting question migration...');

        // Find all question banks
        const questionBanks = await this.prisma.questionBank.findMany({
            include: {
                lesson: {
                    include: {
                        subject: {
                            include: { lessons: { orderBy: { createdAt: 'asc' } } },
                        },
                    },
                },
            },
        });

        const results: MigrationResult[] = [];

        for (const bank of questionBanks) {
            // Check if already has review questions
            const existingCount = await this.prisma.reviewQuestion.count({
                where: { lessonId: bank.lessonId },
            });

            if (existingCount > 0) {
                this.logger.log(`Skipping ${bank.lesson.title}: already has ${existingCount} review questions`);
                continue;
            }

            try {
                // Parse questionsJson
                const questions = JSON.parse(bank.questionsJson || '[]');

                // Get lesson number (order in subject)
                const lessonIndex = bank.lesson.subject.lessons.findIndex(
                    l => l.id === bank.lessonId,
                );
                const lessonNumber = lessonIndex >= 0 ? lessonIndex + 1 : 1;

                // Group by level and track order
                const levelCounters: Record<number, number> = { 1: 0, 2: 0, 3: 0 };

                let createdCount = 0;
                for (const q of questions) {
                    const level = q.level || 1;
                    levelCounters[level] = (levelCounters[level] || 0) + 1;

                    const paddedOrder = String(levelCounters[level]).padStart(2, '0');
                    const questionId = `B${lessonNumber}-${level}-${paddedOrder}`;

                    await this.prisma.reviewQuestion.create({
                        data: {
                            lessonId: bank.lessonId,
                            questionId,
                            questionOrder: createdCount,
                            level,
                            question: q.question || q.text || '',
                            correctAnswer: q.correctAnswer || q.answer || q.options?.[0] || '',
                            optionB: q.optionB || q.options?.[1] || '',
                            optionC: q.optionC || q.options?.[2] || '',
                            optionD: q.optionD || q.options?.[3] || '',
                            explanation: q.explanation || null,
                        },
                    });
                    createdCount++;
                }

                results.push({
                    lessonId: bank.lessonId,
                    lessonTitle: bank.lesson.title,
                    success: true,
                    questionsCount: createdCount,
                });

                this.logger.log(`✓ Migrated ${bank.lesson.title}: ${createdCount} questions`);
            } catch (error) {
                results.push({
                    lessonId: bank.lessonId,
                    lessonTitle: bank.lesson.title,
                    success: false,
                    error: error.message,
                });

                this.logger.error(`✗ Failed ${bank.lesson.title}: ${error.message}`);
            }
        }

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;

        this.logger.log(`Question migration complete: ${successCount} success, ${failCount} failed`);

        return { results, successCount, failCount };
    }

    /**
     * Migrate a single lesson's slides
     */
    async migrateLesson(lessonId: string): Promise<MigrationResult> {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
        });

        if (!lesson) {
            return {
                lessonId,
                lessonTitle: 'Unknown',
                success: false,
                error: 'Lesson not found',
            };
        }

        if (!lesson.slideScript) {
            return {
                lessonId,
                lessonTitle: lesson.title,
                success: false,
                error: 'No slideScript to migrate',
            };
        }

        try {
            const slides = await this.slideDataService.parseAndSaveSlides(
                lessonId,
                lesson.slideScript,
            );

            return {
                lessonId,
                lessonTitle: lesson.title,
                success: true,
                slidesCount: slides.length,
            };
        } catch (error) {
            return {
                lessonId,
                lessonTitle: lesson.title,
                success: false,
                error: error.message,
            };
        }
    }
}
