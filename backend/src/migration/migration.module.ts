import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SlideDataModule } from '../slide-data/slide-data.module';
import { MigrationService } from './migration.service';
import { MigrationController } from './migration.controller';

@Module({
    imports: [PrismaModule, SlideDataModule],
    controllers: [MigrationController],
    providers: [MigrationService],
    exports: [MigrationService],
})
export class MigrationModule { }
