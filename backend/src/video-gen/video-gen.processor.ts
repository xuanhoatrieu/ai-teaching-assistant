import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
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
   * then subscribes to progress/script-ready/done updates.
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

      // Subscribe to all channels for this job
      const subscriber = this.redis.duplicate();
      const progressChannel = `video-gen:progress:${jobId}`;
      const scriptReadyChannel = `video-gen:script-ready:${jobId}`;
      const doneChannel = `video-gen:done:${jobId}`;

      await subscriber.subscribe(progressChannel, scriptReadyChannel, doneChannel);

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          subscriber.unsubscribe();
          subscriber.quit();
          reject(new Error('Video generation timeout (120 minutes)'));
        }, 120 * 60 * 1000); // 120 min timeout

        subscriber.on('message', async (channel: string, message: string) => {
          try {
            const data = JSON.parse(message);

            if (channel === scriptReadyChannel) {
              // Worker generated video script — save to DB + create scene records
              const scenes = data.scenes || [];
              if (scenes.length > 0) {
                await this.videoGenService.onScriptReady(jobId, scenes);
                this.logger.log(`Script ready: ${scenes.length} scenes for job ${jobId}`);

                // If script-only mode, we're done after script generation
                if (job.data.mode === 'script-only') {
                  clearTimeout(timeout);
                  try {
                    await subscriber.unsubscribe();
                    subscriber.disconnect();
                  } catch { /* ignore cleanup errors */ }
                  resolve();
                  return;
                }
              }
            }

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
              try {
                await subscriber.unsubscribe();
                subscriber.disconnect();
              } catch { /* ignore cleanup errors */ }

              if (data.status === 'done') {
                if (job.data.mode === 'script-only') {
                  this.logger.log(`Job ${jobId} script-only completed successfully`);
                  resolve();
                  return;
                }
                if (job.data.mode === 'audio-only') {
                  // Audio-only: update scene audioUrls + reset video status
                  this.logger.log(`Job ${jobId} audio-only completed successfully`);
                  await this.videoGenService.onAudioReady(jobId, data.videoScript || []);
                  resolve();
                  return;
                }
                if (job.data.mode === 'render-scene') {
                  // Single scene render: update scene clipUrl + duration
                  this.logger.log(`Job ${jobId} render-scene completed: scene ${data.sceneIndex}`);
                  const sceneUpdates = data.sceneUpdates || [];
                  for (const update of sceneUpdates) {
                    if (update.clipUrl) {
                      await this.videoGenService.onSceneRenderDone(
                        jobId, update.sceneIndex, update.clipUrl, update.duration || 0, update.manimCode,
                      );
                    }
                  }
                  resolve();
                  return;
                }
                if (job.data.mode === 'regenerate-code') {
                  // Code regeneration: update scene manimCode
                  this.logger.log(`Job ${jobId} regenerate-code completed: scene ${data.sceneIndex}`);
                  const sceneUpdates = data.sceneUpdates || [];
                  for (const update of sceneUpdates) {
                    if (update.manimCode) {
                      await this.videoGenService.onSceneCodeRegenerated(
                        jobId, update.sceneIndex, update.manimCode,
                      );
                    }
                  }
                  resolve();
                  return;
                }
                // compose-only and full render: persist final output
                // Persist final output URLs + metadata into DB
                await this.videoGenService.completeJob(jobId, {
                  videoUrl: data.videoUrl,
                  subtitleUrl: data.subtitleUrl,
                  thumbnailUrl: data.thumbnailUrl,
                  duration: data.duration,
                  fileSize: data.fileSize,
                  totalScenes: data.totalScenes,
                  doneScenes: data.doneScenes,
                });
                this.logger.log(`Job ${jobId} completed successfully`);
                resolve();
              } else {
                const errorMsg = data.error || 'Unknown error';
                this.logger.error(`Job ${jobId} failed: ${errorMsg}`);
                await this.videoGenService.failJob(jobId, errorMsg);
                reject(new Error(errorMsg));
              }
            }
          } catch (e) {
            this.logger.error(`Error processing message: ${e}`);
          }
        });
      });
    } catch (error) {
      this.logger.error(`Job ${jobId} error: ${error.message}`);
      await this.videoGenService.failJob(jobId, error.message);
      throw error;
    }
  }
}
