import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiProviderService } from '../ai/ai-provider.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { ModelConfigService } from '../model-config/model-config.service';
import { PromptComposerService } from '../prompts/prompt-composer.service';
import { ReviewQuestion } from '@prisma/client';

interface LevelCounts {
    level1: number; // Biết (Remember)
    level2: number; // Hiểu (Understand)
    level3: number; // Vận dụng (Apply)
}

interface CreateReviewQuestionDto {
    questionId?: string;
    level: number;
    question: string;
    correctAnswer: string; // Option A
    optionB: string;
    optionC: string;
    optionD: string;
    explanation?: string;
}

interface UpdateReviewQuestionDto extends Partial<CreateReviewQuestionDto> {
    questionOrder?: number;
}

@Injectable()
export class ReviewQuestionService {
    private readonly logger = new Logger(ReviewQuestionService.name);

    constructor(
        private prisma: PrismaService,
        private aiProvider: AiProviderService,
        private apiKeysService: ApiKeysService,
        private modelConfigService: ModelConfigService,
        private promptComposer: PromptComposerService,
    ) { }

    /**
     * Get all review questions for a lesson
     */
    async getQuestions(lessonId: string): Promise<ReviewQuestion[]> {
        return this.prisma.reviewQuestion.findMany({
            where: { lessonId },
            orderBy: [{ level: 'asc' }, { questionOrder: 'asc' }],
        });
    }

    /**
     * Get questions by Bloom level
     */
    async getByLevel(lessonId: string, level: number): Promise<ReviewQuestion[]> {
        return this.prisma.reviewQuestion.findMany({
            where: { lessonId, level },
            orderBy: { questionOrder: 'asc' },
        });
    }

    /**
     * Get a single question by ID
     */
    async getQuestion(id: string): Promise<ReviewQuestion | null> {
        return this.prisma.reviewQuestion.findUnique({
            where: { id },
        });
    }

    /**
     * Create a new review question
     */
    async createQuestion(
        lessonId: string,
        lessonNumber: number,
        dto: CreateReviewQuestionDto,
    ): Promise<ReviewQuestion> {
        // Get next order number for this level
        const count = await this.prisma.reviewQuestion.count({
            where: { lessonId, level: dto.level },
        });

        // Generate questionId if not provided
        const questionId = dto.questionId || this.generateQuestionId(lessonNumber, dto.level, count + 1);

        return this.prisma.reviewQuestion.create({
            data: {
                lessonId,
                questionId,
                questionOrder: count,
                level: dto.level,
                question: dto.question,
                correctAnswer: dto.correctAnswer,
                optionB: dto.optionB,
                optionC: dto.optionC,
                optionD: dto.optionD,
                explanation: dto.explanation,
            },
        });
    }

    /**
     * Update an existing question
     */
    async updateQuestion(
        id: string,
        dto: UpdateReviewQuestionDto,
    ): Promise<ReviewQuestion> {
        const question = await this.prisma.reviewQuestion.findUnique({
            where: { id },
        });

        if (!question) {
            throw new NotFoundException(`Question ${id} not found`);
        }

        return this.prisma.reviewQuestion.update({
            where: { id },
            data: {
                ...(dto.questionId !== undefined && { questionId: dto.questionId }),
                ...(dto.level !== undefined && { level: dto.level }),
                ...(dto.question !== undefined && { question: dto.question }),
                ...(dto.correctAnswer !== undefined && { correctAnswer: dto.correctAnswer }),
                ...(dto.optionB !== undefined && { optionB: dto.optionB }),
                ...(dto.optionC !== undefined && { optionC: dto.optionC }),
                ...(dto.optionD !== undefined && { optionD: dto.optionD }),
                ...(dto.explanation !== undefined && { explanation: dto.explanation }),
                ...(dto.questionOrder !== undefined && { questionOrder: dto.questionOrder }),
            },
        });
    }

    /**
     * Delete a question
     */
    async deleteQuestion(id: string): Promise<void> {
        await this.prisma.reviewQuestion.delete({
            where: { id },
        });
    }

    /**
     * Delete all questions for a lesson
     */
    async deleteAllQuestions(lessonId: string): Promise<number> {
        const result = await this.prisma.reviewQuestion.deleteMany({
            where: { lessonId },
        });
        return result.count;
    }

    /**
     * Generate review questions from slides using AI
     * Now requires userId to get API key from user settings
     */
    async generateFromSlides(
        lessonId: string,
        lessonNumber: number,
        slidesContent: string,
        userId: string,
        levelCounts: LevelCounts = { level1: 4, level2: 3, level3: 3 },
    ): Promise<ReviewQuestion[]> {
        const total = levelCounts.level1 + levelCounts.level2 + levelCounts.level3;
        this.logger.log(`Generating ${total} review questions for lesson ${lessonId}`);

        // Get lesson with subject for prompt context
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
            include: { subject: true },
        });

        if (!lesson) {
            throw new NotFoundException(`Lesson ${lessonId} not found`);
        }

        // Get API key from user settings (not from env var!)
        const apiKey = await this.apiKeysService.getActiveKey(userId, 'GEMINI');
        if (!apiKey) {
            throw new BadRequestException('Gemini API key not configured. Please add it in Settings.');
        }

        // Get configured model for QUESTIONS task
        const modelConfig = await this.modelConfigService.getModelForTask(userId, 'QUESTIONS');

        // Build prompt using PromptComposer (Role from Subject + Task from DB)
        const prompt = await this.promptComposer.buildFullPrompt(
            lesson.subjectId,
            'questions.review',
            {
                title: lesson.title,
                slide_script: slidesContent,
                lesson_id: String(lessonNumber),
                count_level1: String(levelCounts.level1),
                count_level2: String(levelCounts.level2),
                count_level3: String(levelCounts.level3),
            },
        );

        this.logger.log(`Built prompt for review questions (${prompt.length} chars)`);

        try {
            // Use AiProviderService (CLIProxy → Gemini SDK fallback) with user's API key
            const aiResult = await this.aiProvider.generateText(prompt, modelConfig.modelName, apiKey);
            const response = aiResult.content;
            this.logger.log(`Review questions generated via ${aiResult.provider} (${aiResult.model})`);

            // Clean JSON response - handle markdown code blocks
            const cleanedResponse = this.cleanJsonResponse(response);
            const parsed = JSON.parse(cleanedResponse);

            // Handle both {questions: [...]} and direct array format
            const questions = parsed.questions || parsed;

            // Delete existing questions
            await this.deleteAllQuestions(lessonId);

            // Group by level and create with proper questionId
            const createdQuestions: ReviewQuestion[] = [];
            const levelCounters = { 1: 0, 2: 0, 3: 0 };

            for (const q of questions) {
                const level = q.difficulty || q.level || 1;
                levelCounters[level]++;

                const created = await this.createQuestion(lessonId, lessonNumber, {
                    questionId: q.questionId || this.generateQuestionId(lessonNumber, level, levelCounters[level]),
                    level,
                    question: q.question,
                    correctAnswer: q.correctAnswer,
                    optionB: q.optionB,
                    optionC: q.optionC,
                    optionD: q.optionD,
                    explanation: q.explanation,
                });
                createdQuestions.push(created);
            }

            this.logger.log(`Generated ${createdQuestions.length} review questions`);
            return createdQuestions;
        } catch (error) {
            this.logger.error(`Failed to generate questions: ${error.message}`);
            throw error;
        }
    }

    /**
     * Clean JSON response from AI (remove markdown code blocks if present)
     */
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

    /**
     * Generate question ID in format B{lesson}-{level}-{order}
     * e.g., B1-1-01, B1-2-03
     */
    generateQuestionId(lessonNumber: number, level: number, order: number): string {
        const paddedOrder = String(order).padStart(2, '0');
        return `B${lessonNumber}-${level}-${paddedOrder}`;
    }

    /**
     * Get level counts for a lesson
     */
    async getLevelCounts(lessonId: string): Promise<LevelCounts> {
        const [level1, level2, level3] = await Promise.all([
            this.prisma.reviewQuestion.count({ where: { lessonId, level: 1 } }),
            this.prisma.reviewQuestion.count({ where: { lessonId, level: 2 } }),
            this.prisma.reviewQuestion.count({ where: { lessonId, level: 3 } }),
        ]);

        return { level1, level2, level3 };
    }
}
