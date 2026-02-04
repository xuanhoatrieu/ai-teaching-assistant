import { Module } from '@nestjs/common';
import { LessonsService } from './lessons.service';
import { LessonsController } from './lessons.controller';
import { OutlineParserService } from './outline-parser.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [LessonsController],
    providers: [LessonsService, OutlineParserService],
    exports: [LessonsService],
})
export class LessonsModule { }
