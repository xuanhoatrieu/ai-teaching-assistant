import { Controller, Get, HttpException, HttpStatus, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SlidesService } from './slides.service';
import { DownloadTicketService } from '../common/download-ticket/download-ticket.service';

/**
 * Native-browser download endpoints for SCORM / H5P exports.
 *
 * Intentionally NOT guarded by JwtAuthGuard (see PptxFileController for the
 * rationale). Auth = short-lived ticket issued by the guarded
 * POST /lessons/:lessonId/slides/export/{scorm|h5p}/ticket endpoints.
 */
@Controller('lessons/:lessonId/slides/export')
export class SlidesExportFileController {
    constructor(
        private readonly slidesService: SlidesService,
        private readonly tickets: DownloadTicketService,
    ) { }

    @Get('scorm/file')
    async downloadScorm(
        @Param('lessonId') lessonId: string,
        @Query('ticket') ticket: string,
        @Res() res: Response,
    ) {
        const payload = this.tickets.resolve(ticket, 'scorm', lessonId);
        if (!payload) {
            throw new HttpException('Liên kết tải đã hết hạn. Vui lòng bấm xuất lại.', HttpStatus.UNAUTHORIZED);
        }
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'no-store');
        return this.slidesService.exportScorm(
            lessonId, res, payload.params.templateId, payload.params.bgOption, payload.params.theme,
        );
    }

    @Get('h5p/file')
    async downloadH5p(
        @Param('lessonId') lessonId: string,
        @Query('ticket') ticket: string,
        @Res() res: Response,
    ) {
        const payload = this.tickets.resolve(ticket, 'h5p', lessonId);
        if (!payload) {
            throw new HttpException('Liên kết tải đã hết hạn. Vui lòng bấm xuất lại.', HttpStatus.UNAUTHORIZED);
        }
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'no-store');
        return this.slidesService.exportH5p(
            lessonId, res, payload.params.templateId, payload.params.bgOption, payload.params.theme,
        );
    }
}
