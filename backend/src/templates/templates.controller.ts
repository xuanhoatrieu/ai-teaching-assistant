import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Param,
    Body,
    UseGuards,
    UseInterceptors,
    UploadedFiles,
    Req,
    BadRequestException,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { FileStorageService } from '../file-storage/file-storage.service';

// Image file filter for PNG/JPG
const imageFileFilter = (req: any, file: Express.Multer.File, cb: any) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image files are allowed'), false);
    }
};

@Controller()
export class TemplatesController {
    constructor(
        private readonly templatesService: TemplatesService,
        private readonly fileStorageService: FileStorageService,
    ) { }

    // ==================== USER ENDPOINTS ====================

    /**
     * GET /templates - List all active templates for users
     */
    @Get('templates')
    @UseGuards(JwtAuthGuard)
    async findAll() {
        return this.templatesService.findAll();
    }

    /**
     * GET /templates/:id - Get a single template
     */
    @Get('templates/:id')
    @UseGuards(JwtAuthGuard)
    async findOne(@Param('id') id: string) {
        return this.templatesService.findOne(id);
    }

    /**
     * GET /templates/default - Get the default template
     */
    @Get('templates/default')
    @UseGuards(JwtAuthGuard)
    async getDefault() {
        return this.templatesService.getDefault();
    }

    /**
     * GET /user/templates - Get user's personal templates
     */
    @Get('user/templates')
    @UseGuards(JwtAuthGuard)
    async getUserTemplates(@Req() req: any) {
        const userId = req.user.id;
        return this.templatesService.findByUserId(userId);
    }

    /**
     * POST /user/templates/upload - Upload 2 background images for personal template
     */
    @Post('user/templates/upload')
    @UseGuards(JwtAuthGuard)
    @UseInterceptors(
        FileFieldsInterceptor(
            [
                { name: 'titleBg', maxCount: 1 },
                { name: 'contentBg', maxCount: 1 },
            ],
            { storage: memoryStorage(), fileFilter: imageFileFilter },
        ),
    )
    async uploadUserTemplate(
        @Req() req: any,
        @UploadedFiles() files: { titleBg?: Express.Multer.File[]; contentBg?: Express.Multer.File[] },
        @Body('name') name: string,
        @Body('description') description?: string,
    ) {
        if (!files?.titleBg?.[0] || !files?.contentBg?.[0]) {
            throw new BadRequestException('Both titleBg and contentBg images are required');
        }
        if (!name) {
            throw new BadRequestException('Template name is required');
        }

        const userId = req.user.id;

        // Create template first to get ID
        const template = await this.templatesService.createUserTemplate({
            name,
            description,
            userId,
        });

        // Save images using FileStorageService
        const titleBgResult = await this.fileStorageService.saveTemplateImage(
            false, // isSystem
            userId,
            template.id,
            'title_bg',
            files.titleBg[0].buffer,
            this.getExtensionFromMimetype(files.titleBg[0].mimetype),
        );

        const contentBgResult = await this.fileStorageService.saveTemplateImage(
            false, // isSystem
            userId,
            template.id,
            'content_bg',
            files.contentBg[0].buffer,
            this.getExtensionFromMimetype(files.contentBg[0].mimetype),
        );

        // Update template with image URLs
        return this.templatesService.update(template.id, {
            titleBgUrl: titleBgResult.publicUrl,
            contentBgUrl: contentBgResult.publicUrl,
        });
    }

    /**
     * DELETE /user/templates/:id - Delete user's personal template
     */
    @Delete('user/templates/:id')
    @UseGuards(JwtAuthGuard)
    async deleteUserTemplate(@Req() req: any, @Param('id') id: string) {
        const userId = req.user.id;
        return this.templatesService.deleteUserTemplate(id, userId);
    }

    // ==================== ADMIN ENDPOINTS ====================

    /**
     * GET /admin/templates - List all templates (including inactive)
     */
    @Get('admin/templates')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    async findAllAdmin() {
        return this.templatesService.findAllAdmin();
    }

    /**
     * POST /admin/templates - Create a new template (without files)
     */
    @Post('admin/templates')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    async create(@Body() dto: CreateTemplateDto) {
        return this.templatesService.create(dto);
    }

    /**
     * PUT /admin/templates/:id - Update a template
     */
    @Put('admin/templates/:id')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    async update(@Param('id') id: string, @Body() dto: UpdateTemplateDto) {
        return this.templatesService.update(id, dto);
    }

    /**
     * DELETE /admin/templates/:id - Delete a template
     */
    @Delete('admin/templates/:id')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    async delete(@Param('id') id: string) {
        return this.templatesService.delete(id);
    }

    /**
     * POST /admin/templates/:id/toggle - Toggle template active status
     */
    @Post('admin/templates/:id/toggle')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    async toggleActive(@Param('id') id: string) {
        return this.templatesService.toggleActive(id);
    }

    /**
     * POST /admin/templates/upload - Upload 2 background images for system template
     */
    @Post('admin/templates/upload')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    @UseInterceptors(
        FileFieldsInterceptor(
            [
                { name: 'titleBg', maxCount: 1 },
                { name: 'contentBg', maxCount: 1 },
            ],
            { storage: memoryStorage(), fileFilter: imageFileFilter },
        ),
    )
    async uploadTemplate(
        @UploadedFiles() files: { titleBg?: Express.Multer.File[]; contentBg?: Express.Multer.File[] },
        @Body('name') name: string,
        @Body('description') description?: string,
        @Body('isDefault') isDefault?: string,
    ) {
        if (!files?.titleBg?.[0] || !files?.contentBg?.[0]) {
            throw new BadRequestException('Both titleBg and contentBg images are required');
        }
        if (!name) {
            throw new BadRequestException('Template name is required');
        }

        // Create template first to get ID
        const template = await this.templatesService.create({
            name,
            description,
            isDefault: isDefault === 'true',
        });

        // Save images using FileStorageService
        const titleBgResult = await this.fileStorageService.saveTemplateImage(
            true, // isSystem
            null,
            template.id,
            'title_bg',
            files.titleBg[0].buffer,
            this.getExtensionFromMimetype(files.titleBg[0].mimetype),
        );

        const contentBgResult = await this.fileStorageService.saveTemplateImage(
            true, // isSystem
            null,
            template.id,
            'content_bg',
            files.contentBg[0].buffer,
            this.getExtensionFromMimetype(files.contentBg[0].mimetype),
        );

        // Update template with image URLs
        return this.templatesService.update(template.id, {
            titleBgUrl: titleBgResult.publicUrl,
            contentBgUrl: contentBgResult.publicUrl,
        });
    }

    // ==================== HELPERS ====================

    private getExtensionFromMimetype(mimetype: string): string {
        const mimeToExt: Record<string, string> = {
            'image/png': 'png',
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/webp': 'webp',
            'image/gif': 'gif',
        };
        return mimeToExt[mimetype] || 'png';
    }
}
