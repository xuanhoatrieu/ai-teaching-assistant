import {
    Controller,
    Get,
    Put,
    Post,
    Delete,
    Param,
    Body,
    UseGuards,
    ParseIntPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SlideDataService } from './slide-data.service';
import { SlideImageGeneratorService } from './slide-image-generator.service';
import { Slide } from '@prisma/client';

interface UpdateSlideDto {
    title?: string;
    content?: string;
    visualIdea?: string;
    speakerNote?: string;
    imagePrompt?: string;
    imageUrl?: string;
    audioUrl?: string;
    audioDuration?: number;
    status?: string;
}

interface ParseSlidesDto {
    slideScript: string;
}

@Controller('lessons/:lessonId/slides')
@UseGuards(JwtAuthGuard)
export class SlideDataController {
    constructor(
        private readonly slideDataService: SlideDataService,
        private readonly slideImageGeneratorService: SlideImageGeneratorService,
    ) { }

    /**
     * GET /lessons/:lessonId/slides
     * Get all slides for a lesson
     */
    @Get()
    async getSlides(
        @Param('lessonId') lessonId: string
    ): Promise<Slide[]> {
        return this.slideDataService.getSlides(lessonId);
    }

    /**
     * GET /lessons/:lessonId/slides/:slideIndex
     * Get a specific slide by index
     */
    @Get(':slideIndex')
    async getSlide(
        @Param('lessonId') lessonId: string,
        @Param('slideIndex', ParseIntPipe) slideIndex: number
    ): Promise<Slide | null> {
        return this.slideDataService.getSlide(lessonId, slideIndex);
    }

    /**
     * PUT /lessons/:lessonId/slides/:slideIndex
     * Update a specific slide
     */
    @Put(':slideIndex')
    async updateSlide(
        @Param('lessonId') lessonId: string,
        @Param('slideIndex', ParseIntPipe) slideIndex: number,
        @Body() dto: UpdateSlideDto
    ): Promise<Slide> {
        return this.slideDataService.updateSlide(lessonId, slideIndex, dto);
    }

    /**
     * POST /lessons/:lessonId/slides/parse
     * Parse slideScript markdown and save as Slide records
     */
    @Post('parse')
    async parseSlides(
        @Param('lessonId') lessonId: string,
        @Body() dto: ParseSlidesDto
    ): Promise<Slide[]> {
        return this.slideDataService.parseAndSaveSlides(lessonId, dto.slideScript);
    }

    /**
     * POST /lessons/:lessonId/slides/sync
     * Sync Slide records back to lesson.slideScript
     */
    @Post('sync')
    async syncToSlideScript(
        @Param('lessonId') lessonId: string
    ): Promise<{ slideScript: string }> {
        const slideScript = await this.slideDataService.syncToSlideScript(lessonId);
        return { slideScript };
    }

    /**
     * DELETE /lessons/:lessonId/slides
     * Delete all slides for a lesson
     */
    @Delete()
    async deleteAllSlides(
        @Param('lessonId') lessonId: string
    ): Promise<{ deleted: number }> {
        const deleted = await this.slideDataService.deleteAllSlides(lessonId);
        return { deleted };
    }

    /**
     * GET /lessons/:lessonId/slides/count
     * Get slide count for a lesson
     */
    @Get('count')
    async getSlideCount(
        @Param('lessonId') lessonId: string
    ): Promise<{ count: number }> {
        const count = await this.slideDataService.getSlideCount(lessonId);
        return { count };
    }

    // ==================== IMAGE GENERATION ====================

    /**
     * POST /lessons/:lessonId/slides/:slideIndex/generate-image
     * Generate image for a single slide from its visualIdea
     */
    @Post(':slideIndex/generate-image')
    async generateImageForSlide(
        @Param('lessonId') lessonId: string,
        @Param('slideIndex', ParseIntPipe) slideIndex: number,
        @CurrentUser('id') userId: string
    ): Promise<Slide> {
        return this.slideImageGeneratorService.generateImageForSlide(lessonId, slideIndex, userId);
    }

    /**
     * POST /lessons/:lessonId/slides/generate-all-images
     * Generate images for all slides in a lesson that have visualIdea
     */
    @Post('generate-all-images')
    async generateAllImages(
        @Param('lessonId') lessonId: string,
        @CurrentUser('id') userId: string
    ): Promise<{ results: any[]; successCount: number; totalCount: number }> {
        const results = await this.slideImageGeneratorService.generateAllImages(lessonId, userId);
        const successCount = results.filter(r => r.success).length;
        return {
            results,
            successCount,
            totalCount: results.length,
        };
    }
}
