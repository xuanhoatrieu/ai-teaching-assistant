import { Global, Module } from '@nestjs/common';
import { DownloadTicketService } from './download-ticket.service';

// Global so PptxModule and SlidesModule share ONE in-memory ticket store.
@Global()
@Module({
    providers: [DownloadTicketService],
    exports: [DownloadTicketService],
})
export class DownloadTicketModule { }
