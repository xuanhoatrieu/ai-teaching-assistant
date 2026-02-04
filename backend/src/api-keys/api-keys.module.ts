import { Module } from '@nestjs/common';
import { AdminApiKeysController, UserApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [AdminApiKeysController, UserApiKeysController],
    providers: [ApiKeysService],
    exports: [ApiKeysService],
})
export class ApiKeysModule { }
