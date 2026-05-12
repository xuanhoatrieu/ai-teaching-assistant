import {
  Injectable,
  Logger,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../settings/system-config.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { CreateVideoDto, UpdateVideoDto, SaveScriptDto } from './dto/create-video.dto';
import { ModelConfigService } from '../model-config/model-config.service';
import { TTSService } from '../tts/tts.service';
import { FileStorageService } from '../file-storage/file-storage.service';

@Injectable()
export class VideoGenService {
  private readonly logger = new Logger(VideoGenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly systemConfig: SystemConfigService,
    private readonly apiKeysService: ApiKeysService,
    private readonly modelConfigService: ModelConfigService,
    private readonly ttsService: TTSService,
    private readonly fileStorageService: FileStorageService,
    @InjectQueue('video-gen') private readonly videoQueue: Queue,
  ) {}

  // ─────────────────────────────────────────────────────
  // CRUD — Subject-scoped video management
  // ─────────────────────────────────────────────────────

  /**
   * Create a new video (draft) in a subject.
   */
  async createVideo(subjectId: string, userId: string, dto: CreateVideoDto) {
    // Verify subject ownership
    await this.verifySubjectOwnership(subjectId, userId);

    // Resolve lesson if inputType is 'lesson'
    let lessonId: string | null = null;
    let inputText = dto.inputText || null;

    if (dto.inputType === 'lesson' && dto.lessonId) {
      const lesson = await this.prisma.lesson.findFirst({
        where: { id: dto.lessonId, subjectId },
        select: { id: true, title: true, detailedOutline: true, slideScript: true },
      });
      if (!lesson) throw new NotFoundException('Lesson not found in this subject');
      lessonId = lesson.id;
      // Auto-fill input text from lesson content
      inputText = [lesson.detailedOutline, lesson.slideScript]
        .filter(Boolean)
        .join('\n\n---\n\n');
    }

    const video = await this.prisma.videoGeneration.create({
      data: {
        subjectId,
        userId,
        lessonId,
        title: dto.title || 'Video mới',
        inputType: dto.inputType || 'manual',
        inputText,
        inputFilesJson: dto.inputFiles ? (dto.inputFiles as any) : undefined,
        format: dto.format || 'horizontal',
        resolution: dto.resolution || '1080p',
        style: dto.style || 'auto',
        narrationLang: dto.narrationLang || 'vi',
        subtitleLang: dto.subtitleLang || 'vi',
        narrationSpeed: dto.narrationSpeed || 1.0,
        status: 'draft',
        wizardStep: 1,
      },
    });

    this.logger.log(`Video draft created: ${video.id} in subject ${subjectId}`);
    return video;
  }

  /**
   * List all videos in a subject.
   */
  async listVideos(subjectId: string, userId: string) {
    await this.verifySubjectOwnership(subjectId, userId);

    return this.prisma.videoGeneration.findMany({
      where: { subjectId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        inputType: true,
        format: true,
        resolution: true,
        status: true,
        wizardStep: true,
        progress: true,
        totalScenes: true,
        doneScenes: true,
        duration: true,
        fileSize: true,
        videoUrl: true,
        thumbnailUrl: true,
        createdAt: true,
        updatedAt: true,
        lesson: { select: { id: true, title: true } },
      },
    });
  }

  /**
   * Get a single video with scenes.
   * Includes self-healing for scenes stuck in 'rendering' (e.g., after backend hot-reload).
   */
  async getVideo(subjectId: string, videoId: string, userId: string) {
    const video = await this.prisma.videoGeneration.findFirst({
      where: { id: videoId, subjectId },
      include: {
        scenes: { orderBy: { sceneIndex: 'asc' } },
        lesson: { select: { id: true, title: true } },
      },
    });
    if (!video) throw new NotFoundException('Video not found');
    if (video.userId !== userId) throw new ForbiddenException('Not your video');

    // Self-heal: fix scenes stuck in 'rendering' for too long (5 min)
    const STUCK_THRESHOLD_MS = 5 * 60 * 1000;
    const now = Date.now();
    for (const scene of video.scenes) {
      if (scene.status === 'rendering') {
        const sceneAge = now - new Date(scene.createdAt).getTime();
        // Only auto-heal if scene has been rendering for more than threshold
        // Use updatedAt if available, otherwise createdAt as proxy
        if (sceneAge > STUCK_THRESHOLD_MS) {
          // Check if manimCode was already saved (worker finished but processor missed done)
          if (scene.manimCode && !scene.clipUrl) {
            // Code was saved but status wasn't updated — regenerate-code completed
            this.logger.warn(`Self-heal: Scene ${scene.sceneIndex} stuck in rendering with code — resetting to pending`);
            await this.prisma.videoScene.update({
              where: { id: scene.id },
              data: { status: 'pending' },
            });
            scene.status = 'pending';
          } else if (scene.clipUrl) {
            // Clip was saved but status wasn't updated — render completed
            this.logger.warn(`Self-heal: Scene ${scene.sceneIndex} stuck in rendering with clip — resetting to done`);
            await this.prisma.videoScene.update({
              where: { id: scene.id },
              data: { status: 'done' },
            });
            scene.status = 'done';
          }
        }
      }
    }

    return video;
  }

  /**
   * Update video config / input (only if draft or script stage).
   */
  async updateVideo(subjectId: string, videoId: string, userId: string, dto: UpdateVideoDto) {
    const video = await this.getVideoOrFail(videoId, subjectId, userId);

    // Only allow updates if not rendering/done
    if (['rendering', 'composing', 'uploading'].includes(video.status)) {
      throw new ConflictException('Cannot update video while rendering');
    }

    const updateData: any = {};

    if (dto.title !== undefined) updateData.title = dto.title;
    if (dto.format !== undefined) updateData.format = dto.format;
    if (dto.resolution !== undefined) updateData.resolution = dto.resolution;
    if (dto.narrationLang !== undefined) updateData.narrationLang = dto.narrationLang;
    if (dto.subtitleLang !== undefined) updateData.subtitleLang = dto.subtitleLang;
    if (dto.narrationSpeed !== undefined) updateData.narrationSpeed = dto.narrationSpeed;
    if (dto.style !== undefined) updateData.style = dto.style;
    if (dto.wizardStep !== undefined) updateData.wizardStep = dto.wizardStep;

    // Update input source
    if (dto.inputType !== undefined) {
      updateData.inputType = dto.inputType;
      if (dto.inputType === 'lesson' && dto.lessonId) {
        const lesson = await this.prisma.lesson.findFirst({
          where: { id: dto.lessonId, subjectId },
          select: { id: true, detailedOutline: true, slideScript: true },
        });
        if (lesson) {
          updateData.lessonId = lesson.id;
          updateData.inputText = [lesson.detailedOutline, lesson.slideScript]
            .filter(Boolean)
            .join('\n\n---\n\n');
        }
      } else if (dto.inputType === 'manual') {
        updateData.inputText = dto.inputText || video.inputText;
        updateData.lessonId = null;
      }
    } else if (dto.inputText !== undefined) {
      updateData.inputText = dto.inputText;
    }

    if (dto.inputFiles !== undefined) {
      updateData.inputFilesJson = dto.inputFiles as any;
    }

    await this.prisma.videoGeneration.update({
      where: { id: videoId },
      data: updateData,
    });

    // Return full video with scenes (needed for step navigation)
    return this.prisma.videoGeneration.findUnique({
      where: { id: videoId },
      include: {
        scenes: { orderBy: { sceneIndex: 'asc' } },
        lesson: { select: { id: true, title: true } },
      },
    });
  }

  /**
   * Delete a video.
   */
  async deleteVideo(subjectId: string, videoId: string, userId: string) {
    await this.getVideoOrFail(videoId, subjectId, userId);
    await this.prisma.videoGeneration.delete({ where: { id: videoId } });
    return { message: 'Video deleted' };
  }

  // ─────────────────────────────────────────────────────
  // SCRIPT — Generate, save, edit
  // ─────────────────────────────────────────────────────

  /**
   * Generate script via AI (Step 2).
   * Dispatches to worker for script-only generation, returns immediately.
   */
  async generateScript(subjectId: string, videoId: string, userId: string) {
    const video = await this.getVideoOrFail(videoId, subjectId, userId);

    if (!video.inputText && !video.lessonId) {
      throw new BadRequestException('No input content. Please provide text or select a lesson first.');
    }

    // Mark as generating
    await this.prisma.videoGeneration.update({
      where: { id: videoId },
      data: { scriptStatus: 'generating', wizardStep: 2 },
    });

    // Dispatch script generation to worker queue
    const jobPayload = await this.buildJobPayload(video, userId);
    jobPayload.mode = 'script-only'; // Tell worker to only generate script, not render

    await this.videoQueue.add('generate', jobPayload, {
      attempts: 1,
      removeOnComplete: true,
    });

    this.logger.log(`Script generation dispatched for video ${videoId}`);
    return { message: 'Script generation started', videoId };
  }

  /**
   * Save user-edited script (Step 2).
   */
  async saveScript(subjectId: string, videoId: string, userId: string, dto: SaveScriptDto) {
    await this.getVideoOrFail(videoId, subjectId, userId);

    await this.prisma.videoGeneration.update({
      where: { id: videoId },
      data: {
        editedScript: dto.scenes as any,
        scriptStatus: 'edited',
        wizardStep: 3,
      },
    });

    // Also create/update VideoScene records from the edited script
    await this.createScenesFromScript(videoId, dto.scenes);

    return { message: 'Script saved', sceneCount: dto.scenes.length };
  }

  // ─────────────────────────────────────────────────────
  // RENDER — Start full render pipeline (Step 4)
  // ─────────────────────────────────────────────────────

  /**
   * Start the full render pipeline.
   * Uses editedScript (if available) or videoScript.
   */
  async startRender(subjectId: string, videoId: string, userId: string) {
    const video = await this.getVideoOrFail(videoId, subjectId, userId);

    // Must have a script before rendering
    if (!video.editedScript && !video.videoScript) {
      throw new BadRequestException('No script available. Generate or edit a script first.');
    }

    // Check for existing in-progress render
    if (['pending', 'rendering', 'composing', 'uploading'].includes(video.status)) {
      throw new ConflictException('Video is already rendering');
    }

    // Mark as pending
    await this.prisma.videoGeneration.update({
      where: { id: videoId },
      data: {
        status: 'pending',
        progress: 0,
        renderStep: null,
        errorMessage: null,
        wizardStep: 4,
      },
    });

    // Build and dispatch full render job
    const jobPayload = await this.buildJobPayload(video, userId);
    jobPayload.mode = 'render'; // Full render
    // Include the script (edited takes priority)
    jobPayload.script = video.editedScript || video.videoScript;

    await this.videoQueue.add('generate', jobPayload, {
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: false,
    });

    this.logger.log(`Render started for video ${videoId}`);
    return { message: 'Render started', videoId };
  }

  /**
   * Generate audio for a single scene using TTS and save to user-centric storage.
   */
  async generateAudioForScene(subjectId: string, videoId: string, sceneIndex: number, userId: string, opts?: { multilingualMode?: string; vittsMode?: string; vittsDesignInstruct?: string; vittsNormalize?: boolean }) {
    await this.verifySubjectOwnership(subjectId, userId);

    const video = await this.prisma.videoGeneration.findUnique({
      where: { id: videoId },
      include: { scenes: { where: { sceneIndex } } },
    });

    if (!video) throw new NotFoundException('Video not found');
    if (video.subjectId !== subjectId) throw new ForbiddenException();

    const scene = video.scenes[0];
    if (!scene) throw new NotFoundException(`Scene ${sceneIndex} not found`);

    if (!scene.narrationText) {
      throw new BadRequestException(`Scene ${sceneIndex} has no narration text`);
    }

    // Update scene status to TTS
    await this.prisma.videoScene.update({
      where: { id: scene.id },
      data: { status: 'tts' },
    });

    try {
      // Find user TTS preference
      let ttsVoice = '';
      let ttsProvider = 'GEMINI'; // default
      try {
        const ttsConfig = await this.modelConfigService.getModelForTask(userId, 'TTS' as any);
        if (ttsConfig && ttsConfig.modelName) {
          ttsVoice = ttsConfig.modelName;
          ttsProvider = ttsConfig.provider || 'GEMINI';
        }
      } catch (err) {
        this.logger.warn(`Failed to read user TTS config: ${err.message}`);
      }

      // Generate audio using TTS service
      const audioResult = await this.ttsService.generateAudio(userId, {
        text: scene.narrationText,
        voiceId: ttsVoice,
        provider: ttsProvider,
        multilingualMode: opts?.multilingualMode,
        vittsMode: opts?.vittsMode,
        vittsDesignInstruct: opts?.vittsDesignInstruct,
        vittsNormalize: opts?.vittsNormalize,
      });

      // Save audio file using FileStorageService
      const { publicUrl } = await this.fileStorageService.saveAudioFile(
        userId,
        videoId,
        video.title || 'video',
        sceneIndex,
        audioResult.audio,
      );

      // Update scene with audio URL and duration
      const updatedScene = await this.prisma.videoScene.update({
        where: { id: scene.id },
        data: {
          audioUrl: publicUrl,
          duration: audioResult.durationMs ? audioResult.durationMs / 1000 : null,
          status: 'pending',
        },
      });

      // Reset video status to draft
      await this.prisma.videoGeneration.update({
        where: { id: videoId },
        data: {
          status: 'draft',
          progress: 0,
          renderStep: 'Audio đã sẵn sàng',
        },
      });

      return {
        message: 'Audio generated successfully',
        audioUrl: updatedScene.audioUrl,
        duration: updatedScene.duration,
        status: updatedScene.status,
      };
    } catch (error) {
      this.logger.error(`Failed to generate audio for scene ${sceneIndex}:`, error);

      // Update scene status to error
      await this.prisma.videoScene.update({
        where: { id: scene.id },
        data: {
          status: 'error',
          errorMessage: error.message,
        },
      });

      throw new BadRequestException(`Failed to generate audio: ${error.message}`);
    }
  }

  /**
   * Stream scene audio from MinIO for playback preview.
   */
  async getSceneAudioStream(subjectId: string, videoId: string, userId: string, sceneIndex: number) {
    await this.verifySubjectOwnership(subjectId, userId);

    const scene = await this.prisma.videoScene.findFirst({
      where: { videoGenId: videoId, sceneIndex },
    });

    if (!scene || !scene.audioUrl) {
      throw new NotFoundException(`Audio not found for scene ${sceneIndex}`);
    }

    // Stream from MinIO
    const minio = await this.getMinioClient();
    const objectName = this.extractMinioObjectName(scene.audioUrl);
    const bucket = process.env.MINIO_BUCKET || 'ai-teaching';

    const stat = await minio.statObject(bucket, objectName);
    const stream = await minio.getObject(bucket, objectName);

    return {
      stream,
      contentType: 'audio/wav',
      size: stat.size,
    };
  }

  /**
   * Stream a scene's rendered clip from MinIO.
   */
  async getSceneClipStream(subjectId: string, videoId: string, userId: string, sceneIndex: number) {
    await this.verifySubjectOwnership(subjectId, userId);

    const scene = await this.prisma.videoScene.findFirst({
      where: { videoGenId: videoId, sceneIndex },
    });

    if (!scene || !scene.clipUrl) {
      throw new NotFoundException(`Clip not found for scene ${sceneIndex}`);
    }

    const minio = await this.getMinioClient();
    const objectName = this.extractMinioObjectName(scene.clipUrl);
    const bucket = process.env.MINIO_BUCKET || 'ai-teaching';

    const stat = await minio.statObject(bucket, objectName);
    const stream = await minio.getObject(bucket, objectName);

    return {
      stream,
      contentType: 'video/mp4',
      size: stat.size,
    };
  }

  private extractMinioObjectName(url: string): string {
    // URL format: http://host:port/bucket/path/to/file.wav or just path/to/file.wav
    if (url.startsWith('http')) {
      const urlObj = new URL(url);
      const parts = urlObj.pathname.split('/');
      // Remove bucket name from path
      return parts.slice(2).join('/');
    }
    return url;
  }

  private async getMinioClient() {
    const Minio = await import('minio');
    return new Minio.Client({
      endPoint: process.env.MINIO_ENDPOINT || 'localhost',
      port: parseInt(process.env.MINIO_PORT || '9000'),
      useSSL: process.env.MINIO_SECURE === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY || '',
      secretKey: process.env.MINIO_SECRET_KEY || '',
    });
  }

  // ─────────────────────────────────────────────────────
  // STATUS & PROGRESS — Called by Processor / Gateway
  // ─────────────────────────────────────────────────────

  /**
   * Get video status with scenes.
   */
  async getVideoStatus(videoId: string) {
    return this.prisma.videoGeneration.findUnique({
      where: { id: videoId },
      include: {
        scenes: {
          orderBy: { sceneIndex: 'asc' },
          select: {
            id: true,
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
  }

  /**
   * Update progress from worker.
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
        renderStep: currentStep,
        doneScenes: { increment: sceneUpdates.filter((s) => s.status === 'done').length },
      },
    });

    // Update individual scenes
    for (const update of sceneUpdates) {
      if (update.sceneIndex !== undefined) {
        const sceneData: any = {
          status: update.status,
          duration: update.duration,
          errorMessage: update.error,
        };
        // Persist manimCode if provided (from full render mode)
        if (update.manimCode) {
          sceneData.manimCode = update.manimCode;
        }
        // Persist clipUrl if provided
        if (update.clipUrl) {
          sceneData.clipUrl = update.clipUrl;
        }
        await this.prisma.videoScene.updateMany({
          where: { videoGenId: jobId, sceneIndex: update.sceneIndex },
          data: sceneData,
        });
      }
    }
  }

  /**
   * Create VideoScene records from script data.
   */
  async createScenesFromScript(
    jobId: string,
    scenes: Array<{
      index: number;
      title: string;
      approach: string;
      narration_vi?: string;
      narration_en?: string;
      visual_desc?: string;
      image_prompt?: string;
      image_url?: string;
      manim_code?: string;
      code_lines?: string[];
      duration_est?: number;
    }>,
  ) {
    // Delete existing scenes (for retry)
    await this.prisma.videoScene.deleteMany({ where: { videoGenId: jobId } });

    const data = scenes.map((s) => ({
      videoGenId: jobId,
      sceneIndex: s.index,
      title: s.title || `Scene ${s.index}`,
      approach: s.approach || 'static',
      narrationText: s.narration_vi || s.narration_en || '',
      subtitleText: s.narration_en || null,
      visualDesc: s.visual_desc || null,
      imagePrompt: s.image_prompt || null,
      imageUrl: s.image_url || null,
      manimCode: s.manim_code || null,
      codeLines: s.code_lines ? (s.code_lines as any) : undefined,
      status: 'pending',
    }));

    await this.prisma.videoScene.createMany({ data });

    await this.prisma.videoGeneration.update({
      where: { id: jobId },
      data: { totalScenes: scenes.length },
    });

    this.logger.log(`Created ${scenes.length} VideoScene records for job ${jobId}`);
  }

  /**
   * Handle script-ready from worker — save AI-generated script to DB.
   */
  async onScriptReady(jobId: string, scenes: any[]) {
    await this.prisma.videoGeneration.update({
      where: { id: jobId },
      data: {
        videoScript: scenes as any,
        scriptStatus: 'ready',
        totalScenes: scenes.length,
      },
    });

    await this.createScenesFromScript(jobId, scenes);
    this.logger.log(`Script ready for job ${jobId}: ${scenes.length} scenes`);
  }

  /**
   * Handle audio-ready from worker — save audioUrl for each scene.
   */
  async onAudioReady(jobId: string, scenes: any[]) {
    // Update each scene's audioUrl and duration
    for (const scene of scenes) {
      if (scene.audioUrl) {
        await this.prisma.videoScene.updateMany({
          where: {
            videoGenId: jobId,
            sceneIndex: scene.index,
          },
          data: {
            audioUrl: scene.audioUrl,
            duration: scene.duration || null,
            status: 'pending',
          },
        });
      }
    }

    // Reset video status to draft (audio done, ready for render)
    await this.prisma.videoGeneration.update({
      where: { id: jobId },
      data: {
        status: 'draft',
        progress: 0,
        renderStep: 'Audio đã sẵn sàng',
      },
    });

    this.logger.log(`Audio ready for job ${jobId}: ${scenes.length} scenes`);
  }

  /**
   * Mark job as completed.
   */
  async completeJob(
    jobId: string,
    result: {
      videoUrl?: string;
      subtitleUrl?: string;
      thumbnailUrl?: string;
      duration?: number;
      fileSize?: number;
      totalScenes?: number;
      doneScenes?: number;
    },
  ) {
    await this.prisma.videoGeneration.update({
      where: { id: jobId },
      data: {
        status: 'done',
        progress: 100,
        renderStep: 'Video hoàn thành!',
        wizardStep: 5,
        videoUrl: result.videoUrl || null,
        subtitleUrl: result.subtitleUrl || null,
        thumbnailUrl: result.thumbnailUrl || null,
        duration: result.duration || null,
        fileSize: result.fileSize || null,
        totalScenes: result.totalScenes || 0,
        doneScenes: result.doneScenes || 0,
      },
    });
    this.logger.log(`Job ${jobId} completed: video=${result.videoUrl}`);
  }

  /**
   * Mark job as failed.
   */
  async failJob(jobId: string, errorMessage: string) {
    await this.prisma.videoGeneration.update({
      where: { id: jobId },
      data: {
        status: 'error',
        progress: 0,
        renderStep: null,
        errorMessage,
      },
    });
    this.logger.error(`Job ${jobId} failed: ${errorMessage}`);
  }

  /**
   * Render a single scene for preview (Step 3).
   * Dispatches a render-scene job to the worker.
   */
  async renderScenePreview(subjectId: string, videoId: string, sceneIndex: number, userId: string) {
    const video = await this.getVideoOrFail(videoId, subjectId, userId);
    
    const scene = await this.prisma.videoScene.findFirst({
      where: { videoGenId: videoId, sceneIndex },
    });
    if (!scene) throw new NotFoundException(`Scene ${sceneIndex} not found`);

    // Update scene status
    await this.prisma.videoScene.update({
      where: { id: scene.id },
      data: { status: 'rendering', errorMessage: null, approved: false },
    });

    // Build job payload for single scene render
    const jobPayload = await this.buildJobPayload(video, userId);
    jobPayload.mode = 'render-scene';
    jobPayload.sceneIndex = sceneIndex;
    // Include the script (edited takes priority)
    jobPayload.script = video.editedScript || video.videoScript;

    // Inject user-edited manimCode from DB into the script
    // so the worker uses the edited code instead of regenerating
    if (scene.manimCode && Array.isArray(jobPayload.script)) {
      const scriptScene = (jobPayload.script as any[]).find((s: any) => s.index === sceneIndex)
        || (jobPayload.script as any[])[sceneIndex];
      if (scriptScene) {
        scriptScene.manim_code = scene.manimCode;
        this.logger.log(`Injected user-edited manimCode (${scene.manimCode.length} chars) for scene ${sceneIndex}`);
      }
    }

    await this.videoQueue.add('generate', jobPayload, {
      attempts: 1,
      removeOnComplete: true,
    });

    this.logger.log(`Scene ${sceneIndex} render dispatched for video ${videoId}`);
    return { message: 'Scene render started', sceneIndex };
  }

  /**
   * Regenerate Manim code for a scene using AI (Step 3).
   * Dispatches a regenerate-code job to the worker.
   */
  async regenerateSceneCode(subjectId: string, videoId: string, sceneIndex: number, userId: string) {
    const video = await this.getVideoOrFail(videoId, subjectId, userId);
    
    const scene = await this.prisma.videoScene.findFirst({
      where: { videoGenId: videoId, sceneIndex },
    });
    if (!scene) throw new NotFoundException(`Scene ${sceneIndex} not found`);

    // Update scene status so the UI shows a loading indicator
    await this.prisma.videoScene.update({
      where: { id: scene.id },
      data: { status: 'rendering', errorMessage: null },
    });

    // Build job payload for code regeneration
    const jobPayload = await this.buildJobPayload(video, userId);
    jobPayload.mode = 'regenerate-code';
    jobPayload.sceneIndex = sceneIndex;
    jobPayload.script = video.editedScript || video.videoScript;

    // Inject latest visualDesc + narrationText from DB into the script
    // so the AI uses the user-edited description to generate new code
    if (Array.isArray(jobPayload.script)) {
      const scriptScene = (jobPayload.script as any[]).find((s: any) => s.index === sceneIndex)
        || (jobPayload.script as any[])[sceneIndex];
      if (scriptScene) {
        if (scene.visualDesc) {
          scriptScene.visual_desc = scene.visualDesc;
          this.logger.log(`Injected user-edited visualDesc for scene ${sceneIndex}`);
        }
        if (scene.narrationText) {
          scriptScene.narration_vi = scene.narrationText;
        }
      }
    }

    await this.videoQueue.add('generate', jobPayload, {
      attempts: 1,
      removeOnComplete: true,
    });

    this.logger.log(`Code regeneration dispatched for scene ${sceneIndex} of video ${videoId}`);
    return { message: 'Code regeneration started', sceneIndex };
  }

  /**
   * Save user-edited Manim code for a scene (Step 3).
   */
  async updateSceneCode(subjectId: string, videoId: string, sceneIndex: number, userId: string, code: string) {
    await this.getVideoOrFail(videoId, subjectId, userId);

    const scene = await this.prisma.videoScene.findFirst({
      where: { videoGenId: videoId, sceneIndex },
    });
    if (!scene) throw new NotFoundException(`Scene ${sceneIndex} not found`);

    const updated = await this.prisma.videoScene.update({
      where: { id: scene.id },
      data: { manimCode: code, approved: false, clipUrl: null },
    });

    return { message: 'Scene code updated', sceneIndex, manimCode: updated.manimCode };
  }

  /**
   * Save user-edited visual description for a scene (Step 3).
   */
  async updateSceneVisualDesc(subjectId: string, videoId: string, sceneIndex: number, userId: string, visualDesc: string) {
    await this.getVideoOrFail(videoId, subjectId, userId);
    
    const scene = await this.prisma.videoScene.findFirst({
      where: { videoGenId: videoId, sceneIndex },
    });
    if (!scene) throw new NotFoundException(`Scene ${sceneIndex} not found`);

    const updated = await this.prisma.videoScene.update({
      where: { id: scene.id },
      data: { visualDesc },
    });

    return { message: 'Visual description updated', sceneIndex, visualDesc: updated.visualDesc };
  }

  /**
   * Approve/unapprove a scene clip (Step 3).
   */
  async approveScene(subjectId: string, videoId: string, sceneIndex: number, userId: string, approved: boolean) {
    await this.getVideoOrFail(videoId, subjectId, userId);
    
    const scene = await this.prisma.videoScene.findFirst({
      where: { videoGenId: videoId, sceneIndex },
    });
    if (!scene) throw new NotFoundException(`Scene ${sceneIndex} not found`);

    await this.prisma.videoScene.update({
      where: { id: scene.id },
      data: { approved },
    });

    return { message: approved ? 'Scene approved' : 'Scene unapproved', sceneIndex };
  }

  /**
   * Compose all approved scene clips into final video (Step 3 → 4).
   */
  async composeVideo(subjectId: string, videoId: string, userId: string) {
    const video = await this.getVideoOrFail(videoId, subjectId, userId);
    
    const scenes = await this.prisma.videoScene.findMany({
      where: { videoGenId: videoId },
      orderBy: { sceneIndex: 'asc' },
    });

    // Check all scenes have clips
    const missingClips = scenes.filter(s => !s.clipUrl);
    if (missingClips.length > 0) {
      throw new BadRequestException(
        `Scenes ${missingClips.map(s => s.sceneIndex).join(', ')} chưa được render. Hãy render tất cả scene trước.`
      );
    }

    // Mark as composing
    await this.prisma.videoGeneration.update({
      where: { id: videoId },
      data: { status: 'composing', progress: 75, wizardStep: 4 },
    });

    // Build compose job
    const jobPayload = await this.buildJobPayload(video, userId);
    jobPayload.mode = 'compose-only';
    jobPayload.script = video.editedScript || video.videoScript;

    await this.videoQueue.add('generate', jobPayload, {
      attempts: 1,
      removeOnComplete: true,
    });

    this.logger.log(`Compose dispatched for video ${videoId}`);
    return { message: 'Video composition started', videoId };
  }

  /**
   * Handle scene render completion from worker.
   */
  async onSceneRenderDone(jobId: string, sceneIndex: number, clipUrl: string, duration: number, manimCode?: string) {
    const data: any = { clipUrl, duration, status: 'done', errorMessage: null };
    if (manimCode) data.manimCode = manimCode;
    await this.prisma.videoScene.updateMany({
      where: { videoGenId: jobId, sceneIndex },
      data,
    });
    this.logger.log(`Scene ${sceneIndex} render done for job ${jobId}: ${clipUrl}${manimCode ? ' (code saved)' : ''}`);
  }

  /**
   * Handle scene code regeneration completion from worker.
   */
  async onSceneCodeRegenerated(jobId: string, sceneIndex: number, manimCode: string) {
    await this.prisma.videoScene.updateMany({
      where: { videoGenId: jobId, sceneIndex },
      data: { manimCode, status: 'pending', clipUrl: null, approved: false },
    });
    this.logger.log(`Scene ${sceneIndex} code regenerated for job ${jobId}`);
  }

  /**
   * Retry a specific scene.
   */
  async retryScene(sceneId: string) {
    await this.prisma.videoScene.update({
      where: { id: sceneId },
      data: { status: 'pending', errorMessage: null, retryCount: { increment: 1 } },
    });
    return { message: 'Scene status reset. Re-generate the video to retry.', sceneId };
  }

  /**
   * User's video history (across all subjects).
   */
  async getHistory(userId: string) {
    return this.prisma.videoGeneration.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        subjectId: true,
        title: true,
        format: true,
        resolution: true,
        status: true,
        duration: true,
        fileSize: true,
        videoUrl: true,
        thumbnailUrl: true,
        createdAt: true,
        subject: { select: { name: true } },
        lesson: { select: { title: true } },
      },
    });
  }

  // ─────────────────────────────────────────────────────
  // INTERNAL HELPERS
  // ─────────────────────────────────────────────────────

  private async verifySubjectOwnership(subjectId: string, userId: string) {
    const subject = await this.prisma.subject.findFirst({
      where: { id: subjectId, userId },
      select: { id: true },
    });
    if (!subject) throw new ForbiddenException('Subject not found or access denied');
    return subject;
  }

  private async getVideoOrFail(videoId: string, subjectId: string, userId: string) {
    const video = await this.prisma.videoGeneration.findFirst({
      where: { id: videoId, subjectId },
    });
    if (!video) throw new NotFoundException('Video not found');
    if (video.userId !== userId) throw new ForbiddenException('Not your video');
    return video;
  }

  /**
   * Build the full job payload with API keys for the Python worker.
   */
  private async buildJobPayload(video: any, userId: string) {
    const [cliproxyConfig, imageGenConfig] = await Promise.all([
      this.systemConfig.getCLIProxyConfig(),
      this.systemConfig.getImageGenConfig(),
    ]);

    // Fetch decrypted ViTTS credentials
    const vittsCredentialsJson = await this.apiKeysService.getActiveKey(userId, 'VITTS' as any);
    let vittsApiKey = '';
    let vittsBaseUrl = process.env.VITTS_BASE_URL || 'http://117.0.36.6:8888';
    if (vittsCredentialsJson) {
      try {
        const creds = JSON.parse(vittsCredentialsJson);
        vittsApiKey = creds.apiKey || '';
        vittsBaseUrl = creds.baseUrl || vittsBaseUrl;
      } catch {
        this.logger.warn('Failed to parse ViTTS credentials');
      }
    }

    // Read user's saved TTS voice preference (e.g., 'vitts:ref:UUID' for OmniVoice clone)
    let ttsVoice = '';
    try {
      const ttsConfig = await this.modelConfigService.getModelForTask(userId, 'TTS' as any);
      if (ttsConfig && ttsConfig.modelName) {
        ttsVoice = ttsConfig.modelName;
        this.logger.log(`User TTS voice preference: ${ttsVoice}`);
      }
    } catch (err) {
      this.logger.warn(`Failed to read user TTS config: ${err.message}`);
    }

    return {
      jobId: video.id,
      subjectId: video.subjectId,
      lessonId: video.lessonId,
      userId,
      mode: 'render' as string, // 'render' | 'script-only' | 'render-scene' | 'regenerate-code' | 'compose-only'
      script: null as any, // Will be set by caller for render mode
      sceneIndex: null as number | null, // Set for render-scene and regenerate-code modes
      config: {
        format: video.format,
        resolution: video.resolution,
        style: video.style,
        narrationLang: video.narrationLang,
        subtitleLang: video.subtitleLang,
        narrationSpeed: video.narrationSpeed,
        forcedApproach: video.style !== 'auto' && video.style !== 'hybrid' ? video.style : null,
      },
      input: {
        inputText: video.inputText || '',
        inputType: video.inputType,
        inputFiles: video.inputFilesJson || [],
      },
      apiKeys: {
        gemini: process.env.GEMINI_API_KEY || '',
        cliproxy: {
          enabled: cliproxyConfig.enabled,
          url: cliproxyConfig.url,
          apiKey: cliproxyConfig.apiKey,
          defaultTextModel: cliproxyConfig.defaultTextModel,
          defaultImageModel: cliproxyConfig.defaultImageModel,
          defaultTTSModel: cliproxyConfig.defaultTTSModel,
        },
        imageGen: {
          enabled: imageGenConfig.enabled,
          url: imageGenConfig.url,
          apiKey: imageGenConfig.apiKey,
          defaultModel: imageGenConfig.defaultModel,
          steps: imageGenConfig.steps,
        },
        vitts: {
          baseUrl: vittsBaseUrl,
          apiKey: vittsApiKey,
          voice: ttsVoice,  // User's saved TTS voice, e.g., 'vitts:ref:UUID'
        },
        minio: {
          endpoint: process.env.MINIO_ENDPOINT || 'localhost',
          port: parseInt(process.env.MINIO_PORT || '9000'),
          accessKey: process.env.MINIO_ACCESS_KEY || '',
          secretKey: process.env.MINIO_SECRET_KEY || '',
          bucket: process.env.MINIO_BUCKET || 'ai-teaching',
        },
      },
    };
  }

  /**
   * Stream a video/subtitle/thumbnail file from MinIO.
   */
  async getFileStream(
    subjectId: string,
    videoId: string,
    userId: string,
    fileType: 'video' | 'subtitle' | 'thumbnail',
  ): Promise<{ stream: any; contentType: string; size: number; filename: string }> {
    const video = await this.getVideo(subjectId, videoId, userId);
    if (!video) {
      throw new Error('Video not found');
    }

    let objectName: string | null = null;
    let contentType = 'application/octet-stream';
    let filename = 'file';

    switch (fileType) {
      case 'video':
        objectName = video.videoUrl;
        contentType = 'video/mp4';
        filename = `${video.title || 'video'}.mp4`;
        break;
      case 'subtitle':
        objectName = video.subtitleUrl;
        contentType = 'text/plain; charset=utf-8';
        filename = `${video.title || 'subtitle'}.srt`;
        break;
      case 'thumbnail':
        objectName = video.thumbnailUrl;
        contentType = 'image/jpeg';
        filename = `${video.title || 'thumbnail'}.jpg`;
        break;
    }

    if (!objectName) {
      throw new Error(`No ${fileType} available for this video`);
    }

    const { Client } = await import('minio');
    const minioClient = new Client({
      endPoint: process.env.MINIO_ENDPOINT || 'localhost',
      port: parseInt(process.env.MINIO_PORT || '9000'),
      useSSL: false,
      accessKey: process.env.MINIO_ACCESS_KEY || '',
      secretKey: process.env.MINIO_SECRET_KEY || '',
    });

    const bucket = process.env.MINIO_BUCKET || 'ai-teaching';

    // Get object stat for size
    const stat = await minioClient.statObject(bucket, objectName);
    const stream = await minioClient.getObject(bucket, objectName);

    return {
      stream,
      contentType,
      size: stat.size,
      filename,
    };
  }
}
