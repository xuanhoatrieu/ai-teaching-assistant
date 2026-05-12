import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Param,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { VideoGenService } from './video-gen.service';
import { CreateVideoDto, UpdateVideoDto, SaveScriptDto } from './dto/create-video.dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class VideoGenController {
  constructor(private readonly videoGenService: VideoGenService) {}

  // ─────────────────────────────────────────────────────
  // Subject-scoped Video CRUD
  // ─────────────────────────────────────────────────────

  /** Create a new video draft in a subject */
  @Post('subjects/:subjectId/videos')
  @HttpCode(HttpStatus.CREATED)
  async createVideo(
    @Param('subjectId') subjectId: string,
    @Body() dto: CreateVideoDto,
    @Req() req: any,
  ) {
    return this.videoGenService.createVideo(subjectId, req.user.id, dto);
  }

  /** List all videos in a subject */
  @Get('subjects/:subjectId/videos')
  async listVideos(
    @Param('subjectId') subjectId: string,
    @Req() req: any,
  ) {
    return this.videoGenService.listVideos(subjectId, req.user.id);
  }

  /** Get a single video with scenes */
  @Get('subjects/:subjectId/videos/:videoId')
  async getVideo(
    @Param('subjectId') subjectId: string,
    @Param('videoId') videoId: string,
    @Req() req: any,
  ) {
    return this.videoGenService.getVideo(subjectId, videoId, req.user.id);
  }

  /** Update video config/input (draft or script stage only) */
  @Put('subjects/:subjectId/videos/:videoId')
  async updateVideo(
    @Param('subjectId') subjectId: string,
    @Param('videoId') videoId: string,
    @Body() dto: UpdateVideoDto,
    @Req() req: any,
  ) {
    return this.videoGenService.updateVideo(subjectId, videoId, req.user.id, dto);
  }

  /** Delete a video */
  @Delete('subjects/:subjectId/videos/:videoId')
  async deleteVideo(
    @Param('subjectId') subjectId: string,
    @Param('videoId') videoId: string,
    @Req() req: any,
  ) {
    return this.videoGenService.deleteVideo(subjectId, videoId, req.user.id);
  }

  // ─────────────────────────────────────────────────────
  // Script Generation & Editing (Step 2)
  // ─────────────────────────────────────────────────────

  /** Generate video script via AI */
  @Post('subjects/:subjectId/videos/:videoId/generate-script')
  @HttpCode(HttpStatus.ACCEPTED)
  async generateScript(
    @Param('subjectId') subjectId: string,
    @Param('videoId') videoId: string,
    @Req() req: any,
  ) {
    return this.videoGenService.generateScript(subjectId, videoId, req.user.id);
  }

  /** Save user-edited script */
  @Put('subjects/:subjectId/videos/:videoId/script')
  async saveScript(
    @Param('subjectId') subjectId: string,
    @Param('videoId') videoId: string,
    @Body() dto: SaveScriptDto,
    @Req() req: any,
  ) {
    return this.videoGenService.saveScript(subjectId, videoId, req.user.id, dto);
  }

  // ─────────────────────────────────────────────────────
  // Render (Step 4)
  // ─────────────────────────────────────────────────────

  /** Start video rendering (all scenes) */
  @Post('subjects/:subjectId/videos/:videoId/render')
  @HttpCode(HttpStatus.ACCEPTED)
  async startRender(
    @Param('subjectId') subjectId: string,
    @Param('videoId') videoId: string,
    @Req() req: any,
  ) {
    return this.videoGenService.startRender(subjectId, videoId, req.user.id);
  }

  // ─────────────────────────────────────────────────────
  // Scene-by-Scene Render (Step 3 — Interactive Preview)
  // ─────────────────────────────────────────────────────

  /** Render a single scene for preview */
  @Post('subjects/:subjectId/videos/:videoId/scenes/:sceneIndex/render-preview')
  @HttpCode(HttpStatus.ACCEPTED)
  async renderScenePreview(
    @Param('subjectId') subjectId: string,
    @Param('videoId') videoId: string,
    @Param('sceneIndex') sceneIndex: string,
    @Req() req: any,
  ) {
    return this.videoGenService.renderScenePreview(subjectId, videoId, parseInt(sceneIndex), req.user.id);
  }

  /** Regenerate Manim code for a scene */
  @Post('subjects/:subjectId/videos/:videoId/scenes/:sceneIndex/regenerate-code')
  @HttpCode(HttpStatus.ACCEPTED)
  async regenerateSceneCode(
    @Param('subjectId') subjectId: string,
    @Param('videoId') videoId: string,
    @Param('sceneIndex') sceneIndex: string,
    @Req() req: any,
  ) {
    return this.videoGenService.regenerateSceneCode(subjectId, videoId, parseInt(sceneIndex), req.user.id);
  }

  /** Save user-edited Manim code */
  @Put('subjects/:subjectId/videos/:videoId/scenes/:sceneIndex/code')
  async updateSceneCode(
    @Param('subjectId') subjectId: string,
    @Param('videoId') videoId: string,
    @Param('sceneIndex') sceneIndex: string,
    @Body() body: { code: string },
    @Req() req: any,
  ) {
    return this.videoGenService.updateSceneCode(subjectId, videoId, parseInt(sceneIndex), req.user.id, body.code);
  }

  /** Save user-edited visual description */
  @Put('subjects/:subjectId/videos/:videoId/scenes/:sceneIndex/visual-desc')
  async updateSceneVisualDesc(
    @Param('subjectId') subjectId: string,
    @Param('videoId') videoId: string,
    @Param('sceneIndex') sceneIndex: string,
    @Body() body: { visualDesc: string },
    @Req() req: any,
  ) {
    return this.videoGenService.updateSceneVisualDesc(subjectId, videoId, parseInt(sceneIndex), req.user.id, body.visualDesc);
  }

  /** Approve/unapprove a scene clip */
  @Put('subjects/:subjectId/videos/:videoId/scenes/:sceneIndex/approve')
  async approveScene(
    @Param('subjectId') subjectId: string,
    @Param('videoId') videoId: string,
    @Param('sceneIndex') sceneIndex: string,
    @Body() body: { approved: boolean },
    @Req() req: any,
  ) {
    return this.videoGenService.approveScene(subjectId, videoId, parseInt(sceneIndex), req.user.id, body.approved);
  }

  /** Compose all scene clips into final video */
  @Post('subjects/:subjectId/videos/:videoId/compose')
  @HttpCode(HttpStatus.ACCEPTED)
  async composeVideo(
    @Param('subjectId') subjectId: string,
    @Param('videoId') videoId: string,
    @Req() req: any,
  ) {
    return this.videoGenService.composeVideo(subjectId, videoId, req.user.id);
  }

  /** Generate TTS audio for a single scene (Step 2.5 — audio preview) */
  @Post('subjects/:subjectId/videos/:videoId/scenes/:sceneIndex/generate-audio')
  @HttpCode(HttpStatus.OK)
  async generateAudioForScene(
    @Param('subjectId') subjectId: string,
    @Param('videoId') videoId: string,
    @Param('sceneIndex') sceneIndex: string,
    @Body() body: { multilingualMode?: string; vittsMode?: string; vittsDesignInstruct?: string; vittsNormalize?: boolean },
    @Req() req: any,
  ) {
    return this.videoGenService.generateAudioForScene(subjectId, videoId, parseInt(sceneIndex), req.user.id, body);
  }

  /** Stream scene audio file */
  @Get('subjects/:subjectId/videos/:videoId/scenes/:sceneIndex/audio')
  async streamSceneAudio(
    @Param('subjectId') subjectId: string,
    @Param('videoId') videoId: string,
    @Param('sceneIndex') sceneIndex: string,
    @Req() req: any,
    @Res() res: any,
  ) {
    try {
      const { stream, contentType, size } = await this.videoGenService.getSceneAudioStream(
        subjectId, videoId, req.user.id, parseInt(sceneIndex),
      );
      res.set({
        'Content-Type': contentType,
        'Content-Length': size,
        'Accept-Ranges': 'bytes',
      });
      stream.pipe(res);
    } catch (error) {
      res.status(404).json({ message: error.message || 'Audio not found' });
    }
  }

  /** Stream scene clip video preview */
  @Get('subjects/:subjectId/videos/:videoId/scenes/:sceneIndex/stream/clip')
  async streamSceneClip(
    @Param('subjectId') subjectId: string,
    @Param('videoId') videoId: string,
    @Param('sceneIndex') sceneIndex: string,
    @Req() req: any,
    @Res() res: any,
  ) {
    try {
      const { stream, contentType, size } = await this.videoGenService.getSceneClipStream(
        subjectId, videoId, req.user.id, parseInt(sceneIndex),
      );
      res.set({
        'Content-Type': contentType,
        'Content-Length': size,
        'Accept-Ranges': 'bytes',
      });
      stream.pipe(res);
    } catch (error) {
      res.status(404).json({ message: error.message || 'Clip not found' });
    }
  }

  /** Get render status */
  @Get('subjects/:subjectId/videos/:videoId/status')
  async getStatus(
    @Param('videoId') videoId: string,
  ) {
    return this.videoGenService.getVideoStatus(videoId);
  }

  // ─────────────────────────────────────────────────────
  // Global / Utility
  // ─────────────────────────────────────────────────────

  /** User's video history (across all subjects) */
  @Get('video-gen/history')
  async getHistory(@Req() req: any) {
    return this.videoGenService.getHistory(req.user.id);
  }

  /** Retry a failed scene */
  @Post('video-gen/retry/:sceneId')
  async retryScene(@Param('sceneId') sceneId: string) {
    return this.videoGenService.retryScene(sceneId);
  }

  // ─────────────────────────────────────────────────────
  // File Streaming (Video / Subtitle / Thumbnail from MinIO)
  // ─────────────────────────────────────────────────────

  /** Stream video file */
  @Get('subjects/:subjectId/videos/:videoId/stream/video')
  async streamVideo(
    @Param('subjectId') subjectId: string,
    @Param('videoId') videoId: string,
    @Req() req: any,
    @Res() res: any,
  ) {
    try {
      const { stream, contentType, size, filename } = await this.videoGenService.getFileStream(
        subjectId, videoId, req.user.id, 'video',
      );
      res.set({
        'Content-Type': contentType,
        'Content-Length': size,
        'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"`,
        'Accept-Ranges': 'bytes',
      });
      stream.pipe(res);
    } catch (error) {
      res.status(404).json({ message: error.message || 'Video file not found' });
    }
  }

  /** Stream subtitle file */
  @Get('subjects/:subjectId/videos/:videoId/stream/subtitle')
  async streamSubtitle(
    @Param('subjectId') subjectId: string,
    @Param('videoId') videoId: string,
    @Req() req: any,
    @Res() res: any,
  ) {
    try {
      const { stream, contentType, size, filename } = await this.videoGenService.getFileStream(
        subjectId, videoId, req.user.id, 'subtitle',
      );
      res.set({
        'Content-Type': contentType,
        'Content-Length': size,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      });
      stream.pipe(res);
    } catch (error) {
      res.status(404).json({ message: error.message || 'Subtitle file not found' });
    }
  }

  /** Stream thumbnail */
  @Get('subjects/:subjectId/videos/:videoId/stream/thumbnail')
  async streamThumbnail(
    @Param('subjectId') subjectId: string,
    @Param('videoId') videoId: string,
    @Req() req: any,
    @Res() res: any,
  ) {
    try {
      const { stream, contentType, size, filename } = await this.videoGenService.getFileStream(
        subjectId, videoId, req.user.id, 'thumbnail',
      );
      res.set({
        'Content-Type': contentType,
        'Content-Length': size,
      });
      stream.pipe(res);
    } catch (error) {
      res.status(404).json({ message: error.message || 'Thumbnail not found' });
    }
  }
}
