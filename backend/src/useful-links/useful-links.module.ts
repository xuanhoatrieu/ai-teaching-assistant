import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UsefulLinksService } from './useful-links.service';
import { UsefulLinksController } from './useful-links.controller';

@Module({
    imports: [PrismaModule],
    controllers: [UsefulLinksController],
    providers: [UsefulLinksService],
    exports: [UsefulLinksService],
})
export class UsefulLinksModule {}
