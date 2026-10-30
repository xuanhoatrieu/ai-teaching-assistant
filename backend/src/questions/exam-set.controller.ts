import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Param,
    Body,
    Query,
    UseGuards,
    Res,
    Req,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ExamSetService } from './exam-set.service';
import type {
    GenerateExamSetDto,
    UpdateExamSetDto,
} from './exam-set.service';

@Controller('exam-sets')
@UseGuards(JwtAuthGuard)
export class ExamSetController {
    constructor(private readonly examSetService: ExamSetService) { }

    /**
     * GET /exam-sets/lessons-overview?subjectId=...&pptxSubjectId=...
     */
    @Get('lessons-overview')
    async getLessonsOverview(
        @Req() req: any,
        @Query('subjectId') subjectId?: string,
        @Query('pptxSubjectId') pptxSubjectId?: string,
    ) {
        return this.examSetService.getLessonsOverview(req.user.id, {
            subjectId,
            pptxSubjectId,
        });
    }

    /**
     * GET /exam-sets?subjectId=...&pptxSubjectId=...
     */
    @Get()
    async listExamSets(
        @Req() req: any,
        @Query('subjectId') subjectId?: string,
        @Query('pptxSubjectId') pptxSubjectId?: string,
    ) {
        return this.examSetService.listExamSets(req.user.id, {
            subjectId,
            pptxSubjectId,
        });
    }

    /**
     * GET /exam-sets/:id
     */
    @Get(':id')
    async getExamSet(@Req() req: any, @Param('id') id: string) {
        return this.examSetService.getExamSet(req.user.id, id);
    }

    /**
     * POST /exam-sets/generate-async
     */
    @Post('generate-async')
    async generateExamSetAsync(
        @Req() req: any,
        @Body() dto: GenerateExamSetDto,
    ) {
        return this.examSetService.startGenerateJob(req.user.id, dto);
    }

    /**
     * POST /exam-sets/:id/append-async
     */
    @Post(':id/append-async')
    async appendExamSetAsync(
        @Req() req: any,
        @Param('id') id: string,
        @Body() dto: Partial<GenerateExamSetDto>,
    ) {
        return this.examSetService.startAppendJob(req.user.id, id, dto);
    }

    /**
     * PUT /exam-sets/:id
     */
    @Put(':id')
    async updateExamSet(
        @Req() req: any,
        @Param('id') id: string,
        @Body() dto: UpdateExamSetDto,
    ) {
        return this.examSetService.updateExamSet(req.user.id, id, dto);
    }

    /**
     * DELETE /exam-sets/:id
     */
    @Delete(':id')
    async deleteExamSet(@Req() req: any, @Param('id') id: string) {
        return this.examSetService.deleteExamSet(req.user.id, id);
    }

    /**
     * GET /exam-sets/:id/export/moodle-xml?categoryMode=single|bloom|lesson&lessonId=...&level=...
     */
    @Get(':id/export/moodle-xml')
    async exportMoodleXml(
        @Req() req: any,
        @Param('id') id: string,
        @Res() res: Response,
        @Query('categoryMode') categoryMode?: string,
        @Query('lessonId') lessonId?: string,
        @Query('level') level?: string,
    ) {
        await this.examSetService.exportMoodleXml(req.user.id, id, res, {
            categoryMode,
            lessonId,
            level,
        });
    }

    /**
     * GET /exam-sets/:id/export/excel?lessonId=...&level=...
     */
    @Get(':id/export/excel')
    async exportExcel(
        @Req() req: any,
        @Param('id') id: string,
        @Res() res: Response,
        @Query('lessonId') lessonId?: string,
        @Query('level') level?: string,
    ) {
        await this.examSetService.exportExcel(req.user.id, id, res, {
            lessonId,
            level,
        });
    }
}
