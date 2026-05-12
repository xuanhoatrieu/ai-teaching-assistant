import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { VideoGenService } from './video-gen.service';
import { CreateVideoDto } from './dto/create-video.dto';

@ApiTags('Video Generation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class VideoGenController {
  constructor(private readonly videoGenService: VideoGenService) {}

  @Post('lessons/:lessonId/video/generate')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Start video generation for a lesson' })
  async generateVideo(
    @Param('lessonId') lessonId: string,
    @Body() dto: CreateVideoDto,
    @Req() req: any,
  ) {
    const userId = req.user.id;
    return this.videoGenService.createVideoJob(lessonId, userId, dto);
  }

  @Get('lessons/:lessonId/video')
  @ApiOperation({ summary: 'Get latest video for a lesson' })
  async getLatestVideo(@Param('lessonId') lessonId: string) {
    const video = await this.videoGenService.getLatestVideo(lessonId);
    if (!video) throw new NotFoundException('No video found for this lesson');
    return video;
  }

  @Get('lessons/:lessonId/video/status')
  @ApiOperation({ summary: 'Get video generation status with progress' })
  async getStatus(@Param('lessonId') lessonId: string) {
    const status = await this.videoGenService.getStatus(lessonId);
    if (!status) throw new NotFoundException('No video generation found');
    return status;
  }

  @Get('lessons/:lessonId/video/scenes')
  @ApiOperation({ summary: 'Get scene-by-scene details' })
  async getScenes(@Param('lessonId') lessonId: string) {
    return this.videoGenService.getScenes(lessonId);
  }

  @Get('lessons/:lessonId/video/download')
  @ApiOperation({ summary: 'Download video MP4' })
  async downloadVideo(
    @Param('lessonId') lessonId: string,
    @Res() res: Response,
  ) {
    const url = await this.videoGenService.getDownloadUrl(lessonId);
    if (!url) throw new NotFoundException('Video not ready');
    return res.redirect(url);
  }

  @Get('lessons/:lessonId/video/subtitle')
  @ApiOperation({ summary: 'Download subtitle SRT' })
  async downloadSubtitle(
    @Param('lessonId') lessonId: string,
    @Res() res: Response,
  ) {
    const url = await this.videoGenService.getSubtitleUrl(lessonId);
    if (!url) throw new NotFoundException('Subtitle not ready');
    return res.redirect(url);
  }

  @Delete('lessons/:lessonId/video/:videoId')
  @ApiOperation({ summary: 'Delete a generated video' })
  async deleteVideo(
    @Param('lessonId') lessonId: string,
    @Param('videoId') videoId: string,
    @Req() req: any,
  ) {
    return this.videoGenService.deleteVideo(videoId, req.user.id);
  }

  @Get('video-gen/history')
  @ApiOperation({ summary: 'Get video generation history for current user' })
  async getHistory(@Req() req: any) {
    return this.videoGenService.getHistory(req.user.id);
  }

  @Post('video-gen/retry/:sceneId')
  @ApiOperation({ summary: 'Retry a failed scene' })
  async retryScene(@Param('sceneId') sceneId: string) {
    return this.videoGenService.retryScene(sceneId);
  }
}
