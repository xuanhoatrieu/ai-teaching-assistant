import { Module } from '@nestjs/common';
import { FileStorageService } from './file-storage.service';
import { FileStorageController } from './file-storage.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [FileStorageController],
    providers: [FileStorageService],
    exports: [FileStorageService],
})
export class FileStorageModule { }
