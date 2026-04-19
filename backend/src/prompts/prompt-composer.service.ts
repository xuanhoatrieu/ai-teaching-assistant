import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PromptsService } from './prompts.service';
import { getOutputLanguageInstruction, getLanguageLabel } from '../ai/language-instruction';

/**
 * PromptComposerService
 * 
 * Composes prompts by combining:
 * 1. Role prompt (from Subject's role fields)
 * 2. Task prompt (from database by slug)
 * 
 * Usage:
 *   const fullPrompt = await promptComposer.buildFullPrompt(subjectId, 'outline.detailed', variables);
 */
@Injectable()
export class PromptComposerService {
    private readonly logger = new Logger(PromptComposerService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly promptsService: PromptsService,
    ) { }

    /**
     * Build a complete prompt by combining Role (from Subject) + Task (from slug)
     * 
     * @param subjectId - Subject ID to get role context from
     * @param taskSlug - Prompt slug for the task (e.g., 'outline.detailed')
     * @param variables - Variables to substitute in the task prompt
     * @returns Combined prompt string
     */
    async buildFullPrompt(
        subjectId: string,
        taskSlug: string,
        variables: Record<string, string>,
    ): Promise<string> {
        this.logger.debug(`Building prompt for subject=${subjectId}, task=${taskSlug}`);

        // 1. Get Subject for role variables
        const subject = await this.prisma.subject.findUnique({
            where: { id: subjectId },
        });

        if (!subject) {
            throw new Error(`Subject not found: ${subjectId}`);
        }

        // 2. Build Role Prompt from Subject fields
        const rolePrompt = await this.buildRolePrompt(subject);

        // 3. Get language instruction based on Subject's language setting
        const subjectLanguage = subject.language || 'vi';
        const languageInstruction = getOutputLanguageInstruction(subjectLanguage);
        this.logger.debug(`Language: ${getLanguageLabel(subjectLanguage)}`);

        // 4. Render Task Prompt with variables (include language in variables)
        const enrichedVariables = {
            ...variables,
            output_language_instruction: languageInstruction,
        };
        const taskPrompt = await this.promptsService.renderPrompt(taskSlug, enrichedVariables);

        // 5. Combine: Role + Language + Separator + Task
        const fullPrompt = `${rolePrompt}\n\n${languageInstruction}\n\n---\n\n${taskPrompt}`;

        this.logger.debug(`Full prompt length: ${fullPrompt.length} chars`);
        return fullPrompt;
    }

    /**
     * Build role prompt from Subject's role fields
     */
    private async buildRolePrompt(subject: {
        name: string;
        institutionType?: string | null;
        expertiseArea?: string | null;
        courseName?: string | null;
        targetAudience?: string | null;
        majorName?: string | null;
        additionalContext?: string | null;
    }): Promise<string> {
        const roleVariables = {
            institution_type: subject.institutionType || 'Đại học',
            expertise_area: subject.expertiseArea || subject.name,
            course_name: subject.courseName || subject.name,
            target_audience: subject.targetAudience || 'sinh viên',
            major_name: subject.majorName || '',
            additional_context: subject.additionalContext || '',
        };

        try {
            return await this.promptsService.renderPrompt('system.role', roleVariables);
        } catch (error) {
            // Fallback if system.role not found
            this.logger.warn('system.role prompt not found, using fallback');
            return this.buildFallbackRolePrompt(roleVariables);
        }
    }

    /**
     * Fallback role prompt if system.role not in database (English)
     */
    private buildFallbackRolePrompt(vars: Record<string, string>): string {
        return `**ROLE:** You are an experienced ${vars.institution_type} lecturer and expert in ${vars.expertise_area}.

Your task is to create detailed, engaging, and easy-to-understand lesson plans and lecture materials for the course ${vars.course_name}.

Target audience: ${vars.target_audience}${vars.major_name ? ` majoring in ${vars.major_name}` : ''}.

${vars.additional_context}`.trim();
    }

    /**
     * Build task-only prompt (no role) for tasks that don't need role context
     * Example: slides.image prompt for Imagen
     */
    async buildTaskOnlyPrompt(
        taskSlug: string,
        variables: Record<string, string>,
    ): Promise<string> {
        return this.promptsService.renderPrompt(taskSlug, variables);
    }

    /**
     * Get Subject role context for display/preview
     */
    async getSubjectRolePreview(subjectId: string): Promise<string> {
        const subject = await this.prisma.subject.findUnique({
            where: { id: subjectId },
        });

        if (!subject) {
            return '';
        }

        return this.buildRolePrompt(subject);
    }
}
