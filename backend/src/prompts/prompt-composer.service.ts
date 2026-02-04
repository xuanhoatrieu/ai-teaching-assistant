import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PromptsService } from './prompts.service';

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

        // 3. Render Task Prompt with variables
        const taskPrompt = await this.promptsService.renderPrompt(taskSlug, variables);

        // 4. Combine: Role + Separator + Task
        const fullPrompt = `${rolePrompt}\n\n---\n\n${taskPrompt}`;

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
     * Fallback role prompt if system.role not in database
     */
    private buildFallbackRolePrompt(vars: Record<string, string>): string {
        return `**ROLE:** Bạn là một Giảng viên ${vars.institution_type} giàu kinh nghiệm, chuyên gia trong lĩnh vực ${vars.expertise_area}.

Nhiệm vụ của bạn là soạn thảo giáo án và bài giảng chi tiết, hấp dẫn và dễ hiểu cho môn học ${vars.course_name}.

Đối tượng là ${vars.target_audience}${vars.major_name ? ` ngành ${vars.major_name}` : ''}.

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
