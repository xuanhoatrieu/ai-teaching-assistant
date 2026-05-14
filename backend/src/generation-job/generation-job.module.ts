import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GenerationJobService } from './generation-job.service';
import { GenerationJobController } from './generation-job.controller';

@Module({
    imports: [PrismaModule],
    controllers: [GenerationJobController],
    providers: [GenerationJobService],
    exports: [GenerationJobService],
})
export class GenerationJobModule {}
