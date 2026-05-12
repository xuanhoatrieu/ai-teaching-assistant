import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { Redis } from 'ioredis';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { VideoGenService } from './video-gen.service';

@Processor('video-gen')
export class VideoGenProcessor {
  private readonly logger = new Logger(VideoGenProcessor.name);

  constructor(
    private readonly videoGenService: VideoGenService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  /**
   * Process video generation job.
   * Pushes job to Redis list (Python worker reads from there),
   * then subscribes to progress updates.
   */
  @Process('generate')
  async handleGenerate(job: Job) {
    const { jobId } = job.data;
    this.logger.log(`Processing video job: ${jobId}`);

    try {
      // Push job data to Redis list for Python worker
      await this.redis.rpush(
        'video-gen:jobs',
        JSON.stringify(job.data),
      );

      this.logger.log(`Job ${jobId} dispatched to Python worker queue`);

      // Subscribe to progress updates
      const subscriber = this.redis.duplicate();
      const progressChannel = `video-gen:progress:${jobId}`;
      const doneChannel = `video-gen:done:${jobId}`;

      await subscriber.subscribe(progressChannel, doneChannel);

      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          subscriber.unsubscribe();
          subscriber.quit();
          reject(new Error('Video generation timeout (30 minutes)'));
        }, 30 * 60 * 1000); // 30 min timeout

        subscriber.on('message', async (channel: string, message: string) => {
          try {
            const data = JSON.parse(message);

            if (channel === progressChannel) {
              // Update DB with progress
              await this.videoGenService.updateProgress(
                jobId,
                data.status,
                data.progress,
                data.currentStep,
                data.sceneUpdates || [],
              );
            }

            if (channel === doneChannel) {
              clearTimeout(timeout);
              subscriber.unsubscribe();
              subscriber.quit();

              if (data.status === 'done') {
                // Update final result in DB
                await this.videoGenService.updateProgress(
                  jobId, 'done', 100, 'Video hoàn thành!', [],
                );
                this.logger.log(`Job ${jobId} completed successfully`);
                resolve();
              } else {
                this.logger.error(`Job ${jobId} failed: ${data.error}`);
                await this.videoGenService.updateProgress(
                  jobId, 'error', 0, data.error || 'Unknown error', [],
                );
                reject(new Error(data.error));
              }
            }
          } catch (e) {
            this.logger.error(`Error processing message: ${e}`);
          }
        });
      });
    } catch (error) {
      this.logger.error(`Job ${jobId} error: ${error.message}`);
      await this.videoGenService.updateProgress(
        jobId, 'error', 0, error.message, [],
      );
      throw error;
    }
  }
}
