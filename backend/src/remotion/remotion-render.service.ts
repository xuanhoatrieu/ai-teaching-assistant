import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { PrismaService } from '../prisma/prisma.service';
import { FileStorageService } from '../file-storage/file-storage.service';

@Injectable()
export class RemotionRenderService {
  private readonly logger = new Logger(RemotionRenderService.name);
  private bundleLocationCache: string | null = null;
  private isBundling = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileStorageService: FileStorageService,
  ) {}

  /**
   * Get or create bundled Remotion Webpack bundle
   */
  private async getBundle(): Promise<string> {
    if (this.bundleLocationCache && fs.existsSync(this.bundleLocationCache)) {
      return this.bundleLocationCache;
    }

    if (this.isBundling) {
      // Wait for existing bundle job
      while (this.isBundling) {
        await new Promise((r) => setTimeout(r, 500));
      }
      if (this.bundleLocationCache) return this.bundleLocationCache;
    }

    this.isBundling = true;
    try {
      const { bundle } = await import('@remotion/bundler');
      const entryPoint = path.resolve(__dirname, 'bundle-root', 'index.ts');

      this.logger.log(`Bundling Remotion project from ${entryPoint}...`);
      const bundleLocation = await bundle({
        entryPoint,
        webpackOverride: (config) => {
          return {
            ...config,
            resolve: {
              ...config.resolve,
              extensions: ['.ts', '.tsx', '.js', '.jsx', '.json', '.css'],
            },
          };
        },
      });

      this.bundleLocationCache = bundleLocation;
      this.logger.log(`Remotion bundle created at ${bundleLocation}`);
      return bundleLocation;
    } finally {
      this.isBundling = false;
    }
  }

  /**
   * Render video to MP4 and upload to MinIO
   */
  async renderVideo(videoId: string, userId: string) {
    const video = await this.prisma.remotionVideo.findUnique({
      where: { id: videoId },
      include: {
        subject: { select: { name: true } },
      },
    });

    if (!video) {
      throw new NotFoundException('Video not found');
    }

    // Update status to rendering
    await this.prisma.remotionVideo.update({
      where: { id: videoId },
      data: { status: 'rendering', progress: 5, errorMessage: null },
    });

    // Run async render without blocking response
    this.executeRender(video).catch(async (err) => {
      this.logger.error(`Render failed for video ${videoId}: ${err.message}`, err.stack);
      await this.prisma.remotionVideo.update({
        where: { id: videoId },
        data: { status: 'failed', errorMessage: err.message },
      });
    });

    return { success: true, message: 'Rendering started', videoId };
  }

  private async executeRender(video: any) {
    const { renderMedia, selectComposition } = await import('@remotion/renderer');

    const bundleLocation = await this.getBundle();

    const isVertical = video.aspectRatio === '9:16';
    const compositionId = isVertical ? 'AcademicShorts' : 'AcademicLecture';

    const scenes = (video.scenesJson as any[]) || [];
    const totalDurationFrames = Math.max(
      60,
      scenes.reduce((sum, s) => sum + (s.durationInFrames || 150), 0)
    );

    const inputProps = {
      title: video.title,
      brandName: video.subject?.name || 'AI TEACHING ASSISTANT',
      subjectName: video.subject?.name,
      templateType: video.templateType,
      aspectRatio: video.aspectRatio,
      fps: video.fps || 30,
      totalFrames: totalDurationFrames,
      scenes,
    };

    this.logger.log(`Selecting composition ${compositionId}...`);
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: compositionId,
      inputProps,
    });

    // Override composition duration with dynamic total frames
    const dynamicComposition = {
      ...composition,
      durationInFrames: totalDurationFrames,
    };

    const tempOutputDir = path.join(os.tmpdir(), 'remotion-renders');
    if (!fs.existsSync(tempOutputDir)) {
      fs.mkdirSync(tempOutputDir, { recursive: true });
    }

    const outputFileName = `video_${video.id}_${Date.now()}.mp4`;
    const outputPath = path.join(tempOutputDir, outputFileName);

    this.logger.log(`Rendering ${dynamicComposition.durationInFrames} frames to ${outputPath}...`);

    let lastReportedProgress = 0;

    await renderMedia({
      composition: dynamicComposition,
      serveUrl: bundleLocation,
      codec: 'h264',
      outputLocation: outputPath,
      inputProps,
      onProgress: async ({ progress }) => {
        const percent = Math.round(progress * 100);
        if (percent >= lastReportedProgress + 10) {
          lastReportedProgress = percent;
          this.logger.log(`Video ${video.id} render progress: ${percent}%`);
          await this.prisma.remotionVideo.update({
            where: { id: video.id },
            data: { progress: Math.min(95, percent) },
          });
        }
      },
    });

    this.logger.log(`Video rendered successfully. Reading file stats...`);
    const fileStats = fs.statSync(outputPath);
    const fileBuffer = fs.readFileSync(outputPath);

    // Upload to MinIO
    this.logger.log(`Uploading to MinIO: ${outputFileName} (${fileStats.size} bytes)...`);
    const uploadResult = await this.fileStorageService.uploadBuffer(
      fileBuffer,
      outputFileName,
      'video/mp4'
    );

    const videoUrl = typeof uploadResult === 'string' ? uploadResult : (uploadResult as any).url;
    const durationSeconds = totalDurationFrames / (video.fps || 30);

    // Update video record in DB
    await this.prisma.remotionVideo.update({
      where: { id: video.id },
      data: {
        status: 'completed',
        progress: 100,
        videoUrl,
        fileSize: fileStats.size,
        durationSeconds,
      },
    });

    this.logger.log(`Video ${video.id} finished and saved! URL: ${videoUrl}`);

    // Cleanup temp file
    try {
      fs.unlinkSync(outputPath);
    } catch {
      /* ignore */
    }
  }
}
