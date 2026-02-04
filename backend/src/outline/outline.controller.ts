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
import { OutlineService } from './outline.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { IsString, IsNotEmpty } from 'class-validator';

// DTOs
class SaveRawOutlineDto {
    @IsString()
    @IsNotEmpty()
    rawOutline: string;
}

class UpdateDetailedOutlineDto {
    @IsString()
    @IsNotEmpty()
    detailedOutline: string;
}

@Controller('lessons/:lessonId/outline')
@UseGuards(JwtAuthGuard)
export class OutlineController {
    constructor(private outlineService: OutlineService) { }

    // GET /lessons/:id/outline - Get all outline data
    @Get()
    async getOutlineData(@Param('lessonId') lessonId: string) {
        return this.outlineService.getOutlineData(lessonId);
    }

    // PUT /lessons/:id/outline/raw - Save raw outline (Step 1)
    @Put('raw')
    async saveRawOutline(
        @Param('lessonId') lessonId: string,
        @Body() dto: SaveRawOutlineDto,
    ) {
        return this.outlineService.saveRawOutline(lessonId, dto.rawOutline);
    }

    // POST /lessons/:id/outline/generate - Generate detailed outline with AI (Step 2)
    @Post('generate')
    async generateDetailedOutline(
        @Param('lessonId') lessonId: string,
        @Request() req,
    ) {
        const detailedOutline = await this.outlineService.generateDetailedOutline(
            lessonId,
            req.user.id,
        );
        return { detailedOutline };
    }

    // PUT /lessons/:id/outline/detailed - Update detailed outline after user edit
    @Put('detailed')
    async updateDetailedOutline(
        @Param('lessonId') lessonId: string,
        @Body() dto: UpdateDetailedOutlineDto,
    ) {
        return this.outlineService.updateDetailedOutline(lessonId, dto.detailedOutline);
    }
}
