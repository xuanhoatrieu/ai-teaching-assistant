import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface JobStatus {
    id: string;
    type: string;
    status: string;
    progress: number;
    total: number;
    message: string | null;
    error: string | null;
    createdAt: Date;
}

@Injectable()
export class GenerationJobService {
    private readonly logger = new Logger(GenerationJobService.name);

    constructor(private prisma: PrismaService) {}

    /**
     * Create a new generation job record in DB.
     * Returns the job immediately — caller kicks off background work separately.
     */
    async createJob(params: {
        type: string;
        lessonId: string;
        userId: string;
        total?: number;
        payload?: any;
    }) {
        const job = await this.prisma.generationJob.create({
            data: {
                type: params.type,
                lessonId: params.lessonId,
                userId: params.userId,
                total: params.total || 0,
                payload: params.payload || undefined,
                status: 'pending',
            },
        });

        this.logger.log(`[createJob] Created job ${job.id} (type=${params.type}, lesson=${params.lessonId})`);
        return job;
    }

    /**
     * Get job status (for polling endpoint).
     */
    async getJobStatus(jobId: string): Promise<JobStatus> {
        const job = await this.prisma.generationJob.findUnique({
            where: { id: jobId },
        });

        if (!job) {
            throw new NotFoundException(`Job ${jobId} not found`);
        }

        return {
            id: job.id,
            type: job.type,
            status: job.status,
            progress: job.progress,
            total: job.total,
            message: job.message,
            error: job.error,
            createdAt: job.createdAt,
        };
    }

    /**
     * Update job progress (called from background worker).
     */
    async updateProgress(jobId: string, progress: number, message?: string) {
        await this.prisma.generationJob.update({
            where: { id: jobId },
            data: {
                status: 'processing',
                progress,
                message: message || undefined,
            },
        });
    }

    /**
     * Mark job as completed.
     */
    async completeJob(jobId: string, result?: any) {
        await this.prisma.generationJob.update({
            where: { id: jobId },
            data: {
                status: 'done',
                progress: 100,
                message: null,
                result: result || undefined,
            },
        });
        this.logger.log(`[completeJob] Job ${jobId} completed`);
    }

    /**
     * Mark job as failed.
     */
    async failJob(jobId: string, error: string) {
        await this.prisma.generationJob.update({
            where: { id: jobId },
            data: {
                status: 'error',
                error,
                message: null,
            },
        });
        this.logger.error(`[failJob] Job ${jobId} failed: ${error}`);
    }

    /**
     * Cancel a job — only if it's still pending/processing.
     * The background worker checks status between steps and stops on 'cancelled'.
     */
    async cancelJob(jobId: string) {
        const result = await this.prisma.generationJob.updateMany({
            where: {
                id: jobId,
                status: { in: ['pending', 'processing'] },
            },
            data: {
                status: 'cancelled',
                message: 'Đã dừng theo yêu cầu',
            },
        });
        this.logger.log(`[cancelJob] Job ${jobId} cancel requested (updated ${result.count})`);
        return { cancelled: result.count > 0 };
    }

    /**
     * Clean up old completed/failed jobs (optional, for housekeeping).
     */
    async cleanOldJobs(olderThanHours = 24) {
        const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
        const result = await this.prisma.generationJob.deleteMany({
            where: {
                status: { in: ['done', 'error', 'cancelled'] },
                createdAt: { lt: cutoff },
            },
        });
        if (result.count > 0) {
            this.logger.log(`[cleanOldJobs] Cleaned ${result.count} old jobs`);
        }
    }

    /**
     * Find active job for lesson and type.
     */
    async getActiveJob(lessonId: string, type: string) {
        return this.prisma.generationJob.findFirst({
            where: {
                lessonId,
                type,
                status: { in: ['pending', 'processing'] },
            },
            orderBy: { createdAt: 'desc' },
        });
    }
}
