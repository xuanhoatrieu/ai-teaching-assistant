import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GenerationJobService } from './generation-job.service';

@Controller('generation-jobs')
@UseGuards(JwtAuthGuard)
export class GenerationJobController {
    constructor(private jobService: GenerationJobService) {}

    /**
     * Poll job status — frontend calls this every 3s.
     */
    @Get(':id/status')
    async getJobStatus(@Param('id') id: string) {
        return this.jobService.getJobStatus(id);
    }
}
