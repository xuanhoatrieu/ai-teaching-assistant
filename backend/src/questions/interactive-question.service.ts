import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GeminiService } from '../ai/gemini.service';
import { PromptComposerService } from '../prompts/prompt-composer.service';
import { InteractiveQuestion } from '@prisma/client';

interface CreateInteractiveQuestionDto {
    questionType?: string;
    questionText: string;
    answers: string[]; // Array of answers, correct ones prefixed with *
    correctFeedback?: string;
    incorrectFeedback?: string;
    points?: number;
    imageUrl?: string;
    videoUrl?: string;
    audioUrl?: string;
}

interface UpdateInteractiveQuestionDto extends Partial<CreateInteractiveQuestionDto> {
    questionOrder?: number;
}

@Injectable()
export class InteractiveQuestionService {
    private readonly logger = new Logger(InteractiveQuestionService.name);

    constructor(
        private prisma: PrismaService,
        private geminiService: GeminiService,
        private promptComposer: PromptComposerService,
    ) { }

    /**
     * Get all interactive questions for a lesson with answers array
     */
    async getQuestions(lessonId: string): Promise<any[]> {
        const questions = await this.prisma.interactiveQuestion.findMany({
            where: { lessonId },
            orderBy: { questionOrder: 'asc' },
        });

        // Transform answer1-10 fields into answers array for frontend
        return questions.map(q => ({
            ...q,
            answers: this.getAnswersFromQuestion(q),
        }));
    }

    /**
     * Get a single question by ID
     */
    async getQuestion(id: string): Promise<InteractiveQuestion | null> {
        return this.prisma.interactiveQuestion.findUnique({
            where: { id },
        });
    }

    /**
     * Create a new interactive question
     */
    async createQuestion(
        lessonId: string,
        dto: CreateInteractiveQuestionDto,
    ): Promise<InteractiveQuestion> {
        // Get next order number
        const count = await this.prisma.interactiveQuestion.count({
            where: { lessonId },
        });

        // Parse answers into answer1-10 fields
        const answerFields = this.parseAnswersToFields(dto.answers);

        return this.prisma.interactiveQuestion.create({
            data: {
                lessonId,
                questionOrder: count,
                questionType: dto.questionType || 'MC',
                questionText: dto.questionText,
                ...answerFields,
                correctFeedback: dto.correctFeedback,
                incorrectFeedback: dto.incorrectFeedback,
                points: dto.points || 1,
                imageUrl: dto.imageUrl,
                videoUrl: dto.videoUrl,
                audioUrl: dto.audioUrl,
            },
        });
    }

    /**
     * Update an existing question
     */
    async updateQuestion(
        id: string,
        dto: UpdateInteractiveQuestionDto,
    ): Promise<InteractiveQuestion> {
        const question = await this.prisma.interactiveQuestion.findUnique({
            where: { id },
        });

        if (!question) {
            throw new NotFoundException(`Question ${id} not found`);
        }

        const updateData: any = {};

        if (dto.questionType !== undefined) updateData.questionType = dto.questionType;
        if (dto.questionText !== undefined) updateData.questionText = dto.questionText;
        if (dto.correctFeedback !== undefined) updateData.correctFeedback = dto.correctFeedback;
        if (dto.incorrectFeedback !== undefined) updateData.incorrectFeedback = dto.incorrectFeedback;
        if (dto.points !== undefined) updateData.points = dto.points;
        if (dto.questionOrder !== undefined) updateData.questionOrder = dto.questionOrder;
        if (dto.imageUrl !== undefined) updateData.imageUrl = dto.imageUrl;
        if (dto.videoUrl !== undefined) updateData.videoUrl = dto.videoUrl;
        if (dto.audioUrl !== undefined) updateData.audioUrl = dto.audioUrl;

        if (dto.answers) {
            const answerFields = this.parseAnswersToFields(dto.answers);
            Object.assign(updateData, answerFields);
        }

        return this.prisma.interactiveQuestion.update({
            where: { id },
            data: updateData,
        });
    }

    /**
     * Delete a question
     */
    async deleteQuestion(id: string): Promise<void> {
        await this.prisma.interactiveQuestion.delete({
            where: { id },
        });
    }

    /**
     * Delete all questions for a lesson
     */
    async deleteAllQuestions(lessonId: string): Promise<number> {
        const result = await this.prisma.interactiveQuestion.deleteMany({
            where: { lessonId },
        });
        return result.count;
    }

    /**
     * Generate interactive questions from slides using AI
     */
    async generateFromSlides(
        lessonId: string,
        slidesContent: string,
        count: number = 5,
    ): Promise<InteractiveQuestion[]> {
        this.logger.log(`Generating ${count} interactive questions for lesson ${lessonId}`);

        // Get lesson with subject for prompt context
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
            include: { subject: true },
        });

        if (!lesson) {
            throw new NotFoundException(`Lesson ${lessonId} not found`);
        }

        // Build prompt using PromptComposer (Role from Subject + Task from DB)
        const prompt = await this.promptComposer.buildFullPrompt(
            lesson.subjectId,
            'questions.interactive',
            {
                title: lesson.title,
                slide_script: slidesContent,
            },
        );

        this.logger.log(`Built prompt for interactive questions (${prompt.length} chars)`);

        try {
            const response = await this.geminiService.generateText(prompt);

            // Parse JSON response - handle both {questions: [...]} and direct array
            let questions: any[];
            const cleanedResponse = this.cleanJsonResponse(response);
            const parsed = JSON.parse(cleanedResponse);
            questions = parsed.questions || parsed;

            // Delete existing questions
            await this.deleteAllQuestions(lessonId);

            // Create new questions
            const createdQuestions: InteractiveQuestion[] = [];
            for (let i = 0; i < questions.length; i++) {
                const q = questions[i];

                // Parse answers - DB prompt format has {text, isCorrect} objects
                const answers = this.parseAnswersFromAI(q.answers || []);

                const created = await this.createQuestion(lessonId, {
                    questionType: q.questionType || 'MC',
                    questionText: q.questionText,
                    answers,
                    correctFeedback: q.correctFeedback,
                    incorrectFeedback: q.incorrectFeedback,
                    points: q.points || 1,
                });
                createdQuestions.push(created);
            }

            this.logger.log(`Generated ${createdQuestions.length} interactive questions`);
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
        const jsonMatch = response.match(/```json?\s*([\s\S]*?)```/);
        return jsonMatch ? jsonMatch[1].trim() : response.trim();
    }

    /**
     * Parse answers from AI format to string array with * prefix for correct answers
     */
    private parseAnswersFromAI(answers: any[]): string[] {
        return answers.map((a: any) => {
            if (typeof a === 'string') return a;
            // Handle {text, isCorrect} format from DB prompt
            const text = a.text?.replace(/^\*/, '') || '';
            return a.isCorrect ? `*${text}` : text;
        });
    }

    /**
     * Parse answers array to answer1-10 fields
     */
    private parseAnswersToFields(answers: string[]): Record<string, string | null> {
        const fields: Record<string, string | null> = {};
        for (let i = 1; i <= 10; i++) {
            fields[`answer${i}`] = answers[i - 1] || null;
        }
        return fields;
    }

    /**
     * Get answers as array from question fields
     */
    getAnswersFromQuestion(question: InteractiveQuestion): string[] {
        const answers: string[] = [];
        for (let i = 1; i <= 10; i++) {
            const answer = (question as any)[`answer${i}`];
            if (answer) {
                answers.push(answer);
            }
        }
        return answers;
    }
}
