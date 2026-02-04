import { Module } from '@nestjs/common';
import { GenerationProcessorService } from './generation-processor.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AIModule } from '../ai/ai.module';
import { ExportModule } from '../export/export.module';

@Module({
    imports: [PrismaModule, AIModule, ExportModule],
    providers: [GenerationProcessorService],
    exports: [GenerationProcessorService],
})
export class GenerationModule { }
