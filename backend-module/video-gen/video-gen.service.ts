import {
  Injectable,
  Logger,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVideoDto } from './dto/create-video.dto';

@Injectable()
export class VideoGenService {
  private readonly logger = new Logger(VideoGenService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('video-gen') private readonly videoQueue: Queue,
  ) {}

  /**
   * Create a new video generation job.
   * Checks for duplicate in-progress jobs, fetches lesson data, dispatches to queue.
   */
  async createVideoJob(lessonId: string, userId: string, dto: CreateVideoDto) {
    // Check for existing in-progress job
    const existing = await this.prisma.videoGeneration.findFirst({
      where: {
        lessonId,
        status: { in: ['pending', 'script', 'rendering', 'composing'] },
      },
    });

    if (existing) {
      throw new ConflictException(
        'A video is already being generated for this lesson. Please wait for it to finish.',
      );
    }

    // Fetch lesson data for the worker
    const lesson = await this.prisma.lesson.findUniqueOrThrow({
      where: { id: lessonId },
      select: {
        id: true,
        title: true,
        detailedOutline: true,
        slideScript: true,
        subject: { select: { userId: true } },
      },
    });

    // Auth check: only lesson owner can generate video
    if (lesson.subject.userId !== userId) {
      throw new ForbiddenException('You do not own this lesson');
    }

    // Create DB record
    const videoGen = await this.prisma.videoGeneration.create({
      data: {
        lessonId,
        userId,
        format: dto.format || 'horizontal',
        resolution: dto.resolution || '1080p',
        style: dto.style || 'auto',
        narrationLang: dto.narrationLang || 'vi',
        subtitleLang: dto.subtitleLang || 'vi',
        narrationSpeed: dto.narrationSpeed || 1.0,
        status: 'pending',
      },
    });

    // Fetch user's API keys
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { apiKeys: true },
    });

    // Dispatch job to Redis queue
    const jobPayload = {
      jobId: videoGen.id,
      lessonId,
      userId,
      config: {
        format: dto.format || 'horizontal',
        resolution: dto.resolution || '1080p',
        style: dto.style || 'auto',
        narrationLang: dto.narrationLang || 'vi',
        subtitleLang: dto.subtitleLang || 'vi',
        narrationSpeed: dto.narrationSpeed || 1.0,
      },
      input: {
        detailedOutline: lesson.detailedOutline || '',
        slideScript: lesson.slideScript || '',
      },
      geminiApiKey: this.extractApiKey(user?.apiKeys, 'gemini'),
      vittsApiKey: process.env.VITTS_API_KEY || '',
    };

    await this.videoQueue.add('generate', jobPayload, {
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: false,
    });

    this.logger.log(`Video job created: ${videoGen.id} for lesson ${lessonId}`);

    return {
      id: videoGen.id,
      status: 'pending',
      message: 'Video generation started. Use GET /status to track progress.',
    };
  }

  async getLatestVideo(lessonId: string) {
    return this.prisma.videoGeneration.findFirst({
      where: { lessonId },
      orderBy: { createdAt: 'desc' },
      include: { scenes: { orderBy: { sceneIndex: 'asc' } } },
    });
  }

  async getStatus(lessonId: string) {
    const video = await this.prisma.videoGeneration.findFirst({
      where: { lessonId },
      orderBy: { createdAt: 'desc' },
      include: {
        scenes: {
          orderBy: { sceneIndex: 'asc' },
          select: {
            sceneIndex: true,
            title: true,
            approach: true,
            status: true,
            duration: true,
            errorMessage: true,
          },
        },
      },
    });
    return video;
  }

  async getScenes(lessonId: string) {
    const video = await this.prisma.videoGeneration.findFirst({
      where: { lessonId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!video) return [];
    return this.prisma.videoScene.findMany({
      where: { videoGenId: video.id },
      orderBy: { sceneIndex: 'asc' },
    });
  }

  async getDownloadUrl(lessonId: string): Promise<string | null> {
    const video = await this.prisma.videoGeneration.findFirst({
      where: { lessonId, status: 'done' },
      orderBy: { createdAt: 'desc' },
      select: { videoUrl: true },
    });
    return video?.videoUrl || null;
  }

  async getSubtitleUrl(lessonId: string): Promise<string | null> {
    const video = await this.prisma.videoGeneration.findFirst({
      where: { lessonId, status: 'done' },
      orderBy: { createdAt: 'desc' },
      select: { subtitleUrl: true },
    });
    return video?.subtitleUrl || null;
  }

  async deleteVideo(videoId: string, userId: string) {
    const video = await this.prisma.videoGeneration.findUniqueOrThrow({
      where: { id: videoId },
    });
    if (video.userId !== userId) {
      throw new ForbiddenException('You do not own this video');
    }
    // TODO: Delete from MinIO storage as well
    await this.prisma.videoGeneration.delete({ where: { id: videoId } });
    return { message: 'Video deleted' };
  }

  async getHistory(userId: string) {
    return this.prisma.videoGeneration.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        lessonId: true,
        format: true,
        resolution: true,
        narrationLang: true,
        status: true,
        duration: true,
        fileSize: true,
        videoUrl: true,
        createdAt: true,
        lesson: { select: { title: true } },
      },
    });
  }

  async retryScene(sceneId: string) {
    const scene = await this.prisma.videoScene.update({
      where: { id: sceneId },
      data: { status: 'pending', errorMessage: null, retryCount: { increment: 1 } },
    });
    // TODO: Re-dispatch scene render job
    return { message: 'Scene retry queued', sceneId };
  }

  /**
   * Update video generation progress from worker callback.
   */
  async updateProgress(
    jobId: string,
    status: string,
    progress: number,
    currentStep: string,
    sceneUpdates: any[] = [],
  ) {
    await this.prisma.videoGeneration.update({
      where: { id: jobId },
      data: {
        status,
        progress,
        currentStep,
        doneScenes: { increment: sceneUpdates.filter((s) => s.status === 'done').length },
      },
    });

    // Update individual scenes
    for (const update of sceneUpdates) {
      if (update.sceneIndex !== undefined) {
        await this.prisma.videoScene.updateMany({
          where: { videoGenId: jobId, sceneIndex: update.sceneIndex },
          data: {
            status: update.status,
            duration: update.duration,
            errorMessage: update.error,
          },
        });
      }
    }
  }

  private extractApiKey(apiKeys: any, provider: string): string {
    if (!apiKeys || !Array.isArray(apiKeys)) return '';
    const found = apiKeys.find((k: any) => k.provider === provider);
    return found?.key || '';
  }
}
