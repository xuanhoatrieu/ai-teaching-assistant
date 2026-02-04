import { Module } from '@nestjs/common';
import { ExportService } from './export.service';
import { PptxExportService } from './pptx-export.service';
import { DocxExportService } from './docx-export.service';
import { ExcelExportService } from './excel-export.service';
import { WordTableExportService } from './word-table-export.service';
import { AIModule } from '../ai/ai.module';

@Module({
    imports: [AIModule],
    providers: [
        ExportService,
        PptxExportService,
        DocxExportService,
        ExcelExportService,
        WordTableExportService,
    ],
    exports: [ExportService],
})
export class ExportModule { }
