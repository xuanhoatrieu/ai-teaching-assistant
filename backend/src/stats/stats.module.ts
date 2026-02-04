import { Module } from '@nestjs/common';
import { StatsController } from './stats.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [StatsController],
})
export class StatsModule { }
