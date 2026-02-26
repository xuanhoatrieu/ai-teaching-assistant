import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TextNormalizerService } from './text-normalizer.service';
import {
    AdminTTSDictionaryController,
    UserTTSDictionaryController,
} from './text-normalizer.controller';

@Module({
    imports: [PrismaModule],
    controllers: [AdminTTSDictionaryController, UserTTSDictionaryController],
    providers: [TextNormalizerService],
    exports: [TextNormalizerService],
})
export class TextNormalizerModule { }
