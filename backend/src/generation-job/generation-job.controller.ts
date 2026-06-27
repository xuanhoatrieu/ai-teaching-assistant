import { Controller, Get, Post, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GenerationJobService } from './generation-job.service';

@Controller('generation-jobs')
@UseGuards(JwtAuthGuard)
export class GenerationJobController {
    constructor(private jobService: GenerationJobService) {}

    /**
     * Get the current active job for a lesson and type.
     */
    @Get('active')
    async getActiveJob(
        @Query('lessonId') lessonId: string,
        @Query('type') type: string,
    ) {
        return this.jobService.getActiveJob(lessonId, type);
    }

    /**
     * Poll job status — frontend calls this every 3s.
     */
    @Get(':id/status')
    async getJobStatus(@Param('id') id: string) {
        return this.jobService.getJobStatus(id);
    }

    /**
     * Request cancellation of a running job. The background worker checks
     * status between steps and stops when it sees 'cancelled'.
     */
    @Post(':id/cancel')
    async cancelJob(@Param('id') id: string) {
        return this.jobService.cancelJob(id);
    }
}
