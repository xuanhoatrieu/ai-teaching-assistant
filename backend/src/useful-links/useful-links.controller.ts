import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { UsefulLinksService } from './useful-links.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class UsefulLinksController {
    constructor(private linksService: UsefulLinksService) {}

    // ============= PUBLIC (all authenticated users) =============

    /**
     * GET /useful-links — Returns only active links for user navbar.
     */
    @Get('useful-links')
    async getActiveLinks() {
        return this.linksService.getActiveLinks();
    }

    // ============= ADMIN ONLY =============

    /**
     * GET /admin/useful-links — Returns all links (including inactive).
     */
    @Get('admin/useful-links')
    @UseGuards(RolesGuard)
    @Roles(UserRole.ADMIN)
    async getAllLinks() {
        return this.linksService.getAllLinks();
    }

    /**
     * POST /admin/useful-links — Create a new link.
     */
    @Post('admin/useful-links')
    @UseGuards(RolesGuard)
    @Roles(UserRole.ADMIN)
    async createLink(
        @Body() body: { title: string; url: string; icon?: string; description?: string; sortOrder?: number },
    ) {
        return this.linksService.createLink(body);
    }

    /**
     * PUT /admin/useful-links/:id — Update a link.
     */
    @Put('admin/useful-links/:id')
    @UseGuards(RolesGuard)
    @Roles(UserRole.ADMIN)
    async updateLink(
        @Param('id') id: string,
        @Body() body: { title?: string; url?: string; icon?: string; description?: string; sortOrder?: number; isActive?: boolean },
    ) {
        return this.linksService.updateLink(id, body);
    }

    /**
     * DELETE /admin/useful-links/:id — Delete a link.
     */
    @Delete('admin/useful-links/:id')
    @UseGuards(RolesGuard)
    @Roles(UserRole.ADMIN)
    async deleteLink(@Param('id') id: string) {
        return this.linksService.deleteLink(id);
    }
}
