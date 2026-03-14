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
    UploadedFile,
    UseInterceptors,
    StreamableFile,
    NotFoundException,
    BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import * as fs from 'fs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SlideAudioService } from './slide-audio.service';
import { SlidesService } from '../slides/slides.service';

@Controller('lessons/:lessonId/slide-audios')
@UseGuards(JwtAuthGuard)
export class SlideAudioController {
    constructor(
        private readonly slideAudioService: SlideAudioService,
        private readonly slidesService: SlidesService,
    ) { }

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

    // Generate speaker notes using AI (Step 4 - new)
    @Post('generate-speaker-notes')
    async generateSpeakerNotes(
        @Param('lessonId') lessonId: string,
        @Request() req,
    ) {
        return this.slidesService.generateSpeakerNotes(lessonId, req.user.id);
    }

    // Optimize & QA speaker notes using AI (Step 4 - Button 2)
    @Post('optimize-speaker-notes')
    async optimizeSpeakerNotes(
        @Param('lessonId') lessonId: string,
        @Request() req,
    ) {
        return this.slidesService.optimizeSpeakerNotes(lessonId, req.user.id);
    }

    // Upload recorded audio for a slide (alternative to TTS)
    @Post(':index/upload-recording')
    @UseInterceptors(FileInterceptor('audio', {
        storage: require('multer').memoryStorage(),
        limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
    }))
    async uploadRecording(
        @Param('lessonId') lessonId: string,
        @Param('index') index: string,
        @UploadedFile() file: Express.Multer.File,
    ) {
        return this.slideAudioService.uploadRecording(
            lessonId,
            parseInt(index, 10),
            file,
        );
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

    // Delete ALL audios for a lesson (reset all to pending)
    @Delete('delete-all')
    async deleteAllAudios(@Param('lessonId') lessonId: string) {
        return this.slideAudioService.deleteAllSlideAudios(lessonId);
    }

    // Download all audios as ZIP
    @Get('download-all')
    async downloadAllAudios(
        @Param('lessonId') lessonId: string,
        @Res({ passthrough: true }) res: Response,
    ) {
        try {
            const { filePath, fileName } = await this.slideAudioService.downloadAllAudios(lessonId);

            res.set({
                'Content-Type': 'application/zip',
                'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
            });

            return new StreamableFile(fs.createReadStream(filePath));
        } catch (error) {
            console.error('[downloadAllAudios] ERROR:', error?.message || error);
            throw error;
        }
    }

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
