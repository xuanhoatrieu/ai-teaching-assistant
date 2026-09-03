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
    Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import * as fs from 'fs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SlideAudioService } from './slide-audio.service';
import { SlidesService } from '../slides/slides.service';
import { GenerationJobService } from '../generation-job/generation-job.service';

@Controller('lessons/:lessonId/slide-audios')
@UseGuards(JwtAuthGuard)
export class SlideAudioController {
    private readonly logger = new Logger(SlideAudioController.name);

    constructor(
        private readonly slideAudioService: SlideAudioService,
        private readonly slidesService: SlidesService,
        private readonly jobService: GenerationJobService,
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

    // Generate speaker notes using AI (async job)
    @Post('generate-speaker-notes')
    async generateSpeakerNotes(
        @Param('lessonId') lessonId: string,
        @Request() req,
    ) {
        const userId = req.user.id;

        // Check if there is already an active job
        const activeJob = await this.jobService.getActiveJob(lessonId, 'speaker-notes');
        if (activeJob) {
            this.logger.log(`[generateSpeakerNotes] Active job ${activeJob.id} already exists for lesson ${lessonId}. Re-attaching.`);
            return { jobId: activeJob.id, status: 'processing' };
        }

        const job = await this.jobService.createJob({
            type: 'speaker-notes',
            lessonId,
            userId,
        });

        setImmediate(async () => {
            try {
                await this.jobService.updateProgress(job.id, 0, 'Đang chuẩn bị tạo lời giảng...');
                await this.slidesService.generateSpeakerNotes(
                    lessonId,
                    userId,
                    async (pct, msg) => {
                        await this.jobService.updateProgress(job.id, pct, msg);
                    },
                    async () => {
                        return this.jobService.isJobCancelled(job.id);
                    },
                );

                if (await this.jobService.isJobCancelled(job.id)) {
                    this.logger.log(`[generateSpeakerNotes] Job ${job.id} was cancelled.`);
                    return;
                }

                await this.jobService.completeJob(job.id);
            } catch (error) {
                if (await this.jobService.isJobCancelled(job.id)) {
                    this.logger.log(`[generateSpeakerNotes] Job ${job.id} was cancelled during execution.`);
                    return;
                }
                this.logger.error(`[generateSpeakerNotes] Job ${job.id} failed:`, error);
                await this.jobService.failJob(job.id, error?.message || 'Unknown error');
            }
        });

        return { jobId: job.id, status: 'pending' };
    }

    // Optimize & QA speaker notes using AI (async job)
    @Post('optimize-speaker-notes')
    async optimizeSpeakerNotes(
        @Param('lessonId') lessonId: string,
        @Request() req,
    ) {
        const userId = req.user.id;

        // Check if there is already an active job
        const activeJob = await this.jobService.getActiveJob(lessonId, 'optimize-notes');
        if (activeJob) {
            this.logger.log(`[optimizeSpeakerNotes] Active job ${activeJob.id} already exists for lesson ${lessonId}. Re-attaching.`);
            return { jobId: activeJob.id, status: 'processing' };
        }

        const job = await this.jobService.createJob({
            type: 'optimize-notes',
            lessonId,
            userId,
        });

        setImmediate(async () => {
            try {
                await this.jobService.updateProgress(job.id, 0, 'Đang chuẩn bị tối ưu lời giảng...');
                await this.slidesService.optimizeSpeakerNotes(
                    lessonId,
                    userId,
                    async (pct, msg) => {
                        await this.jobService.updateProgress(job.id, pct, msg);
                    },
                    async () => {
                        return this.jobService.isJobCancelled(job.id);
                    },
                );

                if (await this.jobService.isJobCancelled(job.id)) {
                    this.logger.log(`[optimizeSpeakerNotes] Job ${job.id} was cancelled.`);
                    return;
                }

                await this.jobService.completeJob(job.id);
            } catch (error) {
                if (await this.jobService.isJobCancelled(job.id)) {
                    this.logger.log(`[optimizeSpeakerNotes] Job ${job.id} was cancelled during execution.`);
                    return;
                }
                this.logger.error(`[optimizeSpeakerNotes] Job ${job.id} failed:`, error);
                await this.jobService.failJob(job.id, error?.message || 'Unknown error');
            }
        });

        return { jobId: job.id, status: 'pending' };
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

    // Generate audio for slides (all or range)
    @Post('generate-all')
    async generateAllAudios(
        @Param('lessonId') lessonId: string,
        @Request() req: any,
        @Body('multilingualMode') multilingualMode?: string,
        @Body('vittsMode') vittsMode?: string,
        @Body('vittsDesignInstruct') vittsDesignInstruct?: string,
        @Body('vittsNormalize') vittsNormalize?: boolean,
        @Body('fromSlide') fromSlide?: number,
        @Body('toSlide') toSlide?: number,
        @Body('onlyMissingOrError') onlyMissingOrError?: boolean,
    ) {
        const userId = req.user.id;

        // Check if there is already an active job
        const activeJob = await this.jobService.getActiveJob(lessonId, 'slide-audio-generate-all');
        if (activeJob) {
            this.logger.log(`[generateAllAudios] Active job ${activeJob.id} already exists for lesson ${lessonId}. Re-attaching.`);
            return { jobId: activeJob.id, status: 'processing' };
        }

        const job = await this.jobService.createJob({
            type: 'slide-audio-generate-all',
            lessonId,
            userId,
        });

        // Capture TTS params and range filters for the background job closure
        const ttsParams = { multilingualMode, vittsMode, vittsDesignInstruct, vittsNormalize };
        const rangeParams = { fromSlide, toSlide, onlyMissingOrError };

        setImmediate(async () => {
            try {
                const slideAudios = await this.slideAudioService.getSlideAudios(lessonId);
                if (slideAudios.length === 0) {
                    throw new Error('Không tìm thấy thông tin audio cho slide. Vui lòng khởi tạo trước.');
                }

                // Filter slide audios that have speakerNote
                let slidesToGenerate = slideAudios.filter(s => s.speakerNote?.trim());

                // Apply slide range filter (1-based index)
                if (rangeParams.fromSlide !== undefined && rangeParams.fromSlide !== null && !isNaN(Number(rangeParams.fromSlide))) {
                    slidesToGenerate = slidesToGenerate.filter(s => s.slideIndex >= Number(rangeParams.fromSlide));
                }
                if (rangeParams.toSlide !== undefined && rangeParams.toSlide !== null && !isNaN(Number(rangeParams.toSlide))) {
                    slidesToGenerate = slidesToGenerate.filter(s => s.slideIndex <= Number(rangeParams.toSlide));
                }

                // Apply quick filter: only missing or error
                if (rangeParams.onlyMissingOrError) {
                    slidesToGenerate = slidesToGenerate.filter(s => s.status !== 'done' && s.status !== 'completed' && (!s.audioUrl || s.status === 'error' || s.status === 'pending'));
                }

                const total = slidesToGenerate.length;

                if (total === 0) {
                    await this.jobService.updateProgress(job.id, 100, 'Không có slide nào cần tạo audio.');
                    await this.jobService.completeJob(job.id);
                    return;
                }

                await this.jobService.updateProgress(job.id, 0, `Bắt đầu tạo audio cho ${total} slide...`);

                for (let i = 0; i < total; i++) {
                    if (await this.jobService.isJobCancelled(job.id)) {
                        this.logger.log(`[generateAllAudios] Job ${job.id} cancelled by user at slide ${i + 1}/${total}.`);
                        return;
                    }

                    const slideAudio = slidesToGenerate[i];
                    await this.jobService.updateProgress(
                        job.id,
                        Math.round((i / total) * 100),
                        `Đang tạo audio cho slide ${slideAudio.slideIndex} (${i + 1}/${total})...`
                    );

                    try {
                        await this.slideAudioService.generateSingleAudio(
                            lessonId,
                            slideAudio.slideIndex,
                            userId,
                            ttsParams.multilingualMode,
                            ttsParams.vittsMode,
                            ttsParams.vittsDesignInstruct,
                            ttsParams.vittsNormalize,
                        );
                    } catch (error) {
                        this.logger.error(`Failed to generate audio for slide index ${slideAudio.slideIndex}:`, error);
                    }
                }

                if (await this.jobService.isJobCancelled(job.id)) {
                    this.logger.log(`[generateAllAudios] Job ${job.id} cancelled after loop.`);
                    return;
                }

                await this.slideAudioService.updateLessonStep(lessonId, 4);
                await this.jobService.completeJob(job.id);
            } catch (error) {
                if (await this.jobService.isJobCancelled(job.id)) {
                    this.logger.log(`[generateAllAudios] Job ${job.id} was cancelled during execution.`);
                    return;
                }
                this.logger.error(`[generateAllAudios] Job ${job.id} failed:`, error);
                await this.jobService.failJob(job.id, error?.message || 'Unknown error');
            }
        });

        return { jobId: job.id, status: 'pending' };
    }

    // Generate audio for a single slide
    @Post(':index/generate')
    async generateSingleAudio(
        @Param('lessonId') lessonId: string,
        @Param('index') index: string,
        @Body('multilingualMode') multilingualMode: string,
        @Body('vittsMode') vittsMode: string,
        @Body('vittsDesignInstruct') vittsDesignInstruct: string,
        @Body('vittsNormalize') vittsNormalize: boolean,
        @Request() req,
    ) {
        return this.slideAudioService.generateSingleAudio(
            lessonId,
            parseInt(index, 10),
            req.user.id,
            multilingualMode,
            vittsMode,
            vittsDesignInstruct,
            vittsNormalize,
        );
    }

    // Import speaker notes from parsed TXT array
    @Post('import-speaker-notes')
    async importSpeakerNotes(
        @Param('lessonId') lessonId: string,
        @Body() body: {
            notes: Array<{ slideIndex: number; speakerNote: string }>;
            target?: 'raw' | 'optimized' | 'both';
        },
    ) {
        if (!body.notes || !Array.isArray(body.notes) || body.notes.length === 0) {
            throw new BadRequestException('Danh sách lời giảng không hợp lệ');
        }
        return this.slideAudioService.importSpeakerNotes(
            lessonId,
            body.notes,
            body.target || 'optimized',
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
