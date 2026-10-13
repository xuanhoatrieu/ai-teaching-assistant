import { Controller, Get, HttpException, HttpStatus, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PptxService } from './pptx.service';
import { DownloadTicketService } from '../common/download-ticket/download-ticket.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Native-browser download endpoint for temporary PPTX files.
 *
 * Intentionally NOT guarded by JwtAuthGuard: a plain <a href> navigation (and
 * download managers like IDM that re-request the URL) cannot send the
 * Authorization header. Authentication is done via a short-lived, lesson+file
 * scoped ticket issued by POST /lessons/:lessonId/pptx/download-ticket (guarded).
 */
@Controller('lessons/:lessonId/pptx')
export class PptxFileController {
    constructor(
        private readonly pptxService: PptxService,
        private readonly tickets: DownloadTicketService,
        private readonly prisma: PrismaService,
    ) { }

    @Get('file')
    async downloadFile(
        @Param('lessonId') lessonId: string,
        @Query('ticket') ticket: string,
        @Res() res: Response,
    ) {
        const payload = this.tickets.resolve(ticket, 'pptx-temp', lessonId);
        if (!payload || !payload.params.fileKey) {
            throw new HttpException('Liên kết tải đã hết hạn. Vui lòng bấm tải lại.', HttpStatus.UNAUTHORIZED);
        }

        const fileKey = payload.params.fileKey;
        const { filePath } = this.pptxService.getTempPptxFile(lessonId, fileKey);

        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
            select: { title: true },
        });
        const safeTitle = (lesson?.title || 'presentation')
            .replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF ]/g, '_')
            .replace(/\s+/g, '_')
            .substring(0, 50);
        const suffix = fileKey.startsWith('noaudio_') ? '_no_audio' : '';

        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'no-store');
        // res.download uses the content-disposition lib -> correct UTF-8 filename* for Vietnamese titles
        res.download(filePath, `${safeTitle}${suffix}.pptx`);
    }
}
