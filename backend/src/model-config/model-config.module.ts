import { Module } from '@nestjs/common';
import { ModelConfigService } from './model-config.service';
import { ModelConfigController } from './model-config.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AIModule } from '../ai/ai.module';

@Module({
    imports: [PrismaModule, ApiKeysModule, AIModule],
    controllers: [ModelConfigController],
    providers: [ModelConfigService],
    exports: [ModelConfigService],
})
export class ModelConfigModule { }

