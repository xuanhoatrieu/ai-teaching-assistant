import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsefulLinksService {
    private readonly logger = new Logger(UsefulLinksService.name);

    constructor(private prisma: PrismaService) {}

    /**
     * Get all active links (for regular users) — sorted by sortOrder.
     */
    async getActiveLinks() {
        return this.prisma.usefulLink.findMany({
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
        });
    }

    /**
     * Get all links (for admin) — includes inactive.
     */
    async getAllLinks() {
        return this.prisma.usefulLink.findMany({
            orderBy: { sortOrder: 'asc' },
        });
    }

    /**
     * Create a new useful link.
     */
    async createLink(data: {
        title: string;
        url: string;
        icon?: string;
        description?: string;
        sortOrder?: number;
    }) {
        const link = await this.prisma.usefulLink.create({
            data: {
                title: data.title,
                url: data.url,
                icon: data.icon || '🔗',
                description: data.description || null,
                sortOrder: data.sortOrder || 0,
            },
        });
        this.logger.log(`[createLink] Created link: ${link.title} (${link.url})`);
        return link;
    }

    /**
     * Update an existing link.
     */
    async updateLink(id: string, data: {
        title?: string;
        url?: string;
        icon?: string;
        description?: string;
        sortOrder?: number;
        isActive?: boolean;
    }) {
        const existing = await this.prisma.usefulLink.findUnique({ where: { id } });
        if (!existing) {
            throw new NotFoundException(`Link ${id} not found`);
        }

        return this.prisma.usefulLink.update({
            where: { id },
            data,
        });
    }

    /**
     * Delete a link.
     */
    async deleteLink(id: string) {
        const existing = await this.prisma.usefulLink.findUnique({ where: { id } });
        if (!existing) {
            throw new NotFoundException(`Link ${id} not found`);
        }

        await this.prisma.usefulLink.delete({ where: { id } });
        this.logger.log(`[deleteLink] Deleted link: ${existing.title}`);
        return { message: 'Link deleted' };
    }
}
