import {
    Controller,
    Get,
    Put,
    Post,
    Body,
    Param,
    UseGuards,
    Request,
} from '@nestjs/common';
import { SlidesService } from './slides.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { IsString, IsNotEmpty } from 'class-validator';

// DTOs
class UpdateSlideScriptDto {
    @IsString()
    @IsNotEmpty()
    slideScript: string;
}

@Controller('lessons/:lessonId/slides')
@UseGuards(JwtAuthGuard)
export class SlidesController {
    constructor(private slidesService: SlidesService) { }

    // GET /lessons/:lessonId/slides - Get all Slide entities from database (for Step 5)
    @Get()
    async getSlides(@Param('lessonId') lessonId: string) {
        return this.slidesService.getSlides(lessonId);
    }

    // GET /lessons/:lessonId/slides/script-data - Get slide script metadata (for Step 3)
    @Get('script-data')
    async getSlideScriptData(@Param('lessonId') lessonId: string) {
        return this.slidesService.getSlideScriptData(lessonId);
    }

    // POST /lessons/:id/slides/generate-script - Generate slide script with AI (Step 3)
    @Post('generate-script')
    async generateSlideScript(
        @Param('lessonId') lessonId: string,
        @Request() req,
    ) {
        const slideScript = await this.slidesService.generateSlideScript(
            lessonId,
            req.user.id,
        );
        return { slideScript };
    }

    // PUT /lessons/:id/slides/script - Update slide script after user edit
    @Put('script')
    async updateSlideScript(
        @Param('lessonId') lessonId: string,
        @Body() dto: UpdateSlideScriptDto,
    ) {
        return this.slidesService.updateSlideScript(lessonId, dto.slideScript);
    }

    // POST /lessons/:lessonId/slides/:slideIndex/regenerate-content - Regenerate content for single slide
    @Post(':slideIndex/regenerate-content')
    async regenerateContent(
        @Param('lessonId') lessonId: string,
        @Param('slideIndex') slideIndex: string,
        @Request() req,
    ) {
        return this.slidesService.regenerateSlideContent(
            lessonId,
            parseInt(slideIndex, 10),
            req.user.id,
        );
    }

    // POST /lessons/:lessonId/slides/:slideIndex/regenerate-image - Regenerate image for single slide
    @Post(':slideIndex/regenerate-image')
    async regenerateImage(
        @Param('lessonId') lessonId: string,
        @Param('slideIndex') slideIndex: string,
        @Request() req,
    ) {
        return this.slidesService.regenerateSlideImage(
            lessonId,
            parseInt(slideIndex, 10),
            req.user.id,
        );
    }
}
