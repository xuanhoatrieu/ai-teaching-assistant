import { Module } from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { TemplatesController } from './templates.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { FileStorageModule } from '../file-storage/file-storage.module';

@Module({
    imports: [PrismaModule, FileStorageModule],
    controllers: [TemplatesController],
    providers: [TemplatesService],
    exports: [TemplatesService],
})
export class TemplatesModule { }
