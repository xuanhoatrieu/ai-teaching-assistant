import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RemotionService } from './remotion.service';
import { RemotionRenderService } from './remotion-render.service';
import {
  CreateRemotionVideoDto,
  UpdateRemotionVideoDto,
  SuggestTopicsDto,
  GenerateSceneAudioDto,
  GenerateSceneImageDto,
} from './dto/create-remotion-video.dto';

@Controller('subjects/:subjectId/remotion')
@UseGuards(JwtAuthGuard)
export class RemotionController {
  constructor(
    private readonly remotionService: RemotionService,
    private readonly renderService: RemotionRenderService,
  ) {}

  /**
   * Get all Remotion videos for a subject
   */
  @Get()
  async listVideos(@Param('subjectId') subjectId: string, @Request() req: any) {
    return this.remotionService.listVideos(subjectId, req.user.id);
  }

  /**
   * Suggest micro-topics from a lesson
   */
  @Post('suggest-topics')
  async suggestTopics(
    @Param('subjectId') subjectId: string,
    @Body() dto: SuggestTopicsDto,
    @Request() req: any,
  ) {
    return this.remotionService.suggestTopics(subjectId, dto.lessonId, req.user.id);
  }

  /**
   * Create a new Remotion video
   */
  @Post()
  async createVideo(
    @Param('subjectId') subjectId: string,
    @Body() dto: CreateRemotionVideoDto,
    @Request() req: any,
  ) {
    return this.remotionService.createVideo(subjectId, req.user.id, dto);
  }

  /**
   * Get video detail
   */
  @Get(':videoId')
  async getVideo(
    @Param('videoId') videoId: string,
    @Request() req: any,
  ) {
    return this.remotionService.getVideo(videoId, req.user.id);
  }

  /**
   * Update video detail or scenes
   */
  @Put(':videoId')
  async updateVideo(
    @Param('videoId') videoId: string,
    @Body() dto: UpdateRemotionVideoDto,
    @Request() req: any,
  ) {
    return this.remotionService.updateVideo(videoId, req.user.id, dto);
  }

  /**
   * Delete video
   */
  @Delete(':videoId')
  async deleteVideo(
    @Param('videoId') videoId: string,
    @Request() req: any,
  ) {
    return this.remotionService.deleteVideo(videoId, req.user.id);
  }

  /**
   * Generate video script using AI
   */
  @Post(':videoId/script')
  async generateScript(
    @Param('videoId') videoId: string,
    @Body() body: { prompt?: string },
    @Request() req: any,
  ) {
    return this.remotionService.generateScript(videoId, req.user.id, body?.prompt);
  }

  /**
   * Generate TTS audio for a specific scene
   */
  @Post(':videoId/scene-audio')
  async generateSceneAudio(
    @Param('videoId') videoId: string,
    @Body() dto: GenerateSceneAudioDto,
    @Request() req: any,
  ) {
    return this.remotionService.generateSceneAudio(
      videoId,
      dto.sceneIndex,
      req.user.id,
      dto.voiceId,
      {
        multilingualMode: dto.multilingualMode,
        vittsEngine: dto.vittsEngine,
        vittsMode: dto.vittsMode,
        vittsDesignInstruct: dto.vittsDesignInstruct,
        vittsNormalize: dto.vittsNormalize,
      },
    );
  }

  /**
   * Generate AI image for a specific scene
   */
  @Post(':videoId/scene-image')
  async generateSceneImage(
    @Param('videoId') videoId: string,
    @Body() dto: GenerateSceneImageDto,
    @Request() req: any,
  ) {
    return this.remotionService.generateSceneImage(
      videoId,
      dto.sceneIndex,
      req.user.id,
      dto.prompt,
    );
  }

  /**
   * Start rendering video to MP4
   */
  @Post(':videoId/render')
  async renderVideo(
    @Param('videoId') videoId: string,
    @Request() req: any,
  ) {
    return this.renderService.renderVideo(videoId, req.user.id);
  }

  /**
   * Check video rendering status
   */
  @Get(':videoId/status')
  async getStatus(
    @Param('videoId') videoId: string,
    @Request() req: any,
  ) {
    const video = await this.remotionService.getVideo(videoId, req.user.id);
    return {
      id: video.id,
      status: video.status,
      progress: video.progress,
      videoUrl: video.videoUrl,
      durationSeconds: video.durationSeconds,
      fileSize: video.fileSize,
      errorMessage: video.errorMessage,
    };
  }
}
