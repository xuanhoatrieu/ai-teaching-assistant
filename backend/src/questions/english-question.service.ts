import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiProviderService } from '../ai/ai-provider.service';
import { ModelConfigService } from '../model-config/model-config.service';
import { PromptComposerService } from '../prompts/prompt-composer.service';
import { EnglishQuestion } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import type { Response } from 'express';
import { buildEnglishMoodleXml, EnglishQuestionData } from './moodle-xml.helper';

import { IsOptional, IsNumber, IsArray, IsString } from 'class-validator';

export class GenerateEnglishQuestionsDto {
    @IsOptional()
    @IsNumber()
    totalCount?: number;

    @IsOptional()
    @IsNumber()
    level1?: number; // Mức 1: Biết (Remember)

    @IsOptional()
    @IsNumber()
    level2?: number; // Mức 2: Hiểu (Understand)

    @IsOptional()
    @IsNumber()
    level3?: number; // Mức 3: Vận dụng (Apply)

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    questionTypes?: string[]; // e.g. ['MC', 'MR', 'MATCH', 'CLOZE', 'SHORTANSWER', 'TRUEFALSE', 'ESSAY']

    @IsOptional()
    @IsString()
    subDiscipline?: string; // PHONETICS, MORPHOLOGY, SYNTAX, SEMANTICS, TRANSLATION, ELT, C1_C2, ALL
}

export class CreateEnglishQuestionDto {
    @IsString()
    questionType: string;

    @IsOptional()
    @IsString()
    subDiscipline?: string;

    @IsOptional()
    @IsNumber()
    difficulty?: number;

    @IsOptional()
    @IsString()
    title?: string;

    @IsString()
    questionText: string;

    @IsString()
    dataJson: string; // JSON string with options/pairs/cloze/keys/rubric

    @IsOptional()
    @IsString()
    explanation?: string;

    @IsOptional()
    @IsNumber()
    points?: number;
}

export class UpdateEnglishQuestionDto {
    @IsOptional()
    @IsString()
    questionType?: string;

    @IsOptional()
    @IsString()
    subDiscipline?: string;

    @IsOptional()
    @IsNumber()
    difficulty?: number;

    @IsOptional()
    @IsString()
    title?: string;

    @IsOptional()
    @IsString()
    questionText?: string;

    @IsOptional()
    @IsString()
    dataJson?: string;

    @IsOptional()
    @IsString()
    explanation?: string;

    @IsOptional()
    @IsNumber()
    points?: number;

    @IsOptional()
    @IsNumber()
    questionOrder?: number;
}

@Injectable()
export class EnglishQuestionService {
    private readonly logger = new Logger(EnglishQuestionService.name);

    constructor(
        private prisma: PrismaService,
        private aiProvider: AiProviderService,
        private modelConfigService: ModelConfigService,
        private promptComposer: PromptComposerService,
    ) { }

    /**
     * Get all English questions for a lesson
     */
    async getQuestions(lessonId: string): Promise<EnglishQuestion[]> {
        return this.prisma.englishQuestion.findMany({
            where: { lessonId },
            orderBy: [{ questionOrder: 'asc' }],
        });
    }

    /**
     * Get a single English question by ID
     */
    async getQuestion(id: string): Promise<EnglishQuestion | null> {
        return this.prisma.englishQuestion.findUnique({
            where: { id },
        });
    }

    /**
     * Create a new English question
     */
    async createQuestion(
        lessonId: string,
        dto: CreateEnglishQuestionDto,
    ): Promise<EnglishQuestion> {
        const count = await this.prisma.englishQuestion.count({
            where: { lessonId },
        });

        return this.prisma.englishQuestion.create({
            data: {
                lessonId,
                questionOrder: count + 1,
                questionType: (dto.questionType || 'MC').toUpperCase(),
                subDiscipline: dto.subDiscipline || 'GENERAL',
                difficulty: dto.difficulty || 1,
                title: dto.title || `ENG-${count + 1}`,
                questionText: dto.questionText,
                dataJson: typeof dto.dataJson === 'string' ? dto.dataJson : JSON.stringify(dto.dataJson || {}),
                explanation: dto.explanation || null,
                points: dto.points || 1,
            },
        });
    }

    /**
     * Update an existing English question
     */
    async updateQuestion(
        id: string,
        dto: UpdateEnglishQuestionDto,
    ): Promise<EnglishQuestion> {
        const existing = await this.prisma.englishQuestion.findUnique({ where: { id } });
        if (!existing) {
            throw new NotFoundException(`English question with ID ${id} not found`);
        }

        return this.prisma.englishQuestion.update({
            where: { id },
            data: {
                questionType: dto.questionType ? dto.questionType.toUpperCase() : undefined,
                subDiscipline: dto.subDiscipline,
                difficulty: dto.difficulty,
                title: dto.title,
                questionText: dto.questionText,
                dataJson: dto.dataJson ? (typeof dto.dataJson === 'string' ? dto.dataJson : JSON.stringify(dto.dataJson)) : undefined,
                explanation: dto.explanation,
                points: dto.points,
                questionOrder: dto.questionOrder,
            },
        });
    }

    /**
     * Delete an English question
     */
    async deleteQuestion(id: string): Promise<void> {
        await this.prisma.englishQuestion.delete({
            where: { id },
        });
    }

    /**
     * Delete all English questions for a lesson
     */
    async deleteAllQuestions(lessonId: string): Promise<number> {
        const result = await this.prisma.englishQuestion.deleteMany({
            where: { lessonId },
        });
        return result.count;
    }

    /**
     * Generate English questions from lesson content
     */
    async generateFromLesson(
        lessonId: string,
        slidesContent: string,
        userId: string,
        dto: GenerateEnglishQuestionsDto = {},
    ): Promise<EnglishQuestion[]> {
        // Clear existing questions on fresh generation
        await this.deleteAllQuestions(lessonId);
        return this._generate(lessonId, slidesContent, userId, dto);
    }

    /**
     * Append additional English questions without deleting existing ones
     */
    async appendFromLesson(
        lessonId: string,
        slidesContent: string,
        userId: string,
        dto: GenerateEnglishQuestionsDto = {},
    ): Promise<EnglishQuestion[]> {
        return this._generate(lessonId, slidesContent, userId, dto);
    }

    /**
     * Internal generation logic
     */
    private async _generate(
        lessonId: string,
        slidesContent: string,
        userId: string,
        dto: GenerateEnglishQuestionsDto,
    ): Promise<EnglishQuestion[]> {
        const level1 = dto.level1 ?? 20;
        const level2 = dto.level2 ?? 20;
        const level3 = dto.level3 ?? 10;
        const totalCount = dto.totalCount || (level1 + level2 + level3);
        const types = dto.questionTypes && dto.questionTypes.length > 0
            ? dto.questionTypes.join(', ')
            : 'MC, MATCH, CLOZE, SHORTANSWER, TRUEFALSE, ESSAY';
        const subDiscipline = dto.subDiscipline || 'ALL (Comprehensive English Studies & Linguistics)';

        this.logger.log(`Generating ${totalCount} English questions (L1:${level1}, L2:${level2}, L3:${level3}) for lesson ${lessonId}, types: ${types}, subDiscipline: ${subDiscipline}`);

        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
            include: { subject: true },
        });

        if (!lesson) {
            throw new NotFoundException(`Lesson ${lessonId} not found`);
        }

        const modelConfig = await this.modelConfigService.getModelForTask(userId, 'QUESTIONS');

        const prompt = await this.promptComposer.buildFullPrompt(
            lesson.subjectId,
            'questions.english',
            {
                title: lesson.title,
                slide_script: slidesContent,
                sub_discipline: subDiscipline,
                question_types: types,
                total_count: String(totalCount),
                count_level1: String(level1),
                count_level2: String(level2),
                count_level3: String(level3),
            },
        );

        try {
            const aiResult = await this.aiProvider.generateText(prompt, modelConfig.modelName, userId, { maxTokens: 32768 });
            const response = aiResult.content;
            this.logger.log(`English questions generated via ${aiResult.provider} (${aiResult.model})`);

            const cleaned = this.cleanJsonResponse(response);
            let parsed: any;
            try {
                parsed = JSON.parse(cleaned);
            } catch (err) {
                // If parsing fails, try to locate outermost JSON array or object
                const firstBrace = cleaned.indexOf('{');
                const lastBrace = cleaned.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace !== -1) {
                    parsed = JSON.parse(cleaned.substring(firstBrace, lastBrace + 1));
                } else {
                    throw err;
                }
            }

            const rawList: any[] = Array.isArray(parsed) ? parsed : (parsed.questions || []);

            const createdList: EnglishQuestion[] = [];
            for (let i = 0; i < rawList.length; i++) {
                const item = rawList[i];
                const qType = (item.questionType || 'MC').toUpperCase();
                const dataJson = typeof item.data === 'object'
                    ? JSON.stringify(item.data)
                    : (item.dataJson || JSON.stringify(item));

                const created = await this.createQuestion(lessonId, {
                    questionType: qType,
                    subDiscipline: item.subDiscipline || dto.subDiscipline || 'GENERAL',
                    difficulty: item.difficulty || 1,
                    title: item.title || `ENG-${i + 1}`,
                    questionText: item.questionText || item.question || 'English Question',
                    dataJson: dataJson,
                    explanation: item.explanation || item.feedback || null,
                    points: item.points || 1,
                });
                createdList.push(created);
            }

            this.logger.log(`Saved ${createdList.length} English questions for lesson ${lessonId}`);
            return createdList;
        } catch (error: any) {
            this.logger.error(`Failed to generate English questions: ${error.message}`);
            throw error;
        }
    }

    /**
     * Clean JSON response from AI
     */
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

    /**
     * Export English Questions as Moodle XML
     */
    async exportMoodleXml(lessonId: string, res: Response): Promise<void> {
        const lesson = await this.prisma.lesson.findUnique({ where: { id: lessonId } });
        const questions = await this.getQuestions(lessonId);

        const xml = buildEnglishMoodleXml(questions as unknown as EnglishQuestionData[], lesson?.title || 'lesson');
        const filename = `${lesson?.title || 'lesson'}_english_moodle.xml`;

        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        res.send(xml);
    }

    /**
     * Export English Questions as Excel (.xlsx)
     */
    async exportExcel(lessonId: string, res: Response): Promise<void> {
        const lesson = await this.prisma.lesson.findUnique({ where: { id: lessonId } });
        const questions = await this.getQuestions(lessonId);

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('English Questions');

        worksheet.columns = [
            { header: '#', key: 'order', width: 6 },
            { header: 'Type', key: 'type', width: 12 },
            { header: 'Sub-discipline', key: 'subDiscipline', width: 22 },
            { header: 'Difficulty', key: 'difficulty', width: 12 },
            { header: 'Title', key: 'title', width: 25 },
            { header: 'Question Content', key: 'questionText', width: 50 },
            { header: 'Answer / Options / Details', key: 'details', width: 45 },
            { header: 'Explanation / Scoring', key: 'explanation', width: 40 },
        ];

        // Header styling (Navy Blue)
        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF1F497D' },
        };

        for (const q of questions) {
            let details = '';
            try {
                const data = JSON.parse(q.dataJson);
                if (data.options) {
                    details = data.options.map((o: any, idx: number) => {
                        const marker = o.fraction > 0 || o.isCorrect ? ' [✓]' : '';
                        return `${String.fromCharCode(65 + idx)}. ${o.text}${marker}`;
                    }).join('\n');
                } else if (data.pairs) {
                    details = data.pairs.map((p: any) => {
                        const left = p.left ?? p.subquestion ?? p.question ?? '';
                        const right = p.right ?? p.answer ?? p.match ?? '';
                        return `${left} ➔ ${right}`;
                    }).join('\n');
                } else if (data.clozeText) {
                    details = data.clozeText;
                } else if (data.acceptableAnswers) {
                    details = `Key(s): ${Array.isArray(data.acceptableAnswers) ? data.acceptableAnswers.join(' / ') : data.acceptableAnswers}`;
                } else if (data.correctAnswer !== undefined) {
                    details = `Key: ${data.correctAnswer}`;
                } else if (data.graderInfo || data.rubric) {
                    const raw = data.graderInfo || data.rubric;
                    if (typeof raw === 'object' && raw !== null) {
                        const total = raw.totalPoints ? `Total: ${raw.totalPoints} pts\n` : '';
                        const crit = Array.isArray(raw.criteria)
                            ? raw.criteria.map((c: any) => `• ${c.criterion || c.name || ''}: ${c.description || ''} (${c.points ?? ''} pts)`).join('\n')
                            : JSON.stringify(raw);
                        details = `Rubric:\n${total}${crit}`;
                    } else {
                        details = `Rubric: ${String(raw)}`;
                    }
                }
            } catch {
                details = q.dataJson;
            }

            worksheet.addRow({
                order: q.questionOrder,
                type: q.questionType,
                subDiscipline: q.subDiscipline || '',
                difficulty: q.difficulty === 1 ? 'Remember' : q.difficulty === 2 ? 'Understand' : 'Apply/Analyze',
                title: q.title || '',
                questionText: q.questionText,
                details: details,
                explanation: q.explanation || '',
            });
        }

        const filename = `${lesson?.title || 'lesson'}_english_questions.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);

        await workbook.xlsx.write(res);
        res.end();
    }
}
