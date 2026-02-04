import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    UseGuards,
    UseInterceptors,
    UploadedFile,
    ParseFilePipe,
    MaxFileSizeValidator,
    FileTypeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { LessonsService } from './lessons.service';
import { CreateLessonDto } from './dto/create-lesson.dto';
import { UpdateLessonDto } from './dto/update-lesson.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller()
@UseGuards(JwtAuthGuard)
export class LessonsController {
    constructor(private readonly lessonsService: LessonsService) { }

    // ========== Nested under Subjects ==========

    @Post('subjects/:subjectId/lessons')
    create(
        @Param('subjectId') subjectId: string,
        @CurrentUser() user: { id: string },
        @Body() dto: CreateLessonDto,
    ) {
        return this.lessonsService.create(subjectId, user.id, dto);
    }

    @Get('subjects/:subjectId/lessons')
    findAllBySubject(
        @Param('subjectId') subjectId: string,
        @CurrentUser() user: { id: string },
    ) {
        return this.lessonsService.findAllBySubject(subjectId, user.id);
    }

    // ========== Direct Lesson Routes ==========

    @Get('lessons/:id')
    findOne(
        @Param('id') id: string,
        @CurrentUser() user: { id: string },
    ) {
        return this.lessonsService.findOne(id, user.id);
    }

    @Put('lessons/:id')
    update(
        @Param('id') id: string,
        @CurrentUser() user: { id: string },
        @Body() dto: UpdateLessonDto,
    ) {
        return this.lessonsService.update(id, user.id, dto);
    }

    @Delete('lessons/:id')
    remove(
        @Param('id') id: string,
        @CurrentUser() user: { id: string },
    ) {
        return this.lessonsService.remove(id, user.id);
    }

    // ========== Outline Upload ==========

    @Post('lessons/:id/upload-outline')
    @UseInterceptors(FileInterceptor('file'))
    uploadOutline(
        @Param('id') id: string,
        @CurrentUser() user: { id: string },
        @UploadedFile(
            new ParseFilePipe({
                validators: [
                    new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }), // 5MB
                    new FileTypeValidator({
                        fileType: /(docx|md|txt|text\/plain|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|text\/markdown)/,
                    }),
                ],
            }),
        )
        file: Express.Multer.File,
    ) {
        return this.lessonsService.uploadOutline(id, user.id, file);
    }

    // ========== Generation ==========

    @Post('lessons/:id/generate')
    triggerGeneration(
        @Param('id') id: string,
        @CurrentUser() user: { id: string },
    ) {
        return this.lessonsService.triggerGeneration(id, user.id);
    }

    @Get('lessons/:id/status')
    getGenerationStatus(
        @Param('id') id: string,
        @CurrentUser() user: { id: string },
    ) {
        return this.lessonsService.getGenerationStatus(id, user.id);
    }
}
