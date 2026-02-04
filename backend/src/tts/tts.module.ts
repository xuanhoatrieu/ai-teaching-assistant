import { Module, forwardRef } from '@nestjs/common';
import { TTSService } from './tts.service';
import { TTSFactory } from './tts.factory';
import { TTSAdminController } from './tts-admin.controller';
import { TTSUserController } from './tts-user.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';

@Module({
    imports: [PrismaModule, forwardRef(() => ApiKeysModule)],
    controllers: [TTSAdminController, TTSUserController],
    providers: [TTSService, TTSFactory],
    exports: [TTSService, TTSFactory],
})
export class TTSModule { }

