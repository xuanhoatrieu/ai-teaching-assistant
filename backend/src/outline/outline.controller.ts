import {
    Controller,
    Get,
    Put,
    Post,
    Body,
    Param,
    UseGuards,
    Request,
    Logger,
} from '@nestjs/common';
import { OutlineService } from './outline.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GenerationJobService } from '../generation-job/generation-job.service';
import { IsString, IsNotEmpty } from 'class-validator';

// DTOs
class SaveRawOutlineDto {
    @IsString()
    @IsNotEmpty()
    rawOutline: string;
}

class UpdateDetailedOutlineDto {
    @IsString()
    @IsNotEmpty()
    detailedOutline: string;
}

@Controller('lessons/:lessonId/outline')
@UseGuards(JwtAuthGuard)
export class OutlineController {
    private readonly logger = new Logger(OutlineController.name);

    constructor(
        private outlineService: OutlineService,
        private jobService: GenerationJobService,
    ) { }

    // GET /lessons/:id/outline - Get all outline data
    @Get()
    async getOutlineData(@Param('lessonId') lessonId: string) {
        return this.outlineService.getOutlineData(lessonId);
    }

    // PUT /lessons/:id/outline/raw - Save raw outline (Step 1)
    @Put('raw')
    async saveRawOutline(
        @Param('lessonId') lessonId: string,
        @Body() dto: SaveRawOutlineDto,
    ) {
        return this.outlineService.saveRawOutline(lessonId, dto.rawOutline);
    }

    // POST /lessons/:id/outline/generate - Generate detailed outline with AI (Step 2)
    // Returns jobId immediately, processes in background (async job polling).
    @Post('generate')
    async generateDetailedOutline(
        @Param('lessonId') lessonId: string,
        @Request() req,
    ) {
        const userId = req.user.id;

        // Create job record in DB
        const job = await this.jobService.createJob({
            type: 'outline-generate',
            lessonId,
            userId,
            total: 1,
        });

        // Kick off background processing
        setImmediate(async () => {
            try {
                await this.jobService.updateProgress(job.id, 0, 'Đang chuẩn bị tạo outline chi tiết...');

                await this.jobService.updateProgress(job.id, 20, 'Đang gọi AI tạo outline...');

                const result = await this.outlineService.generateDetailedOutline(
                    lessonId,
                    userId,
                );

                await this.jobService.completeJob(job.id, {
                    coveragePercent: result.coveragePercent,
                    warnings: result.warnings,
                });
            } catch (error) {
                this.logger.error(`[generateDetailedOutline] Job ${job.id} failed:`, error);
                await this.jobService.failJob(job.id, error?.message || 'Unknown error');
            }
        });

        return { jobId: job.id, status: 'pending' };
    }

    // PUT /lessons/:id/outline/detailed - Update detailed outline after user edit
    @Put('detailed')
    async updateDetailedOutline(
        @Param('lessonId') lessonId: string,
        @Body() dto: UpdateDetailedOutlineDto,
    ) {
        return this.outlineService.updateDetailedOutline(lessonId, dto.detailedOutline);
    }
}
