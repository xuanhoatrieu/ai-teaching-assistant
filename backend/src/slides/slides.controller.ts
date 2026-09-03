import {
    Controller,
    Get,
    Put,
    Post,
    Delete,
    Body,
    Param,
    UseGuards,
    Request,
    Logger,
} from '@nestjs/common';
import { SlidesService } from './slides.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GenerationJobService } from '../generation-job/generation-job.service';
import { IsString, IsNotEmpty } from 'class-validator';

// DTOs
class UpdateSlideScriptDto {
    @IsString()
    @IsNotEmpty()
    slideScript: string;
}

@Controller('lessons/:lessonId/slides')
@UseGuards(JwtAuthGuard)
export class SlidesController {
    private readonly logger = new Logger(SlidesController.name);

    constructor(
        private slidesService: SlidesService,
        private readonly jobService: GenerationJobService,
    ) { }

    // GET /lessons/:lessonId/slides - Get all Slide entities from database (for Step 5)
    @Get()
    async getSlides(@Param('lessonId') lessonId: string) {
        return this.slidesService.getSlides(lessonId);
    }

    // GET /lessons/:lessonId/slides/script-data - Get slide script metadata (for Step 3)
    @Get('script-data')
    async getSlideScriptData(@Param('lessonId') lessonId: string) {
        return this.slidesService.getSlideScriptData(lessonId);
    }

    // POST /lessons/:id/slides/generate-script - Generate slide script with AI (Step 3)
    @Post('generate-script')
    async generateSlideScript(
        @Param('lessonId') lessonId: string,
        @Request() req,
    ) {
        const slideScript = await this.slidesService.generateSlideScript(
            lessonId,
            req.user.id,
        );
        return { slideScript };
    }

    // PUT /lessons/:id/slides/script - Update slide script after user edit
    @Put('script')
    async updateSlideScript(
        @Param('lessonId') lessonId: string,
        @Body() dto: UpdateSlideScriptDto,
    ) {
        return this.slidesService.updateSlideScript(lessonId, dto.slideScript);
    }

    // POST /lessons/:lessonId/slides/:slideIndex/regenerate-content - Regenerate content for single slide
    @Post(':slideIndex/regenerate-content')
    async regenerateContent(
        @Param('lessonId') lessonId: string,
        @Param('slideIndex') slideIndex: string,
        @Request() req,
    ) {
        return this.slidesService.regenerateSlideContent(
            lessonId,
            parseInt(slideIndex, 10),
            req.user.id,
        );
    }

    // POST /lessons/:lessonId/slides/:slideIndex/regenerate-image - Regenerate image for single slide
    @Post(':slideIndex/regenerate-image')
    async regenerateImage(
        @Param('lessonId') lessonId: string,
        @Param('slideIndex') slideIndex: string,
        @Request() req,
    ) {
        return this.slidesService.regenerateSlideImage(
            lessonId,
            parseInt(slideIndex, 10),
            req.user.id,
        );
    }

    // POST /lessons/:lessonId/slides/:slideIndex/generate-content-image
    // Generate optimized content + image for a single slide (sequential pattern like audio)
    @Post(':slideIndex/generate-content-image')
    async generateContentAndImage(
        @Param('lessonId') lessonId: string,
        @Param('slideIndex') slideIndex: string,
        @Request() req,
    ) {
        return this.slidesService.generateContentAndImage(
            lessonId,
            parseInt(slideIndex, 10),
            req.user.id,
        );
    }

    // DELETE /lessons/:lessonId/slides/generated-content
    // Reset all optimizedContentJson + imageUrl so slides can be regenerated from scratch
    @Delete('generated-content')
    async clearGeneratedContent(
        @Param('lessonId') lessonId: string,
    ) {
        return this.slidesService.clearGeneratedContent(lessonId);
    }

    // POST /lessons/:lessonId/slides/generate-all-content
    // Generate optimized content + images for all slides (async job)
    @Post('generate-all-content')
    async generateAllContent(
        @Param('lessonId') lessonId: string,
        @Request() req,
    ) {
        const userId = req.user.id;

        // Check if there is already an active job
        const activeJob = await this.jobService.getActiveJob(lessonId, 'pptx-generate-content');
        if (activeJob) {
            this.logger.log(`[generateAllContent] Active job ${activeJob.id} already exists for lesson ${lessonId}. Re-attaching.`);
            return { jobId: activeJob.id, status: 'processing' };
        }

        const job = await this.jobService.createJob({
            type: 'pptx-generate-content',
            lessonId,
            userId,
        });

        setImmediate(async () => {
            try {
                const slides = await this.slidesService.getSlides(lessonId);
                if (slides.length === 0) {
                    throw new Error('Không tìm thấy thông tin slide. Vui lòng khởi tạo trước.');
                }

                // Determine which slides need processing
                const slidesToProcess = slides.filter((s: any) => {
                    const hasImage = !!s.imageUrl;
                    const hasOptContent = !!s.optimizedContentJson;
                    const isTitleSlide = !s.content || s.content.trim() === '';
                    return !(hasImage && (hasOptContent || isTitleSlide));
                });

                const total = slidesToProcess.length;

                if (total === 0) {
                    await this.jobService.updateProgress(job.id, 100, 'Không có slide nào cần tối ưu nội dung.');
                    await this.jobService.completeJob(job.id);
                    return;
                }

                await this.jobService.updateProgress(job.id, 0, `Bắt đầu tối ưu nội dung cho ${total} slide...`);

                for (let i = 0; i < total; i++) {
                    // Stop early if the user requested cancellation.
                    const current = await this.jobService.getJobStatus(job.id);
                    if (current.status === 'cancelled') {
                        this.logger.log(`[generateAllContent] Job ${job.id} cancelled at slide ${i}/${total}. Stopping.`);
                        return;
                    }

                    const slide = slidesToProcess[i];
                    const progressMsg = total < slides.length
                        ? `Đang tạo nội dung & ảnh cho slide ${slide.slideIndex}/${slides.length} (${i + 1}/${total} cần tạo)...`
                        : `Đang tạo nội dung & ảnh cho slide ${slide.slideIndex}/${slides.length}...`;
                    await this.jobService.updateProgress(
                        job.id,
                        Math.round((i / total) * 100),
                        progressMsg
                    );

                    try {
                        await this.slidesService.generateContentAndImage(
                            lessonId,
                            slide.slideIndex,
                            userId,
                        );
                    } catch (error) {
                        this.logger.error(`Failed to generate content/image for slide ${slide.slideIndex}:`, error);
                    }
                }

                await this.jobService.completeJob(job.id);
            } catch (error) {
                this.logger.error(`[generateAllContent] Job ${job.id} failed:`, error);
                await this.jobService.failJob(job.id, error?.message || 'Unknown error');
            }
        });

        return { jobId: job.id, status: 'pending' };
    }
}
