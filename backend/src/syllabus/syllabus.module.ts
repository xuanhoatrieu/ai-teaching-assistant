import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AIModule } from '../ai/ai.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { ModelConfigModule } from '../model-config/model-config.module';
import { FileStorageModule } from '../file-storage/file-storage.module';
import { SyllabusController } from './syllabus.controller';
import { SyllabusService } from './syllabus.service';
import { MarkItDownService } from './markitdown.service';
import { MermaidService } from './mermaid.service';
import { SyllabusExportService } from './syllabus-export.service';

@Module({
    imports: [PrismaModule, AIModule, ApiKeysModule, ModelConfigModule, FileStorageModule],
    controllers: [SyllabusController],
    providers: [SyllabusService, MarkItDownService, MermaidService, SyllabusExportService],
    exports: [SyllabusService],
})
export class SyllabusModule {}

