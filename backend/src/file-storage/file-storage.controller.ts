import {
    Controller,
    Get,
    Param,
    Res,
    NotFoundException,
    ForbiddenException,
    UseGuards,
    Req,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FileStorageService } from './file-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import * as path from 'path';

@Controller('files')
export class FileStorageController {
    constructor(
        private readonly fileStorageService: FileStorageService,
        private readonly prisma: PrismaService,
    ) { }

    /**
     * Serve audio/image files with authentication
     * GET /files/:userId/:lessonId/:type/:filename
     */
    @Get(':userId/:lessonId/:type/:filename')
    @UseGuards(JwtAuthGuard)
    async serveFile(
        @Param('userId') userId: string,
        @Param('lessonId') lessonId: string,
        @Param('type') type: string,
        @Param('filename') filename: string,
        @Req() req: Request,
        @Res() res: Response,
    ): Promise<void> {
        // Validate type
        if (type !== 'audio' && type !== 'images') {
            throw new NotFoundException('Invalid file type');
        }

        // Get current user from JWT
        const currentUser = req.user as { userId: string };

        // Verify user has access to this lesson
        const lesson = await this.prisma.lesson.findFirst({
            where: { id: lessonId },
            include: {
                subject: {
                    select: { userId: true },
                },
            },
        });

        if (!lesson) {
            throw new NotFoundException('Lesson not found');
        }

        // Check if user owns the lesson (via subject ownership)
        if (lesson.subject.userId !== currentUser.userId) {
            throw new ForbiddenException('Access denied');
        }

        // Build file path
        let filePath: string;
        if (type === 'audio') {
            filePath = this.fileStorageService.getAudioFilePath(userId, lessonId, filename);
        } else {
            filePath = this.fileStorageService.getImageFilePath(userId, lessonId, filename);
        }

        // Validate path is within datauser directory (security)
        if (!this.fileStorageService.validatePathWithinDataUser(filePath)) {
            throw new ForbiddenException('Invalid file path');
        }

        // Check if file exists
        const exists = await this.fileStorageService.fileExists(filePath);
        if (!exists) {
            throw new NotFoundException('File not found');
        }

        // Determine content type
        const ext = path.extname(filename).toLowerCase();
        const contentTypes: Record<string, string> = {
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.ogg': 'audio/ogg',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
        };

        const contentType = contentTypes[ext] || 'application/octet-stream';

        // Read and serve file
        try {
            const fileBuffer = await this.fileStorageService.readFile(filePath);

            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Length', fileBuffer.length);
            res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour

            res.send(fileBuffer);
        } catch (error) {
            throw new NotFoundException('File not found');
        }
    }

    /**
     * PUBLIC endpoint for serving images (no auth required)
     * Browser <img> tags cannot send JWT headers, so we need a public route
     * GET /files/public/:userId/:lessonId/images/:filename
     * 
     * Security: Only serves from images directory, path is validated
     */
    @Get('public/:userId/:lessonId/images/:filename')
    async servePublicImage(
        @Param('userId') userId: string,
        @Param('lessonId') lessonId: string,
        @Param('filename') filename: string,
        @Res() res: Response,
    ): Promise<void> {
        // Build file path
        const filePath = this.fileStorageService.getImageFilePath(userId, lessonId, filename);

        // Validate path is within datauser directory (security)
        if (!this.fileStorageService.validatePathWithinDataUser(filePath)) {
            throw new ForbiddenException('Invalid file path');
        }

        // Check if file exists
        const exists = await this.fileStorageService.fileExists(filePath);
        if (!exists) {
            throw new NotFoundException('File not found');
        }

        // Determine content type
        const ext = path.extname(filename).toLowerCase();
        const contentTypes: Record<string, string> = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
        };

        const contentType = contentTypes[ext] || 'application/octet-stream';

        // Read and serve file
        try {
            const fileBuffer = await this.fileStorageService.readFile(filePath);

            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Length', fileBuffer.length);
            res.setHeader('Cache-Control', 'public, max-age=3600');

            res.send(fileBuffer);
        } catch (error) {
            throw new NotFoundException('File not found');
        }
    }

    /**
     * PUBLIC endpoint for serving SYSTEM template background images
     * GET /files/public/system/templates/:templateId/:filename
     * 
     * Serves: datauser/system/templates/{templateId}/{filename}
     */
    @Get('public/system/templates/:templateId/:filename')
    async serveSystemTemplateBg(
        @Param('templateId') templateId: string,
        @Param('filename') filename: string,
        @Res() res: Response,
    ): Promise<void> {
        // Build file path: datauser/system/templates/{templateId}/{filename}
        const filePath = path.join(
            process.cwd(),
            'datauser',
            'system',
            'templates',
            templateId,
            filename
        );

        // Validate path is within datauser directory (security)
        if (!this.fileStorageService.validatePathWithinDataUser(filePath)) {
            throw new ForbiddenException('Invalid file path');
        }

        // Check if file exists
        const exists = await this.fileStorageService.fileExists(filePath);
        if (!exists) {
            throw new NotFoundException(`Template file not found: ${templateId}/${filename}`);
        }

        // Determine content type
        const ext = path.extname(filename).toLowerCase();
        const contentTypes: Record<string, string> = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
        };

        const contentType = contentTypes[ext] || 'image/png';

        // Read and serve file
        try {
            const fileBuffer = await this.fileStorageService.readFile(filePath);

            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Length', fileBuffer.length);
            res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache 24h

            res.send(fileBuffer);
        } catch (error) {
            throw new NotFoundException('File not found');
        }
    }

    /**
     * PUBLIC endpoint for serving USER template background images
     * GET /files/public/:userId/templates/:templateId/:filename
     * 
     * Serves: datauser/{userId}/templates/{templateId}/{filename}
     */
    @Get('public/:userId/templates/:templateId/:filename')
    async serveUserTemplateBg(
        @Param('userId') userId: string,
        @Param('templateId') templateId: string,
        @Param('filename') filename: string,
        @Res() res: Response,
    ): Promise<void> {
        // Build file path: datauser/{userId}/templates/{templateId}/{filename}
        const filePath = path.join(
            process.cwd(),
            'datauser',
            userId,
            'templates',
            templateId,
            filename
        );

        // Validate path is within datauser directory (security)
        if (!this.fileStorageService.validatePathWithinDataUser(filePath)) {
            throw new ForbiddenException('Invalid file path');
        }

        // Check if file exists
        const exists = await this.fileStorageService.fileExists(filePath);
        if (!exists) {
            throw new NotFoundException(`Template file not found: ${userId}/${templateId}/${filename}`);
        }

        // Determine content type
        const ext = path.extname(filename).toLowerCase();
        const contentTypes: Record<string, string> = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
        };

        const contentType = contentTypes[ext] || 'image/png';

        // Read and serve file
        try {
            const fileBuffer = await this.fileStorageService.readFile(filePath);

            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Length', fileBuffer.length);
            res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache 24h

            res.send(fileBuffer);
        } catch (error) {
            throw new NotFoundException('File not found');
        }
    }


    /**
     * List files in a lesson's audio or images directory
     * GET /files/:userId/:lessonId/:type
     */
    @Get(':userId/:lessonId/:type')
    @UseGuards(JwtAuthGuard)
    async listFiles(
        @Param('userId') userId: string,
        @Param('lessonId') lessonId: string,
        @Param('type') type: string,
        @Req() req: Request,
    ): Promise<{ files: string[] }> {
        // Validate type
        if (type !== 'audio' && type !== 'images') {
            throw new NotFoundException('Invalid file type');
        }

        // Get current user from JWT
        const currentUser = req.user as { userId: string };

        // Verify user has access to this lesson
        const lesson = await this.prisma.lesson.findFirst({
            where: { id: lessonId },
            include: {
                subject: {
                    select: { userId: true },
                },
            },
        });

        if (!lesson) {
            throw new NotFoundException('Lesson not found');
        }

        if (lesson.subject.userId !== currentUser.userId) {
            throw new ForbiddenException('Access denied');
        }

        // Get directory path
        let dirPath: string;
        if (type === 'audio') {
            dirPath = this.fileStorageService.getAudioPath(userId, lessonId);
        } else {
            dirPath = this.fileStorageService.getImagesPath(userId, lessonId);
        }

        // List files
        const files = await this.fileStorageService.listFiles(dirPath);

        return { files };
    }
}
