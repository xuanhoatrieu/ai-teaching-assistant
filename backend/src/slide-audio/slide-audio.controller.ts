import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Param,
    Body,
    Res,
    UseGuards,
    Request,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SlideAudioService } from './slide-audio.service';

@Controller('lessons/:lessonId/slide-audios')
@UseGuards(JwtAuthGuard)
export class SlideAudioController {
    constructor(private readonly slideAudioService: SlideAudioService) { }

    // Get all slide audios for a lesson
    @Get()
    async getSlideAudios(@Param('lessonId') lessonId: string) {
        return this.slideAudioService.getSlideAudios(lessonId);
    }

    // Initialize slide audios from slide script
    @Post('init')
    async initializeSlideAudios(@Param('lessonId') lessonId: string) {
        return this.slideAudioService.initializeSlideAudios(lessonId);
    }

    // Generate audio for all slides
    @Post('generate-all')
    async generateAllAudios(
        @Param('lessonId') lessonId: string,
        @Request() req,
    ) {
        return this.slideAudioService.generateAllAudios(lessonId, req.user.id);
    }

    // Generate audio for a single slide
    @Post(':index/generate')
    async generateSingleAudio(
        @Param('lessonId') lessonId: string,
        @Param('index') index: string,
        @Body('multilingualMode') multilingualMode: string,
        @Request() req,
    ) {
        return this.slideAudioService.generateSingleAudio(
            lessonId,
            parseInt(index, 10),
            req.user.id,
            multilingualMode,
        );
    }

    // Update speaker note for a slide
    @Put(':index/speaker-note')
    async updateSpeakerNote(
        @Param('lessonId') lessonId: string,
        @Param('index') index: string,
        @Body('speakerNote') speakerNote: string,
    ) {
        return this.slideAudioService.updateSpeakerNote(
            lessonId,
            parseInt(index, 10),
            speakerNote,
        );
    }

    // Sync speaker notes back to slide script
    @Post('sync')
    async syncToSlideScript(@Param('lessonId') lessonId: string) {
        return this.slideAudioService.syncSpeakerNotesToSlideScript(lessonId);
    }

    // Download all audios as ZIP
    @Get('download-all')
    async downloadAllAudios(
        @Param('lessonId') lessonId: string,
        @Res({ passthrough: true }) res: Response,
    ) {
        console.log(`[DEBUG] downloadAllAudios called for lesson: ${lessonId}`);

        const fs = require('fs');
        const path = require('path');
        const archiver = require('archiver');
        const { StreamableFile, NotFoundException, BadRequestException } = require('@nestjs/common');

        // Get lesson info
        const lesson = await this.slideAudioService.getLessonForDownload(lessonId);
        if (!lesson) {
            throw new NotFoundException(`Lesson ${lessonId} not found`);
        }

        // Get audio files with status 'done'
        const slideAudios = await this.slideAudioService.getAudioFilesForDownload(lessonId);
        if (slideAudios.length === 0) {
            throw new BadRequestException('No audio files available for download');
        }

        console.log(`[DEBUG] Found ${slideAudios.length} audio files`);

        // Sanitize title
        const safeTitle = lesson.title
            .replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF ]/g, '_')
            .replace(/\s+/g, '_')
            .substring(0, 50);

        const audioDir = path.join(process.cwd(), 'uploads', 'lessons', lessonId, 'audio');
        const zipPath = path.join(audioDir, `${safeTitle}_audio.zip`);

        console.log(`[DEBUG] Creating ZIP at: ${zipPath}`);

        // Delete existing ZIP
        if (fs.existsSync(zipPath)) {
            fs.unlinkSync(zipPath);
        }

        // Create ZIP synchronously like debug endpoint
        await new Promise<void>((resolve, reject) => {
            const output = fs.createWriteStream(zipPath);
            const archive = archiver('zip', { zlib: { level: 9 } });

            output.on('close', () => {
                console.log(`[DEBUG] ZIP created: ${archive.pointer()} bytes`);
                resolve();
            });

            output.on('error', reject);
            archive.on('error', reject);

            archive.pipe(output);

            // Add all audio files
            for (const audio of slideAudios) {
                if (!audio.audioFileName) continue;

                const audioPath = path.join(audioDir, audio.audioFileName);
                if (fs.existsSync(audioPath)) {
                    const ext = path.extname(audio.audioFileName);
                    const downloadName = `${safeTitle}_slide_${audio.slideIndex + 1}${ext}`;
                    archive.file(audioPath, { name: downloadName });
                    console.log(`[DEBUG] Added: ${audio.audioFileName} -> ${downloadName}`);
                }
            }

            archive.finalize();
        });

        console.log(`[DEBUG] Sending ZIP file: ${zipPath}`);

        res.set({
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${safeTitle}_audio.zip"`,
        });

        return new StreamableFile(fs.createReadStream(zipPath));
    }
    // Download single slide audio
    @Get(':index/download')
    async downloadSingleAudio(
        @Param('lessonId') lessonId: string,
        @Param('index') index: string,
        @Res() res: Response,
    ) {
        const { filePath, fileName } = await this.slideAudioService.getSlideAudioDownload(
            lessonId,
            parseInt(index, 10),
        );
        res.download(filePath, fileName);
    }

    // Delete audio for a slide (reset to pending)
    @Delete(':index')
    async deleteAudio(
        @Param('lessonId') lessonId: string,
        @Param('index') index: string,
    ) {
        return this.slideAudioService.deleteSlideAudio(
            lessonId,
            parseInt(index, 10),
        );
    }
}
