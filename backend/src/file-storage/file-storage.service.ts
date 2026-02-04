import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class FileStorageService {
    private readonly baseDataPath: string;

    constructor() {
        // Base path for user data storage
        this.baseDataPath = path.resolve(process.cwd(), 'datauser');
    }

    // ==================== PATH HELPERS ====================

    /**
     * Get the base datauser path
     */
    getDataUserPath(): string {
        return this.baseDataPath;
    }

    /**
     * Get user's root directory path
     */
    getUserPath(userId: string): string {
        this.validatePathSegment(userId);
        return path.join(this.baseDataPath, userId);
    }

    /**
     * Get lesson's directory path
     */
    getLessonPath(userId: string, lessonId: string): string {
        this.validatePathSegment(userId);
        this.validatePathSegment(lessonId);
        return path.join(this.baseDataPath, userId, 'lessons', lessonId);
    }

    /**
     * Get audio directory path for a lesson
     */
    getAudioPath(userId: string, lessonId: string): string {
        return path.join(this.getLessonPath(userId, lessonId), 'audio');
    }

    /**
     * Get images directory path for a lesson
     */
    getImagesPath(userId: string, lessonId: string): string {
        return path.join(this.getLessonPath(userId, lessonId), 'images');
    }

    // ==================== V2 PATH HELPERS (Subject-based) ====================

    /**
     * Get subject's directory path
     * Structure: datauser/{userId}/{subjectId}/
     */
    getSubjectPath(userId: string, subjectId: string): string {
        this.validatePathSegment(userId);
        this.validatePathSegment(subjectId);
        return path.join(this.baseDataPath, userId, subjectId);
    }

    /**
     * Get lesson's directory path (V2 with subject)
     * Structure: datauser/{userId}/{subjectId}/{lessonId}/
     */
    getLessonPathV2(userId: string, subjectId: string, lessonId: string): string {
        this.validatePathSegment(lessonId);
        return path.join(this.getSubjectPath(userId, subjectId), lessonId);
    }

    /**
     * Get audio directory path for a lesson (V2 with subject)
     */
    getAudioPathV2(userId: string, subjectId: string, lessonId: string): string {
        return path.join(this.getLessonPathV2(userId, subjectId, lessonId), 'audio');
    }

    /**
     * Get images directory path for a lesson (V2 with subject)
     */
    getImagesPathV2(userId: string, subjectId: string, lessonId: string): string {
        return path.join(this.getLessonPathV2(userId, subjectId, lessonId), 'images');
    }

    /**
     * Get exports directory path for a lesson (V2 with subject)
     */
    getExportsPathV2(userId: string, subjectId: string, lessonId: string): string {
        return path.join(this.getLessonPathV2(userId, subjectId, lessonId), 'exports');
    }

    /**
     * Get user's templates directory path
     * Structure: datauser/{userId}/templates/
     */
    getUserTemplatesPath(userId: string): string {
        this.validatePathSegment(userId);
        return path.join(this.baseDataPath, userId, 'templates');
    }

    /**
     * Get system templates directory path
     * Structure: datauser/system/templates/
     */
    getSystemTemplatesPath(): string {
        return path.join(this.baseDataPath, 'system', 'templates');
    }

    // ==================== FILE OPERATIONS ====================

    /**
     * Ensure a directory exists, create if not
     */
    async ensureDirectoryExists(dirPath: string): Promise<void> {
        try {
            await fs.mkdir(dirPath, { recursive: true });
        } catch (error) {
            // Directory already exists or other error
            if (error.code !== 'EEXIST') {
                throw error;
            }
        }
    }

    /**
     * Save a file to the specified path
     */
    async saveFile(filePath: string, buffer: Buffer): Promise<string> {
        const dir = path.dirname(filePath);
        await this.ensureDirectoryExists(dir);
        await fs.writeFile(filePath, buffer);
        return filePath;
    }

    /**
     * Read a file from the specified path
     */
    async readFile(filePath: string): Promise<Buffer> {
        try {
            return await fs.readFile(filePath);
        } catch (error) {
            if (error.code === 'ENOENT') {
                throw new NotFoundException(`File not found: ${path.basename(filePath)}`);
            }
            throw error;
        }
    }

    /**
     * Delete a file
     */
    async deleteFile(filePath: string): Promise<void> {
        try {
            await fs.unlink(filePath);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
            // File doesn't exist, that's fine
        }
    }

    /**
     * List files in a directory
     */
    async listFiles(dirPath: string): Promise<string[]> {
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            return entries
                .filter(entry => entry.isFile())
                .map(entry => entry.name);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }

    /**
     * Delete a directory and all its contents
     */
    async deleteDirectory(dirPath: string): Promise<void> {
        try {
            await fs.rm(dirPath, { recursive: true, force: true });
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
    }

    /**
     * Check if a file exists
     */
    async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    // ==================== FILENAME HELPERS ====================

    /**
     * Generate audio filename for a slide
     * Format: {sanitizedTitle}_slide_{paddedIndex}.mp3
     */
    generateAudioFileName(lessonTitle: string, slideIndex: number): string {
        const sanitizedTitle = this.sanitizeFilename(lessonTitle).substring(0, 30);
        const paddedIndex = String(slideIndex + 1).padStart(2, '0');
        return `${sanitizedTitle}_slide_${paddedIndex}.mp3`;
    }

    /**
     * Generate image filename for a slide
     * Format: slide_{paddedIndex}.{extension}
     */
    generateImageFileName(slideIndex: number, extension: string = 'png'): string {
        const paddedIndex = String(slideIndex + 1).padStart(2, '0');
        return `slide_${paddedIndex}.${extension}`;
    }

    /**
     * Sanitize a string for use in a filename
     */
    sanitizeFilename(name: string): string {
        return name
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '') // Remove invalid characters
            .replace(/\s+/g, '_') // Replace spaces with underscores
            .replace(/_{2,}/g, '_') // Replace multiple underscores with single
            .replace(/^_|_$/g, '') // Remove leading/trailing underscores
            .trim();
    }

    // ==================== URL HELPERS ====================

    /**
     * Get the public URL for a file
     * For images: uses public route since browser <img> tags cannot send JWT headers
     * For audio: uses authenticated route since audio is loaded via API calls
     * @param userId User ID
     * @param lessonId Lesson ID
     * @param type 'audio' or 'images'
     * @param filename The filename
     */
    getPublicUrl(userId: string, lessonId: string, type: 'audio' | 'images', filename: string): string {
        // Images use public route (browser <img> tags cannot send JWT headers)
        if (type === 'images') {
            return `/files/public/${userId}/${lessonId}/images/${filename}`;
        }
        // Audio uses authenticated route (loaded via API calls)
        return `/files/${userId}/${lessonId}/${type}/${filename}`;
    }

    /**
     * Parse a public URL back to file path
     */
    parsePublicUrl(url: string): { userId: string; lessonId: string; type: string; filename: string } | null {
        const match = url.match(/^\/files\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
        if (!match) return null;
        return {
            userId: match[1],
            lessonId: match[2],
            type: match[3],
            filename: match[4],
        };
    }

    /**
     * Get the public URL for a file (V2 with subject)
     * For images: uses public route since browser <img> tags cannot send JWT headers
     * For audio: uses authenticated route since audio is loaded via API calls
     */
    getPublicUrlV2(
        userId: string,
        subjectId: string,
        lessonId: string,
        type: 'audio' | 'images',
        filename: string,
    ): string {
        // Images use public route (browser <img> tags cannot send JWT headers)
        if (type === 'images') {
            return `/files/public/${userId}/${subjectId}/${lessonId}/images/${filename}`;
        }
        // Audio uses authenticated route (loaded via API calls)
        return `/files/${userId}/${subjectId}/${lessonId}/${type}/${filename}`;
    }

    /**
     * Get public URL for template images
     */
    getTemplateImageUrl(isSystem: boolean, userId: string | null, templateId: string, filename: string): string {
        if (isSystem) {
            return `/files/public/system/templates/${templateId}/${filename}`;
        }
        return `/files/public/${userId}/templates/${templateId}/${filename}`;
    }

    // ==================== LESSON LIFECYCLE ====================

    /**
     * Create directories for a new lesson
     */
    async createLessonDirectories(userId: string, lessonId: string): Promise<void> {
        await this.ensureDirectoryExists(this.getAudioPath(userId, lessonId));
        await this.ensureDirectoryExists(this.getImagesPath(userId, lessonId));
    }

    /**
     * Delete all files for a lesson (cleanup on lesson delete)
     */
    async cleanupLessonFiles(userId: string, lessonId: string): Promise<void> {
        const lessonPath = this.getLessonPath(userId, lessonId);
        await this.deleteDirectory(lessonPath);
    }

    /**
     * Delete all files for a user (cleanup on user delete)
     */
    async cleanupUserFiles(userId: string): Promise<void> {
        const userPath = this.getUserPath(userId);
        await this.deleteDirectory(userPath);
    }

    // ==================== AUDIO SPECIFIC ====================

    /**
     * Save audio file for a slide
     */
    async saveAudioFile(
        userId: string,
        lessonId: string,
        lessonTitle: string,
        slideIndex: number,
        audioBuffer: Buffer,
    ): Promise<{ filePath: string; publicUrl: string }> {
        const filename = this.generateAudioFileName(lessonTitle, slideIndex);
        const audioDir = this.getAudioPath(userId, lessonId);
        const filePath = path.join(audioDir, filename);

        await this.saveFile(filePath, audioBuffer);

        return {
            filePath,
            publicUrl: this.getPublicUrl(userId, lessonId, 'audio', filename),
        };
    }

    /**
     * Get audio file path for a slide
     */
    getAudioFilePath(userId: string, lessonId: string, filename: string): string {
        return path.join(this.getAudioPath(userId, lessonId), filename);
    }

    // ==================== IMAGE SPECIFIC ====================

    /**
     * Save image file for a slide
     */
    async saveImageFile(
        userId: string,
        lessonId: string,
        slideIndex: number,
        imageBuffer: Buffer,
        extension: string = 'png',
    ): Promise<{ filePath: string; publicUrl: string }> {
        const filename = this.generateImageFileName(slideIndex, extension);
        const imagesDir = this.getImagesPath(userId, lessonId);
        const filePath = path.join(imagesDir, filename);

        await this.saveFile(filePath, imageBuffer);

        return {
            filePath,
            publicUrl: this.getPublicUrl(userId, lessonId, 'images', filename),
        };
    }

    /**
     * Get image file path for a slide
     */
    getImageFilePath(userId: string, lessonId: string, filename: string): string {
        return path.join(this.getImagesPath(userId, lessonId), filename);
    }

    // ==================== V2 LIFECYCLE METHODS ====================

    /**
     * Create directories for a new lesson (V2 with subject)
     */
    async createLessonDirectoriesV2(userId: string, subjectId: string, lessonId: string): Promise<void> {
        await this.ensureDirectoryExists(this.getAudioPathV2(userId, subjectId, lessonId));
        await this.ensureDirectoryExists(this.getImagesPathV2(userId, subjectId, lessonId));
        await this.ensureDirectoryExists(this.getExportsPathV2(userId, subjectId, lessonId));
    }

    /**
     * Delete all files for a lesson (V2 with subject)
     */
    async cleanupLessonFilesV2(userId: string, subjectId: string, lessonId: string): Promise<void> {
        const lessonPath = this.getLessonPathV2(userId, subjectId, lessonId);
        await this.deleteDirectory(lessonPath);
    }

    // ==================== V2 SAVE METHODS ====================

    /**
     * Save image file for a slide (V2 with subject)
     */
    async saveImageFileV2(
        userId: string,
        subjectId: string,
        lessonId: string,
        slideIndex: number,
        imageBuffer: Buffer,
        extension: string = 'png',
    ): Promise<{ filePath: string; publicUrl: string }> {
        const filename = this.generateImageFileName(slideIndex, extension);
        const imagesDir = this.getImagesPathV2(userId, subjectId, lessonId);
        const filePath = path.join(imagesDir, filename);

        await this.saveFile(filePath, imageBuffer);

        return {
            filePath,
            publicUrl: this.getPublicUrlV2(userId, subjectId, lessonId, 'images', filename),
        };
    }

    /**
     * Save audio file for a slide (V2 with subject)
     */
    async saveAudioFileV2(
        userId: string,
        subjectId: string,
        lessonId: string,
        lessonTitle: string,
        slideIndex: number,
        audioBuffer: Buffer,
    ): Promise<{ filePath: string; publicUrl: string }> {
        const filename = this.generateAudioFileName(lessonTitle, slideIndex);
        const audioDir = this.getAudioPathV2(userId, subjectId, lessonId);
        const filePath = path.join(audioDir, filename);

        await this.saveFile(filePath, audioBuffer);

        return {
            filePath,
            publicUrl: this.getPublicUrlV2(userId, subjectId, lessonId, 'audio', filename),
        };
    }

    /**
     * Save template background image
     */
    async saveTemplateImage(
        isSystem: boolean,
        userId: string | null,
        templateId: string,
        imageType: 'title_bg' | 'content_bg',
        imageBuffer: Buffer,
        extension: string = 'png',
    ): Promise<{ filePath: string; publicUrl: string }> {
        const filename = `${imageType}.${extension}`;
        let templatesDir: string;

        if (isSystem) {
            templatesDir = path.join(this.getSystemTemplatesPath(), templateId);
        } else {
            if (!userId) throw new BadRequestException('userId required for user templates');
            templatesDir = path.join(this.getUserTemplatesPath(userId), templateId);
        }

        const filePath = path.join(templatesDir, filename);
        await this.saveFile(filePath, imageBuffer);

        return {
            filePath,
            publicUrl: this.getTemplateImageUrl(isSystem, userId, templateId, filename),
        };
    }

    // ==================== SECURITY ====================

    /**
     * Validate a path segment to prevent directory traversal
     */
    private validatePathSegment(segment: string): void {
        if (!segment || segment.includes('..') || segment.includes('/') || segment.includes('\\')) {
            throw new BadRequestException('Invalid path segment');
        }
    }

    /**
     * Validate that a path is within the datauser directory
     */
    validatePathWithinDataUser(filePath: string): boolean {
        const resolvedPath = path.resolve(filePath);
        const resolvedBase = path.resolve(this.baseDataPath);
        return resolvedPath.startsWith(resolvedBase);
    }
}
