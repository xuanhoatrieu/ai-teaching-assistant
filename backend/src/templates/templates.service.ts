import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';

@Injectable()
export class TemplatesService {
    constructor(private readonly prisma: PrismaService) { }

    /**
     * Get all active templates (for users)
     */
    async findAll() {
        return this.prisma.pPTXTemplate.findMany({
            where: { isActive: true },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        });
    }

    /**
     * Get all templates including inactive (for admin)
     */
    async findAllAdmin() {
        return this.prisma.pPTXTemplate.findMany({
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
            include: { user: { select: { id: true, email: true } } },
        });
    }

    /**
     * Get template by ID
     */
    async findOne(id: string) {
        const template = await this.prisma.pPTXTemplate.findUnique({
            where: { id },
        });
        if (!template) {
            throw new NotFoundException(`Template with ID ${id} not found`);
        }
        return template;
    }

    /**
     * Get the default template
     */
    async getDefault() {
        const defaultTemplate = await this.prisma.pPTXTemplate.findFirst({
            where: { isDefault: true, isActive: true },
        });
        if (!defaultTemplate) {
            // Return first active template if no default set
            return this.prisma.pPTXTemplate.findFirst({
                where: { isActive: true },
                orderBy: { createdAt: 'asc' },
            });
        }
        return defaultTemplate;
    }

    /**
     * Create a new template (admin only)
     */
    async create(dto: CreateTemplateDto) {
        // If setting as default, unset other defaults first
        if (dto.isDefault) {
            await this.prisma.pPTXTemplate.updateMany({
                where: { isDefault: true },
                data: { isDefault: false },
            });
        }

        return this.prisma.pPTXTemplate.create({
            data: {
                name: dto.name,
                description: dto.description,
                titleBgUrl: dto.titleBgUrl || '',
                contentBgUrl: dto.contentBgUrl || '',
                thumbnailUrl: dto.thumbnailUrl,
                fileUrl: dto.fileUrl,
                isDefault: dto.isDefault || false,
                isSystem: true, // Admin-created templates are system templates
            },
        });
    }

    /**
     * Update a template (admin only)
     */
    async update(id: string, dto: UpdateTemplateDto) {
        await this.findOne(id); // Verify exists

        // If setting as default, unset other defaults first
        if (dto.isDefault) {
            await this.prisma.pPTXTemplate.updateMany({
                where: { isDefault: true, id: { not: id } },
                data: { isDefault: false },
            });
        }

        return this.prisma.pPTXTemplate.update({
            where: { id },
            data: dto,
        });
    }

    /**
     * Delete a template (admin only)
     */
    async delete(id: string) {
        await this.findOne(id); // Verify exists
        return this.prisma.pPTXTemplate.delete({ where: { id } });
    }

    /**
     * Toggle template active status (admin only)
     */
    async toggleActive(id: string) {
        const template = await this.findOne(id);
        return this.prisma.pPTXTemplate.update({
            where: { id },
            data: { isActive: !template.isActive },
        });
    }

    // ==================== USER TEMPLATES ====================

    /**
     * Get templates by user ID
     */
    async findByUserId(userId: string) {
        return this.prisma.pPTXTemplate.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
        });
    }

    /**
     * Create a user's personal template
     */
    async createUserTemplate(data: {
        name: string;
        description?: string;
        userId: string;
        titleBgUrl?: string;
        contentBgUrl?: string;
    }) {
        return this.prisma.pPTXTemplate.create({
            data: {
                name: data.name,
                description: data.description,
                titleBgUrl: data.titleBgUrl || '',
                contentBgUrl: data.contentBgUrl || '',
                userId: data.userId,
                isSystem: false,
                isDefault: false,
                isActive: true,
            },
        });
    }

    /**
     * Delete user's personal template (only their own)
     */
    async deleteUserTemplate(id: string, userId: string) {
        const template = await this.prisma.pPTXTemplate.findFirst({
            where: { id, userId },
        });

        if (!template) {
            throw new NotFoundException(`Template not found or not owned by you`);
        }

        return this.prisma.pPTXTemplate.delete({ where: { id } });
    }
}
