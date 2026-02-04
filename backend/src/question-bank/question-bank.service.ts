import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { ModelConfigService } from '../model-config/model-config.service';
import { PromptComposerService } from '../prompts/prompt-composer.service';
import { AiProviderService } from '../ai/ai-provider.service';
import { QuestionBank } from '@prisma/client';

export interface LevelCounts {
    level1: number;  // Biết
    level2: number;  // Hiểu
    level3: number;  // Vận dụng
}

export interface Question {
    id: string;
    question: string;
    correctAnswer: string;
    optionB: string;
    optionC: string;
    optionD: string;
    explanation: string;
    level: number;
}

@Injectable()
export class QuestionBankService {
    private readonly logger = new Logger(QuestionBankService.name);

    constructor(
        private prisma: PrismaService,
        private apiKeysService: ApiKeysService,
        private modelConfigService: ModelConfigService,
        private promptComposer: PromptComposerService,
        private aiProvider: AiProviderService,
    ) { }

    // Get question bank for a lesson
    async getQuestionBank(lessonId: string): Promise<QuestionBank | null> {
        return this.prisma.questionBank.findUnique({
            where: { lessonId },
        });
    }

    // Generate questions using Gemini (Step 5)
    async generateQuestions(
        lessonId: string,
        userId: string,
        levelCounts: LevelCounts,
    ): Promise<QuestionBank> {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
            include: { subject: true },
        });

        if (!lesson) {
            throw new NotFoundException(`Lesson ${lessonId} not found`);
        }

        if (!lesson.detailedOutline) {
            throw new BadRequestException('Detailed outline is required before generating questions');
        }

        // Get API key
        const apiKey = await this.apiKeysService.getActiveKey(userId, 'GEMINI');
        if (!apiKey) {
            throw new BadRequestException('Gemini API key not configured. Please add it in Settings.');
        }

        // Get configured model for QUESTIONS task
        const modelConfig = await this.modelConfigService.getModelForTask(userId, 'QUESTIONS');

        // Build prompt using PromptComposer (Role + Task)
        // Use slide_script for context (if available, otherwise detailed outline)
        const contentSource = lesson.slideScript || lesson.detailedOutline;
        const prompt = await this.promptComposer.buildFullPrompt(
            lesson.subjectId,
            'questions.review',
            {
                title: lesson.title,
                slide_script: contentSource,
                level1_count: String(levelCounts.level1),
                level2_count: String(levelCounts.level2),
                level3_count: String(levelCounts.level3),
            },
        );

        this.logger.debug(`Generated prompt for questions (${prompt.length} chars)`);

        // Use AiProviderService (CLIProxy → Gemini SDK fallback)
        const aiResult = await this.aiProvider.generateText(prompt, modelConfig.modelName, apiKey);
        const result = aiResult.content;
        this.logger.log(`Questions generated via ${aiResult.provider} (${aiResult.model})`);

        // Parse questions - try JSON first, fallback to markdown table
        let questions: Question[];
        try {
            questions = this.parseJsonQuestions(result);
        } catch (e) {
            this.logger.warn('Failed to parse JSON, falling back to table parsing');
            questions = this.parseQuestionTable(result);
        }

        // Upsert question bank
        const questionBank = await this.prisma.questionBank.upsert({
            where: { lessonId },
            create: {
                lessonId,
                questionsJson: JSON.stringify(questions),
                levelCounts: JSON.stringify(levelCounts),
            },
            update: {
                questionsJson: JSON.stringify(questions),
                levelCounts: JSON.stringify(levelCounts),
            },
        });

        // Update lesson step
        await this.prisma.lesson.update({
            where: { id: lessonId },
            data: { currentStep: 5 },
        });

        return questionBank;
    }

    // Update questions after user edit
    async updateQuestions(lessonId: string, questionsJson: string): Promise<QuestionBank> {
        const questionBank = await this.prisma.questionBank.findUnique({
            where: { lessonId },
        });

        if (!questionBank) {
            throw new NotFoundException(`Question bank for lesson ${lessonId} not found`);
        }

        return this.prisma.questionBank.update({
            where: { lessonId },
            data: { questionsJson },
        });
    }

    // Parse JSON output from AI
    private parseJsonQuestions(result: string): Question[] {
        // Extract JSON from markdown code block if present
        const jsonMatch = result.match(/```json?\s*([\s\S]*?)```/);
        const jsonStr = jsonMatch ? jsonMatch[1] : result;

        const parsed = JSON.parse(jsonStr);
        const questions = parsed.questions || parsed;

        return questions.map((q: any) => ({
            id: q.questionId || q.id,
            question: q.question,
            correctAnswer: q.correctAnswer,
            optionB: q.optionB,
            optionC: q.optionC,
            optionD: q.optionD,
            explanation: q.explanation || '',
            level: q.level || 1,
        }));
    }

    // Parse markdown table to Question array
    private parseQuestionTable(markdownResult: string): Question[] {
        const questions: Question[] = [];
        const lines = markdownResult.split('\n');

        let inTable = false;
        for (const line of lines) {
            // Skip header and separator lines
            if (line.includes('Question ID') || line.match(/^\|[\s-:]+\|/)) {
                inTable = true;
                continue;
            }

            if (inTable && line.startsWith('|')) {
                const cells = line.split('|').map(c => c.trim()).filter(c => c);
                if (cells.length >= 7) {
                    questions.push({
                        id: cells[0],
                        question: cells[1],
                        correctAnswer: cells[2],
                        optionB: cells[3],
                        optionC: cells[4],
                        optionD: cells[5],
                        explanation: cells[6],
                        level: parseInt(cells[0].split('-')[1]) || 1,
                    });
                }
            }
        }

        return questions;
    }
}
